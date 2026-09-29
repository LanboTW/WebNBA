import { BALL_RADIUS, COURT, DT, SHOT_CLOCK, attackHoopX, isInBounds } from './constants';
import { giveBall } from './ball';
import { choosePassTarget, hdist, releasePass } from './players';
import { nextRandom } from './rng';
import { NO_INPUT, type GameState, type PlayerState, type TurnoverReason, type Vec3 } from './types';

const INBOUND_OFFSET = 0.45;
const DEAD_BALL_SECONDS = 1.3;
const PERIOD_BREAK_SECONDS = 3;
/** A human inbounder who stalls gets an automatic pass (5-second violations come in stage 3). */
const INBOUND_AUTO_PASS = 5;

export function isHuman(state: GameState, team: 0 | 1): boolean {
  return state.settings.humanTeams.includes(team);
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
  state.events.push({ type: 'possession', team });
  const other = (1 - team) as 0 | 1;
  if (isHuman(state, other)) state.controlled[other] = nearestToBall(state, other).id;
}

/** Someone secured the ball (catch, rebound, recovery). */
export function onGainBall(state: GameState, p: PlayerState): void {
  if (isHuman(state, p.team)) state.controlled[p.team] = p.id;
  if (state.settings.mode !== 'game') return;
  setPossession(state, p.team);
  if (state.phase === 'live') state.shotClockOn = true;
}

export function onMadeBasket(state: GameState): void {
  const shot = state.ball.shot!;
  state.score[shot.team] += shot.points;
  const shooter = state.players[shot.shooterId];
  shooter.stats.pts += shot.points;
  shooter.stats.fgm++;
  if (shot.points === 3) shooter.stats.tpm++;
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
    swish: !shot.touchedRim,
    hoopX: shot.hoopX,
    assistId,
  });
  if (state.settings.mode !== 'game') return;
  state.shotClockOn = false;
  // A buzzer-beater is handled by the pending period end.
  if (state.pendingEnd) return;
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
      if (state.phaseTimer <= 0 && state.pendingInbound) {
        startInbound(state, state.pendingInbound.team, state.pendingInbound.spot);
        state.pendingInbound = null;
      }
      break;
    case 'inbound':
      updateInbound(state);
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
  state.gameClock -= DT;
  for (const p of state.players) p.stats.secs += DT;
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
    if (!isInBounds(h.pos.x, h.pos.z)) turnover(state, h.team, 'oob', inboundSpot(h.pos), h.id);
    return;
  }
  const onFloorOut = ball.pos.y <= BALL_RADIUS + 0.05 && !isInBounds(ball.pos.x, ball.pos.z);
  const intoStands =
    Math.abs(ball.pos.x) > COURT.halfLength + 2.8 || Math.abs(ball.pos.z) > COURT.halfWidth + 2.8;
  if ((onFloorOut || intoStands) && !ball.shot?.scored) {
    turnover(state, ball.lastTouchTeam, 'oob', inboundSpot(ball.pos));
  }
}

function turnover(state: GameState, team: 0 | 1, reason: TurnoverReason, spot: Vec3, playerId = -1): void {
  if (playerId >= 0) state.players[playerId].stats.tov++;
  state.events.push({ type: 'turnover', team, reason });
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
  setPossession(state, other);
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
  let passer: PlayerState | null = null;
  let bestD = Infinity;
  for (const p of state.players) {
    if (p.team !== team) continue;
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
  if (isHuman(state, team)) state.controlled[team] = passer.id;
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
  if (state.phaseTimer > INBOUND_AUTO_PASS) {
    const passer = state.players[inbound.passerId];
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
  state.inbound = null;
  for (const p of state.players) {
    p.vel = { x: 0, y: 0, z: 0 };
    p.pos.y = 0;
    p.onGround = true;
    p.action = 'normal';
    p.shotMeter = -1;
    p.ai.mode = 'none';
    p.ai.arrived = false;
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
    const back = -Math.sign(attackHoopX(p.team, state.period));
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
    state.phase = 'live';
    state.events.push({ type: 'tipoff' });
  }
}
