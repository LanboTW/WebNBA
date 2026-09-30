import { describe, expect, it } from 'vitest';
import {
  NO_INPUT,
  createGame,
  decodeState,
  encodeState,
  normaliseRoomCode,
  randomRoomCode,
  setHuman,
  step,
  type PlayerInput,
} from '../src';
import { GSW, LAL } from './helpers';

const teams: [typeof GSW, typeof LAL] = [GSW, LAL];
const drive = (t: number): PlayerInput => ({ ...NO_INPUT, moveX: Math.sin(t / 20), moveZ: Math.cos(t / 33), sprint: t % 90 < 40, shoot: t % 150 > 130 });

describe('network state', () => {
  it('a decoded snapshot steps exactly like the original', () => {
    const a = createGame({ teams, settings: { humanTeams: [0, 1], seed: 42, quarterSeconds: 60 } });
    for (let t = 0; t < 900; t++) step(a, { 0: drive(t), 1: drive(t + 50) });
    const b = decodeState(encodeState(a), teams);
    expect(b.players[3].info).toBe(a.players[3].info);
    expect(b.bench[1][0].info).toBe(a.bench[1][0].info);
    for (let t = 900; t < 1800; t++) {
      step(a, { 0: drive(t), 1: drive(t + 50) });
      step(b, { 0: drive(t), 1: drive(t + 50) });
    }
    expect(encodeState(b)).toBe(encodeState(a));
  });

  it('snapshots stay small enough for 20 Hz', () => {
    const a = createGame({ teams, settings: { humanTeams: [0, 1], seed: 1 } });
    for (let t = 0; t < 600; t++) step(a, { 0: drive(t), 1: drive(t) });
    expect(encodeState(a).length).toBeLessThan(16000);
  });

  it('hands a team to the AI and back', () => {
    const s = createGame({ teams, settings: { humanTeams: [0, 1], seed: 3 } });
    setHuman(s, 1, false);
    expect(s.settings.humanTeams).toEqual([0]);
    expect(s.controlled[1]).toBe(-1);
    for (let t = 0; t < 300; t++) step(s, { 0: NO_INPUT, 1: { ...NO_INPUT, moveX: 1 } });
    setHuman(s, 1, true);
    expect(s.settings.humanTeams).toEqual([0, 1]);
    expect(s.players[s.controlled[1]].team).toBe(1);
  });

  it('room codes avoid look-alike characters', () => {
    const code = randomRoomCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(normaliseRoomCode(' ab-c12 3x ')).toBe('ABC123');
  });
});
