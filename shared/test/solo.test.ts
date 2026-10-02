import { describe, expect, it } from 'vitest';
import { NO_INPUT, createGame, giveBall, placePlayer, playOut, step, type GameEvent, type GameState, type PlayerInput } from '../src';
import { GSW, LAL } from './helpers';

/** A live solo game: you are GSW's roster player `me`, everyone else is AI. */
function soloGame(me = 0): GameState {
  const state = createGame({ teams: [GSW, LAL], settings: { seed: 3, humanTeams: [0], solo: me, quarterSeconds: 720 } });
  state.phase = 'live';
  state.possession = 0;
  state.frontcourt = true;
  return state;
}

function tick(state: GameState, inp: Partial<PlayerInput> = {}, n = 1): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(state, { 0: { ...NO_INPUT, ...inp } });
    events.push(...state.events);
  }
  return events;
}

const meId = (s: GameState, me = 0) => s.players.find((p) => p.team === 0 && p.rosterIdx === me)!.id;

describe('solo games', () => {
  it('keeps control on your player when a teammate gets the ball', () => {
    const s = soloGame(0);
    giveBall(s, 2);
    tick(s);
    expect(s.controlled[0]).toBe(meId(s));
  });

  it('a teammate passes to you when you call for the ball', () => {
    const s = soloGame(0);
    placePlayer(s, 2, 8, 2);
    placePlayer(s, 0, 7, -3);
    for (const o of s.players.filter((p) => p.team === 1)) placePlayer(s, o.id, -10, o.slot * 2 - 4);
    giveBall(s, 2);
    const events = tick(s, { pass: true });
    expect(events.some((e) => e.type === 'call' && e.kind === 'ball')).toBe(true);
    tick(s, {}, 45);
    expect(s.ball.mode === 'held' ? s.ball.holderId : -1).toBe(meId(s));
  });

  it('calling a pick sends a teammate to screen', () => {
    const s = soloGame(0);
    giveBall(s, 0);
    const events = tick(s, { switchPlayer: true });
    const call = events.find((e) => e.type === 'call');
    expect(call).toMatchObject({ kind: 'pick', ok: true });
    expect(s.players.some((p) => p.team === 0 && p.ai.mode === 'screen')).toBe(true);
  });

  it('calling a switch trades men with a teammate', () => {
    const s = soloGame(0);
    const me = meId(s);
    const before = s.assign[me];
    giveBall(s, 5);
    // Put my teammate's man right next to me.
    const mate = s.players.find((p) => p.team === 0 && p.id !== me)!;
    const hisMan = s.assign[mate.id];
    placePlayer(s, me, 0, 0);
    placePlayer(s, hisMan, 1, 0);
    const events = tick(s, { switchPlayer: true });
    expect(events.find((e) => e.type === 'call')).toMatchObject({ kind: 'switch' });
    expect(s.assign[me]).not.toBe(before);
    // Whoever I switched with now has my old man.
    expect(s.players.some((p) => p.team === 0 && p.id !== me && s.assign[p.id] === before)).toBe(true);
  });

  it('a player on the bench controls nobody, and you cannot call timeouts', () => {
    const s = soloGame(7); // eighth man: starts on the bench
    tick(s, { timeout: true });
    expect(s.controlled[0]).toBe(-1);
    expect(s.phase).not.toBe('timeout');
  });
});

describe('leaving a solo game', () => {
  it('the computer plays your player for the rest of the game', () => {
    const s = soloGame(0);
    s.settings.quarterSeconds = 60;
    s.gameClock = 60;
    tick(s, {}, 30);
    playOut(s);
    expect(s.phase).toBe('final');
    expect(s.settings.solo).toBeUndefined();
    // An idle player would gift the other team everything; the AI keeps it a game.
    expect(Math.abs(s.score[0] - s.score[1])).toBeLessThan(40);
  });
});
