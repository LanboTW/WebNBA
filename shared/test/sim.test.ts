import { describe, expect, it } from 'vitest';
import {
  HOOP_X,
  NO_INPUT,
  SAMPLE_TEAMS,
  SHOT_SWEET,
  createGame,
  gradeTiming,
  isThreePoint,
  makeChance,
  nextRandom,
  step,
  type GameEvent,
  type GameState,
  type PlayerInput,
} from '../src';

const curry = SAMPLE_TEAMS[0].players[0];

function soloGame(x: number, z: number, seed = 1): GameState {
  return createGame({ players: [{ info: curry, team: 0, pos: { x, z } }], seed, ballHolder: 0 });
}

/** Holds shoot until the meter reaches `meter`, then lets the ball fly for a few seconds. */
function shootAt(state: GameState, meter: number): GameEvent[] {
  const events: GameEvent[] = [];
  const hold: PlayerInput = { ...NO_INPUT, shoot: true };
  step(state, { 0: hold });
  while (state.players[0].action === 'shooting' && state.players[0].shotMeter < meter) {
    step(state, { 0: hold });
  }
  for (let i = 0; i < 150; i++) {
    step(state, { 0: NO_INPUT });
    events.push(...state.events);
  }
  return events;
}

describe('three point line', () => {
  it('classifies corners and the arc', () => {
    expect(isThreePoint(HOOP_X, 6.8, HOOP_X)).toBe(true);
    expect(isThreePoint(HOOP_X, 6.5, HOOP_X)).toBe(false);
    expect(isThreePoint(HOOP_X - 7.3, 0, HOOP_X)).toBe(true);
    expect(isThreePoint(HOOP_X - 7.0, 0, HOOP_X)).toBe(false);
  });
});

describe('shot timing', () => {
  it('grades the meter', () => {
    expect(gradeTiming(SHOT_SWEET).quality).toBe('perfect');
    expect(gradeTiming(SHOT_SWEET - 0.08).quality).toBe('good');
    expect(gradeTiming(0.3).quality).toBe('early');
    expect(gradeTiming(1.1).quality).toBe('late');
  });

  it('rewards good timing and punishes bad timing', () => {
    const r = curry.ratings;
    const perfect = makeChance(r, 7.5, true, false, SHOT_SWEET);
    const early = makeChance(r, 7.5, true, false, 0.3);
    expect(perfect).toBeGreaterThan(early);
    expect(makeChance(r, 1, false, true, SHOT_SWEET)).toBeGreaterThan(perfect);
  });
});

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = { rng: 42 };
    const b = { rng: 42 };
    expect([nextRandom(a), nextRandom(a)]).toEqual([nextRandom(b), nextRandom(b)]);
  });
});

describe('simulation', () => {
  it('scores a perfectly timed close-range jumper for most seeds', () => {
    let makes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = soloGame(HOOP_X - 4, 0, seed);
      const events = shootAt(state, SHOT_SWEET);
      if (events.some((e) => e.type === 'score')) {
        makes++;
        expect(state.score[0]).toBe(2);
      }
    }
    expect(makes).toBeGreaterThanOrEqual(16);
  });

  it('awards three points from beyond the arc and records attempts', () => {
    let threes = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const state = soloGame(HOOP_X - 8, 0, seed);
      const events = shootAt(state, SHOT_SWEET);
      const p = state.players[0];
      expect(p.stats.fga).toBe(1);
      expect(p.stats.tpa).toBe(1);
      const score = events.find((e) => e.type === 'score');
      if (score && score.type === 'score') {
        expect(score.points).toBe(3);
        threes++;
      }
    }
    expect(threes).toBeGreaterThan(10);
  });

  it('never scores a shot the roll decided was a miss', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const state = soloGame(HOOP_X - 6, 2, seed);
      const events = shootAt(state, 0.2);
      const shot = events.find((e) => e.type === 'shot');
      const scored = events.some((e) => e.type === 'score');
      expect(shot).toBeDefined();
      if (scored) expect(state.score[0]).toBe(2);
      else expect(state.score[0]).toBe(0);
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = soloGame(HOOP_X - 6, 1, 7);
    const b = soloGame(HOOP_X - 6, 1, 7);
    shootAt(a, 0.8);
    shootAt(b, 0.8);
    expect(a.ball.pos).toEqual(b.ball.pos);
    expect(a.score).toEqual(b.score);
  });

  it('lets the shooter rebound a miss after the ball settles', () => {
    const state = soloGame(HOOP_X - 6, 0, 3);
    shootAt(state, 0.1);
    // Walk to the ball wherever it came to rest.
    for (let i = 0; i < 600 && state.ball.mode !== 'held'; i++) {
      const p = state.players[0];
      const dx = state.ball.pos.x - p.pos.x;
      const dz = state.ball.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      step(state, { 0: { ...NO_INPUT, moveX: dx / d, moveZ: dz / d } });
    }
    expect(state.ball.mode).toBe('held');
  });
});
