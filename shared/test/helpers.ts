import {
  NO_INPUT,
  createGame,
  findTeam,
  giveBall,
  placePlayer,
  step,
  type GameEvent,
  type GameSettings,
  type GameState,
  type PlayerInput,
} from '../src';

export const GSW = findTeam('GSW');
export const LAL = findTeam('LAL');

export function practice(x: number, z: number, seed = 1): GameState {
  const state = createGame({
    teams: [GSW, LAL],
    settings: { mode: 'practice', seed, humanTeams: [0] },
    playersPerTeam: [1, 0],
  });
  placePlayer(state, 0, x, z);
  return state;
}

/** Holds shoot until the meter reaches `meter`, then lets the ball fly for a few seconds. */
export function shootAt(state: GameState, meter: number, ticksAfter = 150, extra: Partial<PlayerInput> = {}): GameEvent[] {
  const events: GameEvent[] = [];
  const hold: PlayerInput = { ...NO_INPUT, ...extra, shoot: true };
  const me = () => state.players[state.controlled[0]];
  step(state, { 0: hold });
  events.push(...state.events);
  while (me().action === 'shooting' && me().shotMeter < meter) {
    step(state, { 0: hold });
    events.push(...state.events);
  }
  for (let i = 0; i < ticksAfter; i++) {
    step(state, { 0: NO_INPUT });
    events.push(...state.events);
  }
  return events;
}

export function run(state: GameState, ticks: number, input: PlayerInput = NO_INPUT, input1?: PlayerInput): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(state, input1 ? { 0: input, 1: input1 } : { 0: input });
    events.push(...state.events);
  }
  return events;
}

/** A live 5v5 game with team 0's player 0 holding the ball at (x, z). */
export function liveGame(x: number, z: number, seed = 1, settings: Partial<GameSettings> = {}, teams = [GSW, LAL] as const): GameState {
  const state = createGame({ teams: [teams[0], teams[1]], settings: { seed, humanTeams: [0], ...settings } });
  state.phase = 'live';
  state.possession = 0;
  state.shotClockOn = true;
  giveBall(state, 0);
  state.controlled[0] = 0;
  placePlayer(state, 0, x, z);
  // Spread teammates out so a pass is never caught on the tick it is thrown.
  [
    [-9, -5],
    [-9, 5],
    [-6, -2.5],
    [-6, 2.5],
  ].forEach(([tx, tz], i) => placePlayer(state, i + 1, tx, tz));
  // Park the defence well away so drills are uncontested.
  state.players.filter((p) => p.team === 1).forEach((p, i) => placePlayer(state, p.id, -12, -6 + i * 3));
  return state;
}
