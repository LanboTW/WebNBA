import { BALL_RADIUS, CHECK_X, COURT, DT, HOOP_X, SHOT_CLOCK, attackHoop, attackHoopX, isInBounds, isThreePoint } from './constants';
import { giveBall } from './ball';
import { applySubs } from './bench';
import { defensiveThree, lateWindow, startFreeThrows, updateFreeThrow } from './fouls';
import { choosePassTarget, hdist, releasePass } from './players';
import { nextRandom } from './rng';
import {
  NO_INPUT,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type Resume,
  type TurnoverReason,
  type Vec3,
} from './types';

const INBOUND_OFFSET = 0.45;
const DEAD_BALL_SECONDS = 1.3;
const PERIOD_BREAK_SECONDS = 3;
/** Inbounder must release within this (five-second violation; auto-pass when violations are off). */
const INBOUND_LIMIT = 5;
export const TIMEOUTS_PER_GAME = 5;
export const TIMEOUT_SECONDS = 30;
/** Distance from the baseline of the frontcourt inbound line used after a late timeout (28 ft). */
const ADVANCE_LINE = 8.53;

export function isHuman(state: GameState, team: 0 | 1): boolean {
  return state.settings.humanTeams.includes(team);
}

/** Whether a person makes this team's substitutions and timeouts (not in solo games). */
export function humanCoach(state: GameState, team: 0 | 1): boolean {
  return isHuman(state, team) && !(team === 0 && state.settings.solo !== undefined);
}

export function overtimeSeconds(state: GameState): number {
  return Math.max(60, Math.round((state.settings.quarterSeconds * 5) / 12));
}

export function nearestToBall(state: GameState, team: 0 | 1, exclude = -1): PlayerState {
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team || p.id === exclude) continue;
    const d = hdist(p.pos, state.ball.pos);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best!;
}

export function setPossession(state: GameState, team: 0 | 1): void {
  if (state.possession === team) return;
  state.possession = team;
  state.shotClock = SHOT_CLOCK;
  state.ball.assist = null;
  state.frontcourt = false;
  state.backcourtTimer = 0;
  for (const p of state.players) p.paintTime = 0;
  state.events.push({ type: 'possession', team });
  const other = (1 - team) as 0 | 1;
  if (isHuman(state, other)) state.controlled[other] = nearestToBall(state, other).id;
}

/**
 * Someone secured the ball (catch, rebound, recovery). `prevTouch` is the team
 * that touched it last before this player.
 */
export function onGainBall(state: GameState, p: PlayerState, prevTouch: 0 | 1 = p.team): void {
  if (isHuman(state, p.team)) state.controlled[p.team] = p.id;
  if (state.settings.mode !== 'game') return;
  state.clockHold = false;
  // Recovering a ball the defence knocked into the backcourt is legal; a new count starts.
  if (!state.settings.street && state.possession === p.team && state.frontcourt && prevTouch !== p.team) {
    const s = Math.sign(attackHoop(state, p.team));
    if (s * p.pos.x < 0) {
      state.frontcourt = false;
      state.backcourtTimer = 0;
    }
  }
  setPossession(state, p.team);
  if (state.phase === 'live') state.shotClockOn = true;
}

export function onMadeBasket(state: GameState): void {
  const shot = state.ball.shot!;
  const street = state.settings.street;
  // Street: a basket before the ball was cleared doesn't count, and the ball changes hands.
  if (street && !state.frontcourt && shot.kind !== 'free' && state.phase === 'live') {
    state.ball.assist = null;
    turnover(state, shot.team, 'noClear', { x: CHECK_X, y: 0, z: 0 }, shot.shooterId);
    return;
  }
  state.score[shot.team] += shot.points;
  const shooter = state.players[shot.shooterId];
  shooter.stats.pts += shot.points;
  if (shot.kind === 'free') shooter.stats.ftm++;
  else shooter.stats.fgm++;
  // Street: the long ones are worth 2.
  if (shot.points === 3 || (street && shot.points === 2 && shot.kind === 'jumper')) shooter.stats.tpm++;
  if (state.run.team === shot.team) state.run.pts += shot.points;
  else state.run = { team: shot.team, pts: shot.points };
  state.clockHold = false;
  const a = state.ball.assist;
  let assistId = -1;
  if (a && a.receiverId === shooter.id && a.passerId !== shooter.id && state.tick - a.tick < 3 * 30) {
    const passer = state.players[a.passerId];
    if (passer.team === shooter.team) {
      passer.stats.ast++;
      assistId = passer.id;
    }
  }
  state.ball.assist = null;
  state.events.push({
    type: 'score',
    playerId: shooter.id,
    team: shot.team,
    points: shot.points,
    kind: shot.kind,
    swish: !shot.touchedRim,
    hoopX: shot.hoopX,
    assistId,
  });
  if (state.settings.mode !== 'game') return;
  state.shotClockOn = false;
  if (street) {
    if (state.score[shot.team] >= street.target) {
      state.phase = 'final';
      state.events.push({ type: 'final', winner: shot.team });
      return;
    }
    const next = street.makeItTakeIt ? shot.team : ((1 - shot.team) as 0 | 1);
    state.phase = 'dead';
    state.phaseTimer = DEAD_BALL_SECONDS;
    state.pendingInbound = { team: next, spot: { x: CHECK_X, y: 0, z: 0 } };
    state.pendingFT = null;
    setPossession(state, next);
    return;
  }
  // A buzzer-beater is handled by the pending period end; an and-one or a
  // free throw that isn't the last one keeps the current stoppage going.
  if (state.pendingEnd || state.pendingFT || state.phase === 'freeThrow') return;
  const other = (1 - shot.team) as 0 | 1;
  const s = Math.sign(shot.hoopX);
  state.phase = 'dead';
  state.phaseTimer = DEAD_BALL_SECONDS;
  state.pendingInbound = {
    team: other,
    spot: { x: s * (COURT.halfLength + INBOUND_OFFSET), y: 0, z: nextRandom(state) < 0.5 ? 1.3 : -1.3 },
  };
  setPossession(state, other);
}

export function updateRules(state: GameState): void {
  if (state.settings.mode !== 'game') return;
  switch (state.phase) {
    case 'tipoff':
      updateTipoff(state);
      break;
    case 'live':
      updateLive(state);
      break;
    case 'dead':
      state.phaseTimer -= DT;
      if (state.phaseTimer > 0) break;
      if (maybeAiTimeout(state)) break;
      if (state.pendingFT) {
        const ft = state.pendingFT;
        startFreeThrows(state, ft.shooterId, ft.total, ft.after);
      } else if (state.pendingInbound) {
        const pi = state.pendingInbound;
        state.pendingInbound = null;
        startInbound(state, pi.team, pi.spot);
      }
      break;
    case 'inbound':
      updateInbound(state);
      break;
    case 'freeThrow':
      updateFreeThrow(state);
      break;
    case 'timeout':
      updateTimeout(state);
      break;
    case 'periodEnd':
      state.phaseTimer -= DT;
      if (state.phaseTimer <= 0) startPeriod(state, state.period + 1);
      break;
    case 'final':
      break;
  }
}

function updateLive(state: GameState): void {
  const ball = state.ball;
  for (const p of state.players) p.stats.secs += DT;
  if (state.settings.street) return updateStreet(state);
  if (!state.clockHold) state.gameClock -= DT;
  if (state.shotClockOn) state.shotClock -= DT;

  if (state.pendingEnd) {
    if (ball.mode !== 'flight' || ball.shot?.scored) endPeriod(state);
    return;
  }
  if (state.gameClock <= 0) {
    state.gameClock = 0;
    state.events.push({ type: 'buzzer' });
    if (ball.mode === 'flight' && ball.shot && !ball.shot.scored) state.pendingEnd = true;
    else endPeriod(state);
    return;
  }

  if (state.shotClockOn && state.shotClock <= 0) {
    const shotInAir = ball.mode === 'flight' && !!ball.shot && !ball.shot.touchedRim;
    if (!shotInAir) {
      state.shotClock = 0;
      const holder = ball.mode === 'held' ? ball.holderId : -1;
      turnover(state, state.possession, 'shotclock', inboundSpot(ball.pos), holder);
      return;
    }
  }

  if (ball.mode === 'held') {
    const h = state.players[ball.holderId];
    if (!isInBounds(h.pos.x, h.pos.z)) {
      turnover(state, h.team, 'oob', inboundSpot(h.pos), h.id);
      return;
    }
  }
  if (state.settings.rules.violations && checkViolations(state)) return;
  if (ball.mode === 'held') return;
  const onFloorOut = ball.pos.y <= BALL_RADIUS + 0.05 && !isInBounds(ball.pos.x, ball.pos.z);
  const intoStands =
    Math.abs(ball.pos.x) > COURT.halfLength + 2.8 || Math.abs(ball.pos.z) > COURT.halfWidth + 2.8;
  if ((onFloorOut || intoStands) && !ball.shot?.scored) {
    turnover(state, ball.lastTouchTeam, 'oob', inboundSpot(ball.pos));
  }
}

/**
 * Street: no game clock and no violations. The shot clock only runs to hurry
 * the AI along (it is never called). Out of bounds (the half-court line too)
 * and every change of possession lead to a check at the top of the key.
 */
function updateStreet(state: GameState): void {
  const ball = state.ball;
  if (state.shotClockOn) state.shotClock = Math.max(0, state.shotClock - DT);
  if (ball.mode === 'held') {
    const h = state.players[ball.holderId];
    if (!isInBounds(h.pos.x, h.pos.z, true)) {
      turnover(state, h.team, 'oob', { x: CHECK_X, y: 0, z: 0 }, h.id);
      return;
    }
    // Clearing: the team with the ball takes it beyond the arc.
    if (h.team === state.possession && !state.frontcourt && h.onGround && isThreePoint(h.pos.x, h.pos.z, HOOP_X)) {
      state.frontcourt = true;
    }
    return;
  }
  const onFloorOut = ball.pos.y <= BALL_RADIUS + 0.05 && !isInBounds(ball.pos.x, ball.pos.z, true);
  const intoStands = ball.pos.x < -2.8 || ball.pos.x > COURT.halfLength + 2.8 || Math.abs(ball.pos.z) > COURT.halfWidth + 2.8;
  if ((onFloorOut || intoStands) && !ball.shot?.scored) {
    turnover(state, ball.lastTouchTeam, 'oob', { x: CHECK_X, y: 0, z: 0 });
  }
}

/** Painted area in front of the hoop at hoopX. */
export function inPaint(pos: { x: number; z: number }, hoopX: number): boolean {
  const s = Math.sign(hoopX);
  return Math.abs(pos.z) < COURT.keyWidth / 2 && s * pos.x > COURT.halfLength - COURT.freeThrowFromBaseline;
}

/** Three seconds (both ends), eight seconds and backcourt. Returns true if a whistle blew. */
function checkViolations(state: GameState): boolean {
  const ball = state.ball;
  const team = state.possession;
  const holder = ball.mode === 'held' ? state.players[ball.holderId] : null;
  const control = (!!holder && holder.team === team) || (ball.mode === 'pass' && ball.pass?.team === team);
  const hx = attackHoop(state, team);
  const s = Math.sign(hx);

  if (holder && holder.team === team && holder.onGround) {
    if (state.frontcourt && s * holder.pos.x < -0.05) {
      turnover(state, team, 'backcourt', sidelineSpot(holder.pos), holder.id);
      return true;
    }
    if (!state.frontcourt && s * holder.pos.x > 0.05) state.frontcourt = true;
  }
  if (!state.frontcourt && control && state.shotClockOn) {
    state.backcourtTimer += DT;
    if (state.backcourtTimer > 8) {
      turnover(state, team, 'eightSec', sidelineSpot(ball.pos), holder?.team === team ? holder.id : -1);
      return true;
    }
  }

  const counting = control && state.frontcourt;
  for (const p of state.players) {
    if (!counting || !inPaint(p.pos, hx)) {
      p.paintTime = 0;
      continue;
    }
    if (p.team === team) {
      // Shooters and players driving to score get the benefit.
      if (p.action !== 'normal') continue;
      p.paintTime += DT;
      if (p.paintTime > 3) {
        turnover(state, team, 'threeSec', sidelineSpot(ball.pos), p.id);
        return true;
      }
    } else {
      // Defenders may stay in the lane only while guarding someone within arm's length.
      const guarding = state.players.some((o) => o.team === team && hdist(o.pos, p.pos) < 1.5);
      p.paintTime = guarding ? 0 : p.paintTime + DT;
      if (p.paintTime > 3) {
        p.paintTime = 0;
        defensiveThree(state, p);
        return true;
      }
    }
  }
  return false;
}

export function turnover(state: GameState, team: 0 | 1, reason: TurnoverReason, spot: Vec3, playerId = -1): void {
  if (playerId >= 0) state.players[playerId].stats.tov++;
  state.events.push({ type: 'turnover', team, reason, playerId });
  const other = (1 - team) as 0 | 1;
  const b = state.ball;
  if (b.mode === 'held') b.vel = { x: 0, y: 0, z: 0 };
  b.mode = 'loose';
  b.holderId = -1;
  b.shot = null;
  b.pass = null;
  state.shotClockOn = false;
  state.phase = 'dead';
  state.phaseTimer = 1.0;
  state.pendingInbound = { team: other, spot };
  state.pendingFT = null;
  for (const p of state.players) {
    if (p.action !== 'shooting') continue;
    p.action = 'normal';
    p.shotMeter = -1;
  }
  setPossession(state, other);
}

/** Nearest sideline spot, kept away from the corners. */
export function sidelineSpot(pos: { x: number; z: number }): Vec3 {
  const L = COURT.halfLength - 1.5;
  return { x: Math.max(-L, Math.min(L, pos.x)), y: 0, z: Math.sign(pos.z || 1) * (COURT.halfWidth + INBOUND_OFFSET) };
}

/** Nearest point just outside the boundary to where the ball went out. */
function inboundSpot(pos: Vec3): Vec3 {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const overX = Math.abs(pos.x) - L;
  const overZ = Math.abs(pos.z) - W;
  if (overX > overZ) {
    // Baseline, but never directly behind the hoop.
    let z = Math.max(-W + 0.5, Math.min(W - 0.5, pos.z));
    if (Math.abs(z) < 1.2) z = z < 0 ? -1.2 : 1.2;
    return { x: Math.sign(pos.x || 1) * (L + INBOUND_OFFSET), y: 0, z };
  }
  return { x: Math.max(-L + 0.8, Math.min(L - 0.8, pos.x)), y: 0, z: Math.sign(pos.z || 1) * (W + INBOUND_OFFSET) };
}

function startInbound(state: GameState, team: 0 | 1, spot: Vec3): void {
  if (state.settings.street) return startCheck(state, team);
  applySubs(state);
  // From the baseline under the hoop it defends (after a score, say) a guard takes it out.
  const ownBaseline =
    Math.abs(spot.x) > COURT.halfLength && Math.sign(spot.x) !== Math.sign(attackHoop(state, team));
  const guard = (p: PlayerState) => p.info.position === 'PG' || p.info.position === 'SG';
  const guards = ownBaseline && state.players.some((p) => p.team === team && guard(p));
  let passer: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team || (guards && !guard(p))) continue;
    const d = hdist(p.pos, spot);
    if (d < bestD) {
      bestD = d;
      passer = p;
    }
  }
  if (!passer) return;
  passer.pos = { ...spot };
  passer.vel = { x: 0, y: 0, z: 0 };
  passer.onGround = true;
  passer.action = 'normal';
  passer.facing = Math.atan2(-spot.x, -spot.z);
  state.phase = 'inbound';
  state.phaseTimer = 0;
  state.inbound = { team, spot: { ...spot }, passerId: passer.id };
  setPossession(state, team);
  giveBall(state, passer.id);
  state.shotClockOn = false;
  state.frontcourt = false;
  state.backcourtTimer = 0;
  for (const p of state.players) p.paintTime = 0;
  if (isHuman(state, team)) state.controlled[team] = passer.id;
}

/**
 * Street check: the team's best ball handler takes it at the top of the key
 * (already cleared), teammates spread to the wings, defenders pick up their man.
 */
export function startCheck(state: GameState, team: 0 | 1): void {
  const mine = state.players.filter((p) => p.team === team);
  const handler = [...mine].sort((a, b) => b.info.ratings.handle + b.info.ratings.pass - (a.info.ratings.handle + a.info.ratings.pass))[0];
  if (!handler) return;
  const wings: [number, number][] = [
    [HOOP_X - 5.4, 5.3],
    [HOOP_X - 1.0, -6.9],
  ];
  const place = (p: PlayerState, x: number, z: number) => {
    p.pos = { x, y: 0, z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.onGround = true;
    p.action = 'normal';
    p.shotMeter = -1;
    p.dribbleDead = false;
    p.ai.mode = 'none';
    p.ai.arrived = false;
    p.paintTime = 0;
    p.facing = Math.atan2(HOOP_X - x, -z);
  };
  place(handler, CHECK_X, 0);
  mine.filter((p) => p !== handler).forEach((p, i) => place(p, ...(wings[i] ?? wings[0])));
  for (const d of state.players) {
    if (d.team === team) continue;
    const man = state.players[state.assign[d.id]] ?? handler;
    const dx = HOOP_X - man.pos.x;
    const dz = -man.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    place(d, man.pos.x + (dx / l) * 1.4, man.pos.z + (dz / l) * 1.4);
  }
  state.ball.shot = null;
  state.ball.pass = null;
  state.inbound = null;
  state.pendingInbound = null;
  state.pendingFT = null;
  setPossession(state, team);
  giveBall(state, handler.id);
  state.phase = 'live';
  state.phaseTimer = 0;
  state.shotClock = SHOT_CLOCK;
  state.shotClockOn = true;
  state.frontcourt = true;
  if (isHuman(state, team)) state.controlled[team] = handler.id;
  const other = (1 - team) as 0 | 1;
  if (isHuman(state, other)) state.controlled[other] = state.players.find((p) => p.team === other && state.assign[p.id] === handler.id)?.id ?? state.controlled[other];
}

function updateInbound(state: GameState): void {
  state.phaseTimer += DT;
  const inbound = state.inbound!;
  const ball = state.ball;
  if (ball.mode !== 'held' || ball.holderId !== inbound.passerId) {
    state.phase = 'live';
    state.inbound = null;
    state.shotClockOn = true;
    return;
  }
  if (state.phaseTimer > INBOUND_LIMIT) {
    const passer = state.players[inbound.passerId];
    if (state.settings.rules.violations) {
      state.inbound = null;
      turnover(state, inbound.team, 'fiveSec', inbound.spot, passer.id);
      return;
    }
    const target = choosePassTarget(state, passer, NO_INPUT);
    if (target >= 0) releasePass(state, passer, target);
  }
}

function endPeriod(state: GameState): void {
  state.pendingEnd = false;
  state.shotClockOn = false;
  // Anyone mid-gather at the buzzer is too late; don't let the frozen input release it.
  for (const p of state.players) {
    if (p.action !== 'shooting') continue;
    p.action = 'normal';
    p.shotMeter = -1;
    p.lastShoot = false;
  }
  state.events.push({ type: 'periodEnd', period: state.period });
  if (state.period >= 4 && state.score[0] !== state.score[1]) {
    state.phase = 'final';
    state.events.push({ type: 'final', winner: state.score[0] > state.score[1] ? 0 : 1 });
    return;
  }
  state.phase = 'periodEnd';
  state.phaseTimer = PERIOD_BREAK_SECONDS;
}

export function startPeriod(state: GameState, period: number): void {
  state.period = period;
  state.gameClock = period <= 4 ? state.settings.quarterSeconds : overtimeSeconds(state);
  state.shotClock = SHOT_CLOCK;
  state.shotClockOn = false;
  state.pendingEnd = false;
  state.pendingInbound = null;
  state.pendingFT = null;
  state.freeThrow = null;
  state.inbound = null;
  state.clockHold = false;
  state.teamFouls = [0, 0];
  state.lateFouls = [0, 0];
  if (period >= 5) state.timeoutsLeft = [state.timeoutsLeft[0] + 1, state.timeoutsLeft[1] + 1];
  // The break between periods is a breather for everyone.
  if (period > 1) {
    for (const p of state.players) p.energy = Math.min(1, p.energy + 0.15);
    for (const bench of state.bench) for (const b of bench) b.energy = Math.min(1, b.energy + 0.15);
  }
  applySubs(state);
  for (const p of state.players) {
    p.paintTime = 0;
    p.vel = { x: 0, y: 0, z: 0 };
    p.pos.y = 0;
    p.onGround = true;
    p.action = 'normal';
    p.shotMeter = -1;
    p.ai.mode = 'none';
    p.ai.arrived = false;
  }
  if (state.settings.street) {
    // Coin flip for the first check; everyone set, a moment to look.
    startCheck(state, nextRandom(state) < 0.5 ? 0 : 1);
    state.phase = 'dead';
    state.phaseTimer = 1.6;
    state.pendingInbound = { team: state.possession, spot: { x: CHECK_X, y: 0, z: 0 } };
    return;
  }
  if (period === 1 || period >= 5) {
    beginTipoff(state);
    return;
  }
  // Q2 and Q3 go to the team that lost the opening tip, Q4 to the winner.
  const team = period === 4 ? state.tipWinner : ((1 - state.tipWinner) as 0 | 1);
  const back = -Math.sign(attackHoopX(team, period));
  for (const p of state.players) {
    const z = SLOT_Z[p.slot];
    p.pos.x = p.team === team ? back * 8 : back * -1.5;
    p.pos.z = z;
  }
  const spot = { x: back * (COURT.halfLength + INBOUND_OFFSET), y: 0, z: 2 };
  state.ball.mode = 'loose';
  startInbound(state, team, spot);
}

const SLOT_Z = [0, 4.5, -4.5, 2.2, -2.2];

function beginTipoff(state: GameState): void {
  for (const p of state.players) {
    const back = -Math.sign(attackHoop(state, p.team));
    if (p.slot === 4) {
      p.pos.x = back * 0.55;
      p.pos.z = 0;
    } else {
      p.pos.x = back * (p.slot < 2 ? 4.2 : 2.2);
      p.pos.z = SLOT_Z[p.slot] * (p.team === 0 ? 1 : -1);
    }
    p.facing = Math.atan2(-back, 0);
  }
  const b = state.ball;
  b.mode = 'flight';
  b.holderId = -1;
  b.shot = null;
  b.pass = null;
  b.pos = { x: 0, y: 1.8, z: 0 };
  b.vel = { x: 0, y: 6, z: 0 };
  state.phase = 'tipoff';
  state.phaseTimer = 0;
}

function updateTipoff(state: GameState): void {
  const before = state.phaseTimer;
  state.phaseTimer += DT;
  const centers = [0, 1].map((t) => state.players.find((p) => p.team === t && p.slot === 4));
  if (before < 0.3 && state.phaseTimer >= 0.3) {
    for (const c of centers) {
      if (!c) continue;
      c.vel.y = 3.0 + c.info.ratings.jump * 0.014;
      c.onGround = false;
    }
  }
  if (before < 0.62 && state.phaseTimer >= 0.62) {
    const w = centers.map((c) => (c ? c.info.ratings.jump + c.info.heightM * 40 : 0));
    const winner: 0 | 1 = nextRandom(state) < w[0] / (w[0] + w[1] || 1) ? 0 : 1;
    if (state.period === 1) state.tipWinner = winner;
    const receiver = state.players.find((p) => p.team === winner && p.slot === 1) ?? nearestToBall(state, winner);
    const dx = receiver.pos.x - state.ball.pos.x;
    const dz = receiver.pos.z - state.ball.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const b = state.ball;
    b.mode = 'loose';
    b.vel = { x: (dx / l) * 4.5, y: 0.5, z: (dz / l) * 4.5 };
    b.lastTouchTeam = winner;
    state.possession = winner;
    state.frontcourt = false;
    state.backcourtTimer = 0;
    state.phase = 'live';
    state.events.push({ type: 'tipoff' });
  }
}

// -------------------------------------------------------------- timeouts

/** Timeout button: call one, or (during one) signal ready to continue. */
export function handleTimeoutInput(state: GameState, inputs: Partial<Record<0 | 1, PlayerInput>>): void {
  for (const team of state.settings.humanTeams) {
    const pressed = !!inputs[team]?.timeout;
    const edge = pressed && !state.timeoutLatch[team];
    state.timeoutLatch[team] = pressed;
    if (!edge) continue;
    if (state.phase === 'timeout') {
      const t = state.timeout!;
      if (!t.ready.includes(team)) t.ready.push(team);
    } else if (humanCoach(state, team) && canCallTimeout(state, team)) {
      callTimeout(state, team);
    }
  }
}

/** Dead ball, or live while your team holds the ball (not mid-shot). */
export function canCallTimeout(state: GameState, team: 0 | 1): boolean {
  if (state.settings.mode !== 'game' || state.settings.street || state.timeoutsLeft[team] <= 0) return false;
  const b = state.ball;
  switch (state.phase) {
    case 'live': {
      if (b.mode !== 'held') return false;
      const h = state.players[b.holderId];
      return h.team === team && h.action === 'normal';
    }
    case 'dead':
      return b.mode !== 'flight' && b.mode !== 'pass' && (!!state.pendingFT || !!state.pendingInbound);
    case 'inbound':
      return true;
    case 'freeThrow':
      return !!state.freeThrow && !state.freeThrow.released;
    default:
      return false;
  }
}

export function callTimeout(state: GameState, team: 0 | 1): void {
  const b = state.ball;
  let resume: Resume;
  if (state.phase === 'live') {
    resume = { kind: 'inbound', team, spot: sidelineSpot(b.pos) };
  } else if (state.phase === 'freeThrow' && state.freeThrow) {
    const ft = state.freeThrow;
    resume = { kind: 'freeThrow', shooterId: ft.shooterId, total: ft.total, index: ft.index, after: ft.after };
  } else if (state.phase === 'inbound' && state.inbound) {
    resume = { kind: 'inbound', team: state.inbound.team, spot: state.inbound.spot };
  } else if (state.pendingFT) {
    const ft = state.pendingFT;
    resume = { kind: 'freeThrow', shooterId: ft.shooterId, total: ft.total, index: 0, after: ft.after };
  } else {
    resume = { kind: 'inbound', team: state.pendingInbound!.team, spot: state.pendingInbound!.spot };
  }
  // Late in the fourth quarter (and overtime) a timeout advances the ball to the frontcourt.
  if (resume.kind === 'inbound' && resume.team === team && state.period >= 4 && state.gameClock <= lateWindow(state)) {
    const s = Math.sign(attackHoop(state, team));
    if (s * resume.spot.x < COURT.halfLength - ADVANCE_LINE) {
      resume.spot = {
        x: s * (COURT.halfLength - ADVANCE_LINE),
        y: 0,
        z: Math.sign(resume.spot.z || 1) * (COURT.halfWidth + INBOUND_OFFSET),
      };
    }
  }

  state.timeoutsLeft[team]--;
  if (b.mode === 'held' || b.mode === 'loose') {
    b.mode = 'loose';
    b.holderId = -1;
    b.vel = { x: 0, y: 0, z: 0 };
  }
  state.shotClockOn = false;
  state.pendingFT = null;
  state.pendingInbound = null;
  state.freeThrow = null;
  state.inbound = null;
  state.run = { team, pts: 0 };
  for (const p of state.players) {
    p.vel = { x: 0, y: 0, z: 0 };
    p.action = 'normal';
    p.shotMeter = -1;
    p.intenseD = false;
    p.energy = Math.min(1, p.energy + 0.08);
  }
  state.phase = 'timeout';
  state.phaseTimer = 0;
  state.timeout = { team, timer: 0, limit: state.settings.humanTeams.length ? TIMEOUT_SECONDS : 3, resume, ready: [] };
  state.events.push({ type: 'timeout', team, left: state.timeoutsLeft[team] });
  applySubs(state);
}

function updateTimeout(state: GameState): void {
  const t = state.timeout!;
  t.timer += DT;
  const humans = state.settings.humanTeams;
  const allReady = humans.length > 0 && humans.every((h) => t.ready.includes(h));
  if (t.timer < t.limit && !allReady) return;
  state.timeout = null;
  state.events.push({ type: 'timeoutEnd' });
  const r = t.resume;
  if (r.kind === 'freeThrow') {
    startFreeThrows(state, r.shooterId, r.total, r.after, r.index);
  } else {
    startInbound(state, r.team, r.spot);
  }
}

/** AI coaches stop an opponent's run at the next dead ball. */
function maybeAiTimeout(state: GameState): boolean {
  for (const team of [0, 1] as const) {
    if (humanCoach(state, team) || state.timeoutsLeft[team] <= 1) continue;
    if (state.run.team !== team && state.run.pts >= 8 && canCallTimeout(state, team)) {
      callTimeout(state, team);
      return true;
    }
  }
  return false;
}
