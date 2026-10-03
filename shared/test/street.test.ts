import { describe, expect, it } from 'vitest';
import { CHECK_X, HOOP_X, NO_INPUT, createGame, step, type GameEvent, type GameState, type TeamInfo } from '../src';
import { GSW, LAL } from './helpers';

function street(n: number, seed = 1, target = 21, makeItTakeIt = false, humans: (0 | 1)[] = []): GameState {
  const pick = (t: TeamInfo, abbr: string): TeamInfo => ({ ...t, abbr, players: t.players.slice(0, n) });
  return createGame({
    teams: [pick(GSW, 'S1'), pick(LAL, 'S2')],
    settings: { seed, humanTeams: humans, street: { target, makeItTakeIt }, rules: { fouls: true, violations: true, fatigue: false } },
    playersPerTeam: [n, n],
  });
}

function playOut(s: GameState, maxTicks = 30 * 60 * 30): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < maxTicks && s.phase !== 'final'; i++) {
    step(s, {});
    events.push(...s.events);
  }
  return events;
}

describe('street games', () => {
  it('starts with a check at the top of the key, no clocks running', () => {
    const s = street(3);
    const holder = s.players[s.ball.holderId];
    expect(holder.pos.x).toBeCloseTo(CHECK_X);
    expect(s.frontcourt).toBe(true);
    const clock = s.gameClock;
    for (let i = 0; i < 120; i++) step(s, {});
    expect(s.gameClock).toBe(clock);
  });

  for (const n of [1, 2, 3]) {
    it(`${n}v${n} plays to 21 at one hoop, with 1s and 2s and no free throws`, () => {
      const s = street(n, n * 7);
      const events = playOut(s);
      expect(s.phase).toBe('final');
      expect(Math.max(...s.score)).toBeGreaterThanOrEqual(21);
      expect(Math.max(...s.score)).toBeLessThanOrEqual(22);
      const scores = events.filter((e) => e.type === 'score');
      expect(scores.every((e) => e.type === 'score' && e.hoopX === HOOP_X && (e.points === 1 || e.points === 2))).toBe(true);
      expect(events.some((e) => e.type === 'freeThrow')).toBe(false);
      expect(events.some((e) => e.type === 'timeout')).toBe(false);
      // Nobody ever played in the other half.
      expect(s.players.every((p) => p.pos.x > -1.3)).toBe(true);
    });
  }

  it('the other team checks after a score, unless make-it-take-it', () => {
    for (const mitt of [false, true]) {
      const s = street(2, 5, 11, mitt);
      let checked = 0;
      for (let i = 0; i < 30 * 60 * 10 && s.phase !== 'final' && checked < 5; i++) {
        step(s, {});
        const score = s.events.find((e) => e.type === 'score');
        if (!score || score.type !== 'score') continue;
        // Wait for the check.
        const phase = (): string => s.phase;
        while (!(phase() === 'live' && s.ball.mode === 'held') && phase() !== 'final') step(s, {});
        if (phase() === 'final') break;
        expect(s.players[s.ball.holderId].team).toBe(mitt ? score.team : 1 - score.team);
        expect(s.players[s.ball.holderId].pos.x).toBeCloseTo(CHECK_X);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  it('a basket without clearing the ball does not count', () => {
    const s = street(1, 3, 21, false, [0]);
    // Let the check settle, then hand team 0 a fresh, uncleared possession near the rim.
    while (s.phase !== 'live') step(s, { 0: NO_INPUT });
    const me = s.players.find((p) => p.team === 0)!;
    const them = s.players.find((p) => p.team === 1)!;
    them.pos = { x: 0, y: 0, z: 6 };
    me.pos = { x: HOOP_X - 1, y: 0, z: 0 };
    s.ball.holderId = me.id;
    s.possession = 0;
    s.frontcourt = false;
    s.controlled[0] = me.id;
    // A layup that drops.
    const events: GameEvent[] = [];
    for (let i = 0; i < 120; i++) {
      step(s, { 0: { ...NO_INPUT, shoot: i < 12 } });
      events.push(...s.events);
    }
    const made = events.find((e) => e.type === 'turnover' && e.reason === 'noClear');
    const scored = events.find((e) => e.type === 'score');
    // Either it missed, or it went in and was waved off.
    if (made) expect(s.score[0]).toBe(0);
    if (scored) expect(made).toBeTruthy();
  });
});
