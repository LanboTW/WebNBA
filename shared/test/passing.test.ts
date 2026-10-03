import { describe, expect, it } from 'vitest';
import { BALL_RADIUS, HOOP, HOOP_X, NO_INPUT, createGame, giveBall, placePlayer, step, type GameState } from '../src';
import { releasePass } from '../src/players';
import { GSW, LAL } from './helpers';

function live(): GameState {
  const s = createGame({ teams: [GSW, LAL], settings: { seed: 2, humanTeams: [0] } });
  s.phase = 'live';
  s.possession = 0;
  // Defence far away so nothing gets in the way.
  for (const o of s.players.filter((p) => p.team === 1)) placePlayer(s, o.id, -12, o.slot * 2 - 4);
  return s;
}

describe('passing', () => {
  it('a pass follows a receiver who cut the other way', () => {
    const s = live();
    placePlayer(s, 0, 0, 0);
    placePlayer(s, 1, 6, 0);
    giveBall(s, 0);
    s.players[1].vel = { x: 0, y: 0, z: 4 }; // he looks to be going one way...
    releasePass(s, s.players[0], 1);
    s.players[1].vel = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 40 && s.ball.mode === 'pass'; i++) {
      placePlayer(s, 1, 6, -0.6); // ...but goes the other
      step(s, {});
    }
    expect(s.ball.mode).toBe('held');
    expect(s.ball.holderId).toBe(1);
  });

  it('cannot pass straight on in the instant of catching', () => {
    const s = live();
    placePlayer(s, 0, 0, 0);
    placePlayer(s, 1, 4, 0);
    giveBall(s, 1);
    s.players[1].catchHold = 0.3;
    s.controlled[0] = 1;
    step(s, { 0: { ...NO_INPUT, pass: true } });
    expect(s.ball.holderId).toBe(1);
    // ...but the press is remembered and the pass goes once he can.
    for (let i = 0; i < 12; i++) step(s, { 0: NO_INPUT });
    expect(s.ball.mode).toBe('pass');
  });

  it('a pass pressed while the ball is still coming goes on the catch (one-touch passing)', () => {
    const s = live();
    placePlayer(s, 0, 0, 0);
    placePlayer(s, 1, 5, 0);
    placePlayer(s, 2, 9, 3);
    giveBall(s, 0);
    s.controlled[0] = 1;
    releasePass(s, s.players[0], 1);
    step(s, { 0: { ...NO_INPUT, pass: true } });
    let relayed = false;
    for (let i = 0; i < 40 && !relayed; i++) {
      step(s, { 0: NO_INPUT });
      relayed = s.ball.mode === 'pass' && s.ball.pass?.passerId === 1;
    }
    expect(relayed).toBe(true);
  });
});

describe('passes to the player you control', () => {
  it('reach him wherever he runs or turns while the ball is in the air', () => {
    let seed = 7;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let caught = 0;
    const trials = 150;
    for (let t = 0; t < trials; t++) {
      const s = live();
      placePlayer(s, 0, 0, 0);
      placePlayer(s, 1, 3 + r() * 8, (r() - 0.5) * 10);
      giveBall(s, 0);
      s.controlled[0] = 1;
      const a = r() * Math.PI * 2;
      const sp = r() * 7;
      s.players[1].vel = { x: Math.cos(a) * sp, y: 0, z: Math.sin(a) * sp };
      releasePass(s, s.players[0], 1);
      // Running one way when it's thrown, then turning or stopping.
      const turnAt = Math.floor(r() * 10);
      const b = r() * Math.PI * 2;
      for (let i = 0; i < 90 && s.ball.mode === 'pass'; i++) {
        const move = i < turnAt ? { moveX: Math.cos(a), moveZ: Math.sin(a), sprint: true } : { moveX: Math.cos(b), moveZ: Math.sin(b) };
        step(s, { 0: { ...NO_INPUT, ...move } });
      }
      if (s.ball.mode === 'held' && s.ball.holderId === 1) caught++;
    }
    expect(caught).toBe(trials);
  });
});

describe('rim', () => {
  it('a ball resting on top of the rim rolls off instead of sitting there', () => {
    const s = live();
    const b = s.ball;
    b.mode = 'loose';
    b.holderId = -1;
    b.pos = { x: HOOP_X - HOOP.rimRadius, y: HOOP.rimHeight + BALL_RADIUS + HOOP.rimTube, z: 0 };
    b.vel = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) step(s, {});
    expect(b.pos.y).toBeLessThan(HOOP.rimHeight - 0.2);
    expect(s.score).toEqual([0, 0]);
  });
});
