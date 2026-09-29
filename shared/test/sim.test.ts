import { describe, expect, it } from 'vitest';
import {
  COURT,
  HOOP_X,
  NO_INPUT,
  SHOT_SWEET,
  attackHoopX,
  createGame,
  findTeam,
  giveBall,
  gradeTiming,
  isThreePoint,
  makeChance,
  nextRandom,
  placePlayer,
  step,
  type GameEvent,
  type GameState,
  type PlayerInput,
} from '../src';

const GSW = findTeam('GSW');
const LAL = findTeam('LAL');
const curry = GSW.players[0];

function practice(x: number, z: number, seed = 1): GameState {
  const state = createGame({
    teams: [GSW, LAL],
    settings: { mode: 'practice', seed, humanTeams: [0] },
    playersPerTeam: [1, 0],
  });
  placePlayer(state, 0, x, z);
  return state;
}

/** Holds shoot until the meter reaches `meter`, then lets the ball fly for a few seconds. */
function shootAt(state: GameState, meter: number, ticksAfter = 150): GameEvent[] {
  const events: GameEvent[] = [];
  const hold: PlayerInput = { ...NO_INPUT, shoot: true };
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

function run(state: GameState, ticks: number, input: PlayerInput = NO_INPUT): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    step(state, { 0: input });
    events.push(...state.events);
  }
  return events;
}

/** A live 5v5 game with team 0's player 0 holding the ball at (x, z). */
function liveGame(x: number, z: number, seed = 1): GameState {
  const state = createGame({ teams: [GSW, LAL], settings: { seed, humanTeams: [0] } });
  state.phase = 'live';
  state.possession = 0;
  state.shotClockOn = true;
  giveBall(state, 0);
  state.controlled[0] = 0;
  placePlayer(state, 0, x, z);
  // Park the defence well away so drills are uncontested.
  state.players.filter((p) => p.team === 1).forEach((p, i) => placePlayer(state, p.id, -12, -6 + i * 3));
  return state;
}

describe('roster', () => {
  it('loads 30 teams of 8 players with full ratings', () => {
    expect(findTeam('LAL').players[2].name).toBe('LeBron James');
    expect(Object.keys(curry.ratings)).toHaveLength(13);
  });
});

describe('court geometry', () => {
  it('classifies corners and the arc', () => {
    expect(isThreePoint(HOOP_X, 6.8, HOOP_X)).toBe(true);
    expect(isThreePoint(HOOP_X, 6.5, HOOP_X)).toBe(false);
    expect(isThreePoint(HOOP_X - 7.3, 0, HOOP_X)).toBe(true);
    expect(isThreePoint(HOOP_X - 7.0, 0, HOOP_X)).toBe(false);
  });

  it('switches ends at halftime', () => {
    expect(attackHoopX(0, 1)).toBe(HOOP_X);
    expect(attackHoopX(0, 3)).toBe(-HOOP_X);
    expect(attackHoopX(1, 5)).toBe(HOOP_X);
  });
});

describe('shot model', () => {
  it('grades the meter', () => {
    expect(gradeTiming(SHOT_SWEET).quality).toBe('perfect');
    expect(gradeTiming(SHOT_SWEET - 0.08).quality).toBe('good');
    expect(gradeTiming(0.3).quality).toBe('early');
    expect(gradeTiming(1.1).quality).toBe('late');
  });

  it('rewards timing and punishes contests', () => {
    const r = curry.ratings;
    const perfect = makeChance(r, 7.5, true, false, SHOT_SWEET);
    expect(perfect).toBeGreaterThan(makeChance(r, 7.5, true, false, 0.3));
    expect(makeChance(r, 7.5, true, false, SHOT_SWEET, 1)).toBeLessThan(perfect * 0.6);
  });

  it('rng is deterministic for a seed', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    expect([nextRandom(a), nextRandom(a)]).toEqual([nextRandom(b), nextRandom(b)]);
  });
});

describe('practice shooting', () => {
  it('scores a perfectly timed mid-range jumper for most seeds', () => {
    let makes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = practice(HOOP_X - 4, 0, seed);
      if (shootAt(state, SHOT_SWEET).some((e) => e.type === 'score')) makes++;
    }
    expect(makes).toBeGreaterThanOrEqual(16);
  });

  it('awards three points from beyond the arc', () => {
    let threes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = practice(HOOP_X - 8, 0, seed);
      const score = shootAt(state, SHOT_SWEET).find((e) => e.type === 'score');
      expect(state.players[0].stats.tpa).toBe(1);
      if (score?.type === 'score') {
        expect(score.points).toBe(3);
        threes++;
      }
    }
    expect(threes).toBeGreaterThan(10);
  });

  it('is deterministic for identical inputs', () => {
    const a = practice(HOOP_X - 6, 1, 7);
    const b = practice(HOOP_X - 6, 1, 7);
    shootAt(a, 0.8);
    shootAt(b, 0.8);
    expect(a.ball.pos).toEqual(b.ball.pos);
    expect(a.score).toEqual(b.score);
  });
});

describe('game rules', () => {
  it('gives the ball to the other team via a baseline inbound after a make', () => {
    let checked = false;
    for (let seed = 1; seed <= 10 && !checked; seed++) {
      const state = liveGame(HOOP_X - 1, 0.3, seed);
      const events = shootAt(state, SHOT_SWEET, 20);
      if (!events.some((e) => e.type === 'score')) continue;
      expect(state.possession).toBe(1);
      run(state, 40);
      expect(state.phase).toBe('inbound');
      expect(state.inbound?.team).toBe(1);
      expect(Math.abs(state.inbound!.spot.x)).toBeGreaterThan(COURT.halfLength);
      run(state, 60);
      expect(state.phase).toBe('live');
      checked = true;
    }
    expect(checked).toBe(true);
  });

  it('calls a shot-clock violation', () => {
    const state = liveGame(-3, 0);
    state.shotClock = 0.5;
    const events = run(state, 30);
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'shotclock' });
    expect(state.possession).toBe(1);
    expect(state.players[0].stats.tov).toBe(1);
  });

  it('calls the ball handler out of bounds', () => {
    const state = liveGame(-3, 6.5);
    const events = run(state, 40, { ...NO_INPUT, moveZ: 1 });
    expect(events.some((e) => e.type === 'turnover' && e.reason === 'oob')).toBe(true);
    expect(state.possession).toBe(1);
    for (let i = 0; i < 60 && state.phase !== 'inbound'; i++) run(state, 1);
    expect(state.inbound?.team).toBe(1);
    expect(Math.abs(state.inbound!.spot.z)).toBeGreaterThan(COURT.halfWidth);
  });

  it('does not release a shot that was still gathering at the buzzer', () => {
    const state = liveGame(HOOP_X - 5, 0);
    state.gameClock = 0.2;
    const events = run(state, 12, { ...NO_INPUT, shoot: true });
    expect(events).toContainEqual({ type: 'periodEnd', period: 1 });
    expect(events.some((e) => e.type === 'shot')).toBe(false);
    expect(state.players[0].action).toBe('normal');
  });

  it('ends the quarter and starts the next with an inbound', () => {
    const state = liveGame(-3, 0);
    state.gameClock = 0.1;
    const events = run(state, 10);
    expect(events).toContainEqual({ type: 'periodEnd', period: 1 });
    expect(state.phase).toBe('periodEnd');
    run(state, 95);
    expect(state.period).toBe(2);
    expect(state.phase).toBe('inbound');
    expect(state.inbound?.team).toBe(1 - state.tipWinner);
  });
});

describe('full AI game', () => {
  function playFull(seed: number): GameState {
    const state = createGame({
      teams: [GSW, LAL],
      settings: { seed, humanTeams: [], quarterSeconds: 120 },
    });
    for (let i = 0; i < 30 * 60 * 20 && state.phase !== 'final'; i++) step(state, {});
    return state;
  }

  it('plays four quarters to a final with consistent stats', () => {
    const state = playFull(3);
    expect(state.phase).toBe('final');
    expect(state.period).toBeGreaterThanOrEqual(4);
    expect(state.score[0]).not.toBe(state.score[1]);
    for (const team of [0, 1] as const) {
      const players = state.players.filter((p) => p.team === team);
      const pts = players.reduce((s, p) => s + p.stats.pts, 0);
      expect(pts).toBe(state.score[team]);
      expect(state.score[team]).toBeGreaterThan(4);
      expect(players.reduce((s, p) => s + p.stats.fga, 0)).toBeGreaterThan(5);
    }
    for (const p of state.players) {
      expect(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z)).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    const a = playFull(9);
    const b = playFull(9);
    expect(a.score).toEqual(b.score);
    expect(a.tick).toBe(b.tick);
  });
});
