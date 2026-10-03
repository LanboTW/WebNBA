import { COURT, DT, HOOP, attackHoop } from './constants';
import { giveBall } from './ball';
import { applySubs } from './bench';
import { isHuman, setPossession, sidelineSpot, turnover } from './rules';
import type { FoulKind, FreeThrowInfo, GameState, PlayerState, ShotInfo } from './types';

export const FOUL_OUT = 6;
/** Seconds after a foul before the free throws or the inbound. */
const WHISTLE_SECONDS = 1.2;
/** A fouled shot still in the air gets time to drop before the free throws. */
const FOULED_SHOT_SECONDS = 1.8;

/** Length of the "last two minutes" window, scaled to the configured quarter length. */
export function lateWindow(state: GameState): number {
  const full = state.period <= 4 ? 720 : 300;
  const len = state.period <= 4 ? state.settings.quarterSeconds : Math.max(60, Math.round((state.settings.quarterSeconds * 5) / 12));
  return Math.max(15, (120 * len) / full);
}

/** Penalty: from the 5th team foul of a quarter (4th in overtime), or the 2nd in the late window. */
export function inBonus(state: GameState, foulingTeam: 0 | 1): boolean {
  // Street: a foul only ever gives the ball back.
  if (state.settings.street) return false;
  const limit = state.period <= 4 ? 5 : 4;
  return state.teamFouls[foulingTeam] >= limit || state.lateFouls[foulingTeam] >= 2;
}

export function fouledOut(p: { stats: { pf: number } }): boolean {
  return p.stats.pf >= FOUL_OUT;
}

function record(state: GameState, fouler: PlayerState): void {
  fouler.stats.pf++;
  state.teamFouls[fouler.team]++;
  if (state.gameClock <= lateWindow(state)) state.lateFouls[fouler.team]++;
  if (fouledOut(fouler) && !state.settings.street) state.events.push({ type: 'fouledOut', team: fouler.team, name: fouler.info.name });
}

/** Whistle: the ball is dead where it is. A shot already in the air keeps flying. */
function stopPlay(state: GameState, seconds: number): void {
  const b = state.ball;
  if (b.mode === 'held' || b.mode === 'pass') {
    b.mode = 'loose';
    b.holderId = -1;
    b.pass = null;
    b.vel = { x: 0, y: 0, z: 0 };
  }
  for (const p of state.players) {
    if (p.action === 'shooting') {
      p.action = 'normal';
      p.shotMeter = -1;
    }
  }
  state.shotClockOn = false;
  state.phase = 'dead';
  state.phaseTimer = seconds;
  state.pendingInbound = null;
}

function enabled(state: GameState): boolean {
  return state.settings.rules.fouls && state.settings.mode === 'game' && state.phase === 'live';
}

/** Defender fouled a shooter: an and-one if it goes in, otherwise 2 or 3 free throws. */
export function shootingFoul(state: GameState, shot: ShotInfo, defender: PlayerState): void {
  if (!enabled(state) || shot.fouledBy >= 0 || shot.kind === 'free') return;
  shot.fouledBy = defender.id;
  record(state, defender);
  if (state.settings.street) return streetShootingFoul(state, shot, defender);
  const total = shot.willMake ? 1 : shot.points;
  state.events.push({
    type: 'foul',
    playerId: defender.id,
    team: defender.team,
    onId: shot.shooterId,
    kind: 'shooting',
    shots: total,
    fouls: state.teamFouls[defender.team],
    bonus: inBonus(state, defender.team),
  });
  stopPlay(state, FOULED_SHOT_SECONDS);
  state.pendingFT = { shooterId: shot.shooterId, total, after: null };
}

/**
 * Street: no free throws. A basket that falls counts and play goes on as after
 * any score; a miss gives the shooter's team the ball back with a check.
 */
function streetShootingFoul(state: GameState, shot: ShotInfo, defender: PlayerState): void {
  state.events.push({
    type: 'foul',
    playerId: defender.id,
    team: defender.team,
    onId: shot.shooterId,
    kind: 'shooting',
    shots: 0,
    fouls: state.teamFouls[defender.team],
    bonus: false,
  });
  if (shot.willMake) return;
  stopPlay(state, FOULED_SHOT_SECONDS);
  setPossession(state, shot.team);
  state.pendingInbound = { team: shot.team, spot: { x: 0, y: 0, z: 0 } };
}

/** Non-shooting defensive foul: side inbound, or two shots in the bonus. */
export function commonFoul(state: GameState, fouler: PlayerState, fouled: PlayerState, kind: FoulKind): void {
  if (!enabled(state)) return;
  record(state, fouler);
  const bonus = inBonus(state, fouler.team);
  state.events.push({
    type: 'foul',
    playerId: fouler.id,
    team: fouler.team,
    onId: fouled.id,
    kind,
    shots: bonus ? 2 : 0,
    fouls: state.teamFouls[fouler.team],
    bonus,
  });
  stopPlay(state, WHISTLE_SECONDS);
  setPossession(state, fouled.team);
  if (bonus) {
    state.pendingFT = { shooterId: fouled.id, total: 2, after: null };
  } else {
    state.pendingInbound = { team: fouled.team, spot: sidelineSpot(fouled.pos) };
    state.shotClock = Math.max(state.shotClock, 14);
  }
}

/** Offensive foul: turnover, no free throws. */
export function chargeFoul(state: GameState, handler: PlayerState, defender: PlayerState): void {
  if (!enabled(state)) return;
  record(state, handler);
  state.events.push({
    type: 'foul',
    playerId: handler.id,
    team: handler.team,
    onId: defender.id,
    kind: 'charge',
    shots: 0,
    fouls: state.teamFouls[handler.team],
    bonus: false,
  });
  turnover(state, handler.team, 'offFoul', sidelineSpot(handler.pos), handler.id);
}

/** Defensive three seconds: a technical. Best shooter on the floor takes one, then the offence inbounds. */
export function defensiveThree(state: GameState, defender: PlayerState): void {
  if (!enabled(state)) return;
  const offense = (1 - defender.team) as 0 | 1;
  const shooter = state.players
    .filter((p) => p.team === offense)
    .sort((a, b) => b.info.ratings.ft - a.info.ratings.ft)[0];
  if (!shooter) return;
  const spot = sidelineSpot(state.ball.pos);
  state.events.push({
    type: 'foul',
    playerId: defender.id,
    team: defender.team,
    onId: shooter.id,
    kind: 'defThree',
    shots: 1,
    fouls: state.teamFouls[defender.team],
    bonus: false,
  });
  stopPlay(state, WHISTLE_SECONDS);
  state.shotClock = Math.max(state.shotClock, 14);
  state.pendingFT = { shooterId: shooter.id, total: 1, after: { team: offense, spot } };
}

// ------------------------------------------------------------ free throws

const LANE_Z = COURT.keyWidth / 2 + 0.35;

export function startFreeThrows(
  state: GameState,
  shooterId: number,
  total: number,
  after: FreeThrowInfo['after'],
  index = 0,
): void {
  applySubs(state, [shooterId]);
  const shooter = state.players[shooterId];
  const hx = attackHoop(state, shooter.team);
  const s = Math.sign(hx);
  const L = COURT.halfLength;
  const lane = (d: number, side: number) => ({ x: s * (L - d), z: side * LANE_Z });

  const place = (p: PlayerState, x: number, z: number) => {
    p.pos = { x, y: 0, z };
    p.vel = { x: 0, y: 0, z: 0 };
    p.onGround = true;
    p.action = 'normal';
    p.shotMeter = -1;
    p.dribbleDead = false;
    p.ai.mode = 'none';
    p.facing = Math.atan2(hx - x, -z);
  };
  place(shooter, hx - s * (COURT.freeThrowFromBaseline - HOOP.fromBaseline), 0);
  // Defence takes the low blocks, offence the next spots up; everyone else waits behind the arc.
  const bySlot = (team: 0 | 1) =>
    state.players.filter((p) => p.team === team && p.id !== shooterId).sort((a, b) => b.slot - a.slot);
  const defense = bySlot((1 - shooter.team) as 0 | 1);
  const offense = bySlot(shooter.team);
  const laneSpots = [
    [defense[0], lane(2.2, 1)],
    [defense[1], lane(2.2, -1)],
    [offense[0], lane(3.1, 1)],
    [offense[1], lane(3.1, -1)],
    [defense[2], lane(4.0, 1)],
  ] as const;
  for (const [p, spot] of laneSpots) if (p) place(p, spot.x, spot.z);
  const rest = [...defense.slice(3), ...offense.slice(2)];
  rest.forEach((p, i) => place(p, hx - s * (8.4 + (i % 2) * 0.6), (i - (rest.length - 1) / 2) * 2.6));

  state.phase = 'freeThrow';
  state.phaseTimer = 0;
  state.inbound = null;
  state.pendingInbound = null;
  state.pendingFT = null;
  state.shotClockOn = false;
  state.freeThrow = { shooterId, team: shooter.team, hoopX: hx, total, index, timer: 0, released: false, after };
  setPossession(state, shooter.team);
  giveBall(state, shooterId);
  if (isHuman(state, shooter.team)) state.controlled[shooter.team] = shooterId;
  state.events.push({ type: 'freeThrow', shooterId, index, total });
}

/** Called as a free throw leaves the shooter's hand. */
export function onFreeThrowRelease(state: GameState): void {
  const ft = state.freeThrow;
  if (!ft) return;
  ft.released = true;
  ft.timer = 0;
  // Players may enter the lane on the release of the last one.
  if (ft.index >= ft.total - 1 && !ft.after) {
    state.freeThrow = null;
    state.phase = 'live';
    state.clockHold = true;
  }
}

export function updateFreeThrow(state: GameState): void {
  const ft = state.freeThrow;
  if (!ft) return;
  ft.timer += DT;
  if (!ft.released || ft.timer < 1.9) return;
  if (ft.index >= ft.total - 1) {
    // Technical: offence keeps the ball.
    state.freeThrow = null;
    state.phase = 'dead';
    state.phaseTimer = 0.4;
    state.pendingInbound = ft.after;
    return;
  }
  ft.index++;
  ft.released = false;
  ft.timer = 0;
  const shooter = state.players[ft.shooterId];
  shooter.pos = { x: ft.hoopX - Math.sign(ft.hoopX) * (COURT.freeThrowFromBaseline - HOOP.fromBaseline), y: 0, z: 0 };
  shooter.vel = { x: 0, y: 0, z: 0 };
  shooter.onGround = true;
  shooter.action = 'normal';
  giveBall(state, ft.shooterId);
  state.events.push({ type: 'freeThrow', shooterId: ft.shooterId, index: ft.index, total: ft.total });
}
