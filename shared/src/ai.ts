import { COURT, DT, attackHoopX } from './constants';
import {
  hdist,
  isInbounder,
  opponents,
  shotValue,
  teammates,
} from './players';
import { nextRandom } from './rng';
import { SHOT_SWEET, baseMakeChance } from './shot';
import { NO_INPUT, type Difficulty, type GameState, type PlayerInput, type PlayerState } from './types';

interface Skill {
  /** Std-dev-ish error on the shot-meter release. */
  shotErr: number;
  /** Minimum expected points before taking a shot. */
  shootThreshold: number;
  stealRate: number;
  blockRate: number;
  /** Scales defensive movement input (reaction / effort). */
  react: number;
}

const SKILLS: Record<Difficulty, Skill> = {
  easy: { shotErr: 0.13, shootThreshold: 1.0, stealRate: 0.04, blockRate: 0.3, react: 0.8 },
  normal: { shotErr: 0.08, shootThreshold: 0.9, stealRate: 0.08, blockRate: 0.55, react: 0.92 },
  hard: { shotErr: 0.05, shootThreshold: 0.85, stealRate: 0.12, blockRate: 0.8, react: 1 },
};

/** Offensive spots as (distance from the hoop toward mid-court, z). */
const SPOTS: [number, number][] = [
  [7.6, 0],
  [5.3, 5.2],
  [0.9, -6.95],
  [4.6, -2.9],
  [1.3, 2.1],
];

type Target = { x: number; z: number };

function skillFor(state: GameState, team: 0 | 1): Skill {
  // A human's own AI teammates always play at normal level.
  if (state.settings.humanTeams.includes(team)) return SKILLS.normal;
  return SKILLS[state.settings.difficulty];
}

const rand = (state: GameState) => nextRandom(state);

function steer(p: PlayerState, t: Target, sprint = false, react = 1, clampToCourt = true): PlayerInput {
  let tx = t.x;
  let tz = t.z;
  if (clampToCourt) {
    tx = Math.max(-COURT.halfLength + 0.35, Math.min(COURT.halfLength - 0.35, tx));
    tz = Math.max(-COURT.halfWidth + 0.35, Math.min(COURT.halfWidth - 0.35, tz));
  }
  const dx = tx - p.pos.x;
  const dz = tz - p.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.2) return NO_INPUT;
  const mag = Math.min(1, d / 1.0) * react;
  return { ...NO_INPUT, moveX: (dx / d) * mag, moveZ: (dz / d) * mag, sprint };
}

function spotFor(p: PlayerState, hx: number, holder: PlayerState | null): Target {
  const s = Math.sign(hx);
  let [a, z] = SPOTS[p.slot] ?? SPOTS[0];
  // Stretch fours space to the wing instead of the elbow.
  if (p.slot === 3 && p.info.ratings.three >= 76) [a, z] = [5.3, -5.2];
  const spot = { x: hx - s * a, z };
  if (holder && holder.id !== p.id && hdist(holder.pos, spot) < 2.5) spot.z = -spot.z || 3;
  return spot;
}

/** Who is in control of the ball right now (-1 when it is up for grabs). */
function controllingTeam(state: GameState): 0 | 1 | -1 {
  const b = state.ball;
  if (b.mode === 'held') return state.players[b.holderId].team;
  if (b.mode === 'pass' && b.pass) return b.pass.team;
  if (b.mode === 'flight' && b.shot) return b.shot.team;
  return -1;
}

export function aiInput(state: GameState, p: PlayerState): PlayerInput {
  if (state.settings.mode === 'practice') return NO_INPUT;
  if (state.phase === 'tipoff' || state.phase === 'periodEnd' || state.phase === 'final') return NO_INPUT;
  p.ai.decisionTimer -= DT;
  if (p.ai.modeTimer > 0) p.ai.modeTimer -= DT;

  const sk = skillFor(state, p.team);
  const b = state.ball;
  const holder = b.mode === 'held' ? state.players[b.holderId] : null;
  if (holder === p) return handlerAi(state, p, sk);

  if (b.mode === 'pass' && b.pass?.targetId === p.id) {
    return steer(p, { x: b.pos.x + b.vel.x * 0.15, z: b.pos.z + b.vel.z * 0.15 }, true, 1, false);
  }
  const control = controllingTeam(state);
  if (b.mode === 'flight' && b.shot) return reboundPositionAi(state, p, sk);
  if (control === -1) return looseBallAi(state, p, sk);
  if (control === p.team) return offBallAi(state, p, holder);
  return defenseAi(state, p, sk, holder);
}

// ---------------------------------------------------------------- handler

function shootNow(state: GameState, p: PlayerState, sk: Skill): PlayerInput {
  const noise = (rand(state) + rand(state) - 1) * sk.shotErr * 1.6;
  p.ai.shotTarget = SHOT_SWEET + noise;
  p.ai.mode = 'none';
  return { ...NO_INPUT, shoot: true };
}

function passTo(target: PlayerState): PlayerInput {
  return { ...NO_INPUT, pass: true, passTarget: target.id };
}

/** Risk that defenders jump a pass from p to m (0 = clean lane). */
function laneRisk(state: GameState, p: PlayerState, m: PlayerState): number {
  const lx = m.pos.x - p.pos.x;
  const lz = m.pos.z - p.pos.z;
  const ll = Math.hypot(lx, lz) || 1;
  let risk = 0;
  for (const o of opponents(state, p.team)) {
    const u = ((o.pos.x - p.pos.x) * lx + (o.pos.z - p.pos.z) * lz) / (ll * ll);
    if (u < 0.15 || u > 0.95) continue;
    const d = Math.hypot(o.pos.x - (p.pos.x + lx * u), o.pos.z - (p.pos.z + lz * u));
    if (d < 1) risk += (1 - d) * 0.5;
  }
  return risk + (ll > 12 ? 0.3 : 0);
}

function bestPass(state: GameState, p: PlayerState, inbound: boolean): { m: PlayerState; value: number } | null {
  let best: { m: PlayerState; value: number } | null = null;
  for (const m of teammates(state, p)) {
    const open = Math.min(4, openness(state, m));
    const value = inbound
      ? open * 0.25 + (m.slot === 0 ? 0.4 : 0) - laneRisk(state, p, m)
      : shotValue(state, m) * 0.95 + open * 0.03 - laneRisk(state, p, m);
    if (!best || value > best.value) best = { m, value };
  }
  return best;
}

function openness(state: GameState, p: PlayerState): number {
  let best = Infinity;
  for (const o of opponents(state, p.team)) best = Math.min(best, hdist(o.pos, p.pos));
  return best;
}

/** Expected points of attacking the rim, discounted when defenders clog the lane. */
function driveValue(state: GameState, p: PlayerState): number {
  const hx = attackHoopX(p.team, state.period);
  const lx = hx - p.pos.x;
  const lz = -p.pos.z;
  const ll = Math.hypot(lx, lz) || 1;
  const guard = state.players.find((o) => state.assign[o.id] === p.id);
  // Help defenders sitting in the lane (the on-ball man is handled by `beat`).
  let clog = 0;
  for (const o of opponents(state, p.team)) {
    if (o === guard) continue;
    const u = ((o.pos.x - p.pos.x) * lx + (o.pos.z - p.pos.z) * lz) / (ll * ll);
    if (u < 0.05 || u > 1.05) continue;
    const d = Math.hypot(o.pos.x - (p.pos.x + lx * u), o.pos.z - (p.pos.z + lz * u));
    if (d < 1.1) clog += (1.1 - d) * (0.6 + o.info.ratings.defense * 0.004);
  }
  const r = p.info.ratings;
  const guardDefense = guard && hdist(guard.pos, p.pos) < 2 ? guard.info.ratings.defense : 40;
  const beat = Math.min(0.85, Math.max(0.25, 0.55 + (r.speed + r.handle - guardDefense * 2) * 0.004));
  const layup = baseMakeChance(r, 1, false, true) * 2;
  return layup * beat * Math.max(0, 1 - clog * 0.5) * (ll > 9 ? 0.85 : 1);
}

function handlerAi(state: GameState, p: PlayerState, sk: Skill): PlayerInput {
  if (p.action === 'shooting') return { ...NO_INPUT, shoot: p.shotMeter < p.ai.shotTarget };
  if (p.action !== 'normal') return NO_INPUT;

  if (isInbounder(state, p)) {
    if (state.phaseTimer < 0.9) return NO_INPUT;
    const t = bestPass(state, p, true);
    return t ? passTo(t.m) : NO_INPUT;
  }
  if (state.phase !== 'live') return NO_INPUT;

  const hx = attackHoopX(p.team, state.period);
  const s = Math.sign(hx);
  const rim = { x: hx, z: 0 };
  const distHoop = hdist(p.pos, rim);
  const inBackcourt = s * p.pos.x < 0;
  const holderHasSpot = spotFor(p, hx, null);

  if (p.ai.mode === 'drive') {
    if (distHoop < 2.3) return shootNow(state, p, sk);
    const blocked = opponents(state, p.team).some((o) => {
      const d = hdist(o.pos, p.pos);
      if (d > 1.1) return false;
      const cos = ((o.pos.x - p.pos.x) * (hx - p.pos.x) + (o.pos.z - p.pos.z) * -p.pos.z) / (d * distHoop || 1);
      return cos > 0.6;
    });
    if (blocked && distHoop > 3 && p.ai.decisionTimer <= 0) {
      p.ai.decisionTimer = 0.25;
      const t = bestPass(state, p, false);
      if (t && t.value > 0.75 && rand(state) < 0.6) return passTo(t.m);
    }
    if (p.ai.modeTimer > 0) {
      return steer(p, { x: hx - s * 0.9, z: p.ai.screenSide * 0.7 }, true);
    }
    p.ai.mode = 'none';
  }

  if (p.ai.decisionTimer > 0) {
    return steer(p, holderHasSpot, inBackcourt && distHoop > 16);
  }
  p.ai.decisionTimer = 0.3 + rand(state) * 0.3;

  if (inBackcourt) {
    const ahead = bestPass(state, p, false);
    if (ahead && ahead.value > 1.1 && rand(state) < 0.3) return passTo(ahead.m);
    return steer(p, holderHasSpot, true);
  }

  const mine = shotValue(state, p);
  const pass = bestPass(state, p, false);
  const drive = driveValue(state, p);
  const passValue = pass?.value ?? 0;

  if (state.shotClock < 3.5) {
    if (distHoop < 8.5 || state.shotClock < 1.5) return shootNow(state, p, sk);
    p.ai.mode = 'drive';
    p.ai.modeTimer = 1.5;
    p.ai.screenSide = Math.sign(p.pos.z) || 1;
    return steer(p, rim, true);
  }

  const patience = state.shotClock > 18 ? 0.05 : 0;
  if (mine >= sk.shootThreshold + patience && mine >= passValue - 0.05 && mine >= drive - 0.1) {
    return shootNow(state, p, sk);
  }
  if (pass && passValue > Math.max(mine, drive) + 0.25 && passValue > 0.9) return passTo(pass.m);
  if (drive > 0.9 && rand(state) < 0.75) {
    p.ai.mode = 'drive';
    p.ai.modeTimer = 1.6 + rand(state) * 0.6;
    p.ai.screenSide = Math.sign(p.pos.z) || (rand(state) < 0.5 ? 1 : -1);
    return steer(p, rim, true);
  }
  if (p.slot <= 1 && distHoop > 6.3 && rand(state) < 0.25) callScreen(state, p);
  if (state.shotClock < 8 && mine > 0.7) return shootNow(state, p, sk);
  if (state.shotClock < 10 && pass && passValue > 0.8 && rand(state) < 0.3) return passTo(pass.m);
  // Probe: jab toward a slightly different spot.
  const jitter = { x: holderHasSpot.x + (rand(state) - 0.5) * 2.5, z: holderHasSpot.z + (rand(state) - 0.5) * 3 };
  return steer(p, jitter);
}

function callScreen(state: GameState, handler: PlayerState): void {
  const screener = teammates(state, handler)
    .filter((m) => m.slot >= 3 && m.ai.mode === 'none' && hdist(m.pos, handler.pos) < 10)
    .sort((a, b) => b.slot - a.slot)[0];
  if (!screener) return;
  screener.ai.mode = 'screen';
  screener.ai.modeTimer = 3.5;
  screener.ai.arrived = false;
  screener.ai.screenSide = Math.sign(screener.pos.z - handler.pos.z) || 1;
}

// ------------------------------------------------------------ off the ball

function offBallAi(state: GameState, p: PlayerState, holder: PlayerState | null): PlayerInput {
  const hx = attackHoopX(p.team, state.period);
  const s = Math.sign(hx);

  if (state.phase === 'inbound' && state.inbound?.team === p.team) {
    const passer = state.players[state.inbound.passerId];
    const receiverSlot = passer.slot === 0 ? 1 : 0;
    if (p.slot === receiverSlot) {
      const spot = state.inbound.spot;
      const inward = { x: -Math.sign(spot.x) * (Math.abs(spot.x) > COURT.halfLength ? 1 : 0), z: -Math.sign(spot.z) * (Math.abs(spot.z) > COURT.halfWidth ? 1 : 0) };
      return steer(p, { x: spot.x + inward.x * 3.5 + (inward.x === 0 ? 1.5 : 0), z: spot.z + inward.z * 3.5 + (inward.z === 0 ? 1.8 : 0) }, true);
    }
  }

  if (p.ai.mode === 'screen') return screenAi(state, p, holder);
  if (p.ai.mode === 'roll' || p.ai.mode === 'cut') {
    if (p.ai.modeTimer > 0) return steer(p, { x: hx - s * 1.0, z: p.ai.screenSide * 0.7 }, true);
    p.ai.mode = 'none';
  }

  if (p.ai.decisionTimer <= 0) {
    p.ai.decisionTimer = 1 + rand(state);
    const rimDist = hdist(p.pos, { x: hx, z: 0 });
    const guarded = openness(state, p) < 1.6;
    if (holder && state.phase === 'live' && rimDist > 4 && rand(state) < (guarded ? 0.18 : 0.08)) {
      p.ai.mode = 'cut';
      p.ai.modeTimer = 1.3;
      p.ai.screenSide = Math.sign(p.pos.z) || 1;
    }
  }
  const spot = spotFor(p, hx, holder);
  return steer(p, spot, hdist(p.pos, spot) > 4);
}

function screenAi(state: GameState, p: PlayerState, holder: PlayerState | null): PlayerInput {
  const guard = holder ? state.players.find((o) => state.assign[o.id] === holder.id) : undefined;
  if (!holder || !guard || holder.team !== p.team || p.ai.modeTimer <= 0) {
    p.ai.mode = 'none';
    p.ai.arrived = false;
    return NO_INPUT;
  }
  // Set up just beside the on-ball defender, on the screener's side.
  const hx = attackHoopX(p.team, state.period);
  const ux = hx - holder.pos.x;
  const uz = -holder.pos.z;
  const ul = Math.hypot(ux, uz) || 1;
  const px = -uz / ul;
  const pz = ux / ul;
  const side = p.ai.screenSide;
  const spot = { x: guard.pos.x + px * side * 0.75 - (ux / ul) * 0.1, z: guard.pos.z + pz * side * 0.75 - (uz / ul) * 0.1 };
  if (!p.ai.arrived && hdist(p.pos, spot) < 0.45) {
    p.ai.arrived = true;
    p.ai.modeTimer = 0.7;
  }
  if (p.ai.arrived) {
    if (p.ai.modeTimer <= 0.05) {
      // Handler turns the corner away from the screen side; screener rolls.
      if (holder.ai.mode === 'none' && !state.settings.humanTeams.includes(holder.team)) {
        holder.ai.mode = 'drive';
        holder.ai.modeTimer = 1.6;
        holder.ai.screenSide = -side;
        holder.ai.decisionTimer = 0.2;
      }
      p.ai.mode = 'roll';
      p.ai.modeTimer = 1.8;
      p.ai.arrived = false;
    }
    return NO_INPUT;
  }
  return steer(p, spot, true);
}

// ----------------------------------------------------------------- defence

function defendedHoop(state: GameState, p: PlayerState): Target {
  return { x: attackHoopX((1 - p.team) as 0 | 1, state.period), z: 0 };
}

function dirTo(from: Target, to: Target): Target {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

function maybeBlock(state: GameState, p: PlayerState, sk: Skill): boolean {
  if (!p.onGround) return false;
  for (const o of opponents(state, p.team)) {
    if (o.action !== 'shooting' || hdist(o.pos, p.pos) > 1.8) continue;
    // Time the jump to meet the release; roll once in a short window.
    const window = o.shotKind === 'layup' ? [0.25, 0.32] : [0.42, 0.5];
    if (o.shotMeter >= window[0] && o.shotMeter < window[1]) {
      return rand(state) < sk.blockRate * (0.5 + p.info.ratings.block * 0.006);
    }
  }
  return false;
}

function defenseAi(state: GameState, p: PlayerState, sk: Skill, holder: PlayerState | null): PlayerInput {
  const rim = defendedHoop(state, p);
  const manId = state.assign[p.id];
  const man = manId >= 0 ? state.players[manId] : null;
  const jump = maybeBlock(state, p, sk);
  if (!man) return { ...steer(p, { x: rim.x - Math.sign(rim.x) * 2, z: 0 }), jump };

  // Switch when caught on a set screen.
  if (holder && man.id === holder.id) {
    const screener = opponents(state, p.team).find((o) => o.ai.mode === 'screen' && o.ai.arrived && hdist(o.pos, p.pos) < 0.95);
    if (screener && hdist(holder.pos, p.pos) > 1.6 && rand(state) < 0.25 * sk.react) {
      const partner = state.players.find((d) => state.assign[d.id] === screener.id);
      if (partner) {
        state.assign[partner.id] = holder.id;
        state.assign[p.id] = screener.id;
      }
    }
  }

  const ball = state.ball.pos;
  let target: Target;
  let sprint = false;
  if (holder && man.id === holder.id) {
    if (isInbounder(state, man)) {
      const toCourt = dirTo(man.pos, { x: 0, z: 0 });
      target = { x: man.pos.x + toCourt.x * 1.8, z: man.pos.z + toCourt.z * 1.8 };
    } else {
      const d = dirTo(man.pos, rim);
      const gap = 1.05 + (100 - p.info.ratings.defense) * 0.004;
      target = { x: man.pos.x + d.x * gap, z: man.pos.z + d.z * gap };
      if (p.ai.decisionTimer <= 0 && hdist(p.pos, man.pos) < 1.35 && state.phase === 'live') {
        p.ai.decisionTimer = 0.55;
        if (rand(state) < sk.stealRate * (p.info.ratings.steal / 70)) {
          return { ...steer(p, target, false, sk.react), pass: true };
        }
      }
    }
    sprint = hdist(p.pos, target) > 1.5;
  } else {
    target = helpTarget(state, p, rim, holder) ?? {
      x: man.pos.x + (rim.x - man.pos.x) * 0.33 + (ball.x - man.pos.x) * 0.15,
      z: man.pos.z + (rim.z - man.pos.z) * 0.33 + (ball.z - man.pos.z) * 0.15,
    };
    sprint = hdist(p.pos, target) > 2.5;
  }
  return { ...steer(p, target, sprint, sk.react), jump };
}

/** If the ball handler has beaten their man near the rim, the nearest helper steps into the lane. */
function helpTarget(state: GameState, p: PlayerState, rim: Target, holder: PlayerState | null): Target | null {
  if (!holder || holder.team === p.team || hdist(holder.pos, rim) > 4.5) return null;
  const onBall = state.players.find((d) => state.assign[d.id] === holder.id);
  if (!onBall || hdist(onBall.pos, rim) < hdist(holder.pos, rim) + 0.4) return null;
  const d = dirTo(holder.pos, rim);
  const lane = { x: holder.pos.x + d.x * 1.2, z: holder.pos.z + d.z * 1.2 };
  const helper = state.players
    .filter((o) => o.team === p.team && o.id !== onBall.id)
    .sort((a, b) => hdist(a.pos, lane) - hdist(b.pos, lane))[0];
  return helper?.id === p.id ? lane : null;
}

// ------------------------------------------------------------- rebounding

function reboundPositionAi(state: GameState, p: PlayerState, sk: Skill): PlayerInput {
  const shot = state.ball.shot!;
  const s = Math.sign(shot.hoopX);
  const crash = { x: shot.hoopX - s * 1.6, z: p.pos.z > 0 ? 1.2 : -1.2 };
  if (p.team === shot.team) {
    if (p.slot >= 3) return steer(p, crash, true);
    return offBallAi(state, p, null);
  }
  // Defence boxes out: get between your man and the rim.
  const man = state.assign[p.id] >= 0 ? state.players[state.assign[p.id]] : null;
  if (!man) return steer(p, crash, true);
  const rim = { x: shot.hoopX, z: 0 };
  const d = dirTo(man.pos, rim);
  const box = { x: man.pos.x + d.x * 0.8, z: man.pos.z + d.z * 0.8 };
  const jump = maybeBlock(state, p, sk);
  return { ...steer(p, box, true), jump };
}

function looseBallAi(state: GameState, p: PlayerState, sk: Skill): PlayerInput {
  const b = state.ball;
  // Aim where the ball will be at catchable height.
  let t = 0.2;
  const catchY = 1.8;
  if (b.pos.y > catchY) {
    const disc = b.vel.y * b.vel.y + 2 * 9.81 * (b.pos.y - catchY);
    t = (b.vel.y + Math.sqrt(Math.max(0, disc))) / 9.81;
  }
  const land = { x: b.pos.x + b.vel.x * t, z: b.pos.z + b.vel.z * t };
  const rank = state.players
    .filter((o) => o.team === p.team)
    .sort((a, c) => hdist(a.pos, land) - hdist(c.pos, land))
    .findIndex((o) => o.id === p.id);
  if (rank <= 1 && state.phase === 'live') {
    const near = hdist(p.pos, b.pos) < 1.2;
    const jumpable = b.pos.y > 2.1 && b.pos.y < p.info.heightM * 1.3 + 0.9 && b.vel.y < 0;
    return { ...steer(p, near ? b.pos : land, true, 1, false), jump: near && jumpable };
  }
  if (state.possession === p.team) return offBallAi(state, p, null);
  return defenseAi(state, p, sk, null);
}

