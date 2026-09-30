import { describe, expect, it } from 'vitest';
import {
  COURT,
  HOOP_X,
  NO_INPUT,
  SHOT_SWEET,
  attackHoopX,
  createGame,
  giveBall,
  gradeTiming,
  isThreePoint,
  makeChance,
  nextRandom,
  placePlayer,
  step,
  type GameState,
} from '../src';
import { GSW, LAL, liveGame, practice, run, shootAt } from './helpers';

const curry = GSW.players[0];

describe('roster', () => {
  it('loads 30 teams of 8 players with full ratings', () => {
    expect(LAL.players[2].name).toBe('LeBron James');
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
    expect(events).toContainEqual({ type: 'turnover', team: 0, reason: 'shotclock', playerId: 0 });
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

  it('passes toward the aimed direction', () => {
    const state = liveGame(0, 0);
    // Teammates on each side: +x, -x, +z, -z.
    placePlayer(state, 1, 5, 0);
    placePlayer(state, 2, -5, 0);
    placePlayer(state, 3, 0, 5);
    placePlayer(state, 4, 0, -5);
    const aims: [number, number, number][] = [
      [1, 0, 1],
      [-1, 0, 2],
      [0, 1, 3],
      [0, -1, 4],
    ];
    for (const [moveX, moveZ, expected] of aims) {
      const s = structuredClone(state);
      step(s, { 0: { ...NO_INPUT, moveX, moveZ, pass: true } });
      expect(s.ball.pass?.targetId ?? s.ball.pass).toBe(expected);
    }
  });

  it('passes to the nearest teammate when no direction is held', () => {
    const state = liveGame(0, 0);
    placePlayer(state, 1, 6, 0);
    placePlayer(state, 2, -3, 1);
    placePlayer(state, 3, 0, 7);
    placePlayer(state, 4, -8, -5);
    step(state, { 0: { ...NO_INPUT, pass: true } });
    expect(state.ball.pass?.targetId).toBe(2);
  });

  it('jumping with the ball kills the dribble: no moving after landing, passing still allowed', () => {
    const state = liveGame(0, 0);
    run(state, 1, { ...NO_INPUT, jump: true });
    expect(state.players[0].dribbleDead).toBe(true);
    const events = run(state, 30);
    expect(events).toContainEqual({ type: 'deadDribble', playerId: 0 });
    const start = { ...state.players[0].pos };
    run(state, 30, { ...NO_INPUT, moveX: 1, sprint: true });
    expect(Math.hypot(state.players[0].pos.x - start.x, state.players[0].pos.z - start.z)).toBeLessThan(0.05);
    expect(events.some((e) => e.type === 'dribble')).toBe(false);
    step(state, { 0: { ...NO_INPUT, pass: true } });
    expect(state.ball.mode).toBe('pass');
    expect(state.players[0].dribbleDead).toBe(false);
  });

  it('can pass in mid-air after jumping with the ball', () => {
    const state = liveGame(0, 0);
    run(state, 6, { ...NO_INPUT, jump: true });
    expect(state.players[0].onGround).toBe(false);
    step(state, { 0: { ...NO_INPUT, pass: true } });
    expect(state.ball.mode).toBe('pass');
  });

  it('intense defence slides the defender between the ball handler and the rim', () => {
    const state = createGame({ teams: [GSW, LAL], settings: { seed: 1, humanTeams: [0] } });
    state.phase = 'live';
    state.possession = 1;
    giveBall(state, 5);
    placePlayer(state, 5, 4, 2);
    state.controlled[0] = 0;
    placePlayer(state, 0, 1, -2);
    // Team 1 attacks the -x hoop in the first half; hold still so the handler stays put.
    for (let i = 0; i < 45; i++) {
      state.players[5].pos = { x: 4, y: 0, z: 2 };
      state.players[5].vel = { x: 0, y: 0, z: 0 };
      step(state, { 0: { ...NO_INPUT, intenseD: true } });
    }
    const d = state.players[0];
    const h = state.players[5];
    const hoop = { x: attackHoopX(1, 1), z: 0 };
    expect(d.intenseD).toBe(true);
    expect(Math.hypot(d.pos.x - h.pos.x, d.pos.z - h.pos.z)).toBeLessThan(1.3);
    // Defender is closer to the rim than the handler.
    expect(Math.hypot(d.pos.x - hoop.x, d.pos.z)).toBeLessThan(Math.hypot(h.pos.x - hoop.x, h.pos.z));
  });

  it('icon-passes to an explicit teammate and ignores invalid targets', () => {
    const state = liveGame(0, 0);
    placePlayer(state, 3, 5, 3);
    const toMate = structuredClone(state);
    step(toMate, { 0: { ...NO_INPUT, pass: true, passTarget: 3 } });
    expect(toMate.ball.pass?.targetId).toBe(3);

    // An opponent id must never be honoured as a pass target.
    const toOpponent = structuredClone(state);
    step(toOpponent, { 0: { ...NO_INPUT, pass: true, passTarget: 7 } });
    const target = toOpponent.ball.pass?.targetId ?? -1;
    expect(toOpponent.players[target].team).toBe(0);
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
      const players = [...state.players.filter((p) => p.team === team), ...state.bench[team]];
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
