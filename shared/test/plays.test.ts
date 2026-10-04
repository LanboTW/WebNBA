import { describe, expect, it } from 'vitest';
import {
  NO_INPUT,
  PLAY_KINDS,
  attackHoop,
  createGame,
  giveBall,
  placePlayer,
  screenCatch,
  screenCaught,
  setupWait,
  startPlay,
  step,
  type GameState,
  type PlayKind,
} from '../src';
import { GSW, LAL } from './helpers';

/** A live half-court possession: team 0's point guard has the ball at the top, everyone in place. */
function halfCourt(seed: number, settings: Partial<GameState['settings']> = {}): GameState {
  const state = createGame({ teams: [GSW, LAL], settings: { seed, humanTeams: [], quarterSeconds: 720, ...settings } });
  state.phase = 'live';
  state.possession = 0;
  state.frontcourt = true;
  state.shotClock = 24;
  const hx = attackHoop(state, 0);
  const s = Math.sign(hx);
  const spots: [number, number][] = [
    [8, 0],
    [6, 5.5],
    [6, -5.5],
    [3, 3.5],
    [2, -2.5],
  ];
  for (const p of state.players) {
    const [a, z] = spots[p.slot];
    // Defenders a step toward the rim from their man.
    placePlayer(state, p.id, hx - s * (p.team === 0 ? a : a - 1), z * (p.team === 0 ? 1 : 0.9));
  }
  giveBall(state, state.players.find((p) => p.team === 0 && p.slot === 0)!.id);
  return state;
}

function run(state: GameState, ticks: number, until: (s: GameState) => boolean = () => false): void {
  for (let i = 0; i < ticks && !until(state); i++) step(state, {});
}

describe('plays', () => {
  it('cohesion sets the screen catch and the screener’s start', () => {
    expect(screenCatch(30)).toBeCloseTo(0.35);
    expect(screenCatch(100)).toBeCloseTo(0.75);
    expect(screenCatch(0)).toBeGreaterThanOrEqual(0.2);
    expect(setupWait(100)).toBe(0);
    expect(setupWait(30)).toBeGreaterThan(0.5);
  });

  it('screens catch defenders more often with more cohesion', () => {
    const rate = (c: number) => {
      const s = halfCourt(1, { cohesion: [c, 70] });
      const screener = s.players.find((p) => p.team === 0 && p.slot === 4)!;
      const victim = s.players.find((p) => p.team === 1 && p.slot === 0)!;
      placePlayer(s, victim.id, screener.pos.x, screener.pos.z + 0.8);
      let n = 0;
      for (let i = 0; i < 2000; i++) {
        s.events = [];
        if (screenCaught(s, screener, victim)) n++;
      }
      return n / 2000;
    };
    const low = rate(20);
    const high = rate(100);
    expect(low).toBeLessThan(0.36);
    expect(high).toBeGreaterThan(0.68);
  });

  it('each play gives out its parts', () => {
    const want: Record<PlayKind, (s: GameState) => boolean> = {
      pnr: (s) => s.players[s.plays[0]!.screenerId].ai.mode === 'screen',
      pnp: (s) => s.players[s.plays[0]!.screenerId].ai.mode === 'screen',
      handoff: (s) => s.players[s.plays[0]!.targetId].ai.mode === 'handoff',
      offscreen: (s) => s.players[s.plays[0]!.targetId].ai.mode === 'curl' && s.plays[0]!.screenerId >= 0,
      post: (s) => s.players[s.plays[0]!.targetId].ai.mode === 'post',
    };
    for (const kind of PLAY_KINDS) {
      const s = halfCourt(2);
      expect(startPlay(s, 0, kind)).toBe(true);
      expect(s.plays[0]!.kind).toBe(kind);
      expect(want[kind](s)).toBe(true);
    }
  });

  it('handoffs, screens for shooters and post-ups get the ball to their man', () => {
    for (const kind of ['handoff', 'offscreen', 'post'] as const) {
      let got = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const s = halfCourt(seed, { cohesion: [90, 70] });
        startPlay(s, 0, kind);
        const target = s.plays[0]!.targetId;
        run(s, 30 * 7, (st) => st.ball.mode === 'held' && st.ball.holderId === target);
        if (s.ball.mode === 'held' && s.ball.holderId === target) got++;
      }
      expect(got, kind).toBeGreaterThanOrEqual(7);
    }
  });

  it('pick plays set the screen and the screener rolls or pops', () => {
    for (const kind of ['pnr', 'pnp'] as const) {
      const s = halfCourt(5, { cohesion: [100, 70] });
      startPlay(s, 0, kind);
      const screener = s.players[s.plays[0]!.screenerId];
      const modes = new Set<string>();
      let screens = 0;
      for (let i = 0; i < 30 * 6; i++) {
        step(s, {});
        modes.add(screener.ai.mode);
        screens += s.events.filter((e) => e.type === 'screen').length;
      }
      expect(screens, kind).toBe(1);
      expect(modes.has(kind === 'pnp' ? 'pop' : 'roll'), kind).toBe(true);
    }
  });

  it('a person calls a play with the play button; it ends when the ball changes hands', () => {
    const s = halfCourt(3);
    s.settings.humanTeams = [0];
    s.controlled[0] = s.ball.holderId;
    step(s, { 0: { ...NO_INPUT, play: 5 } });
    expect(s.events.some((e) => e.type === 'call' && e.kind === 'play' && e.ok && e.play === 'post')).toBe(true);
    expect(s.plays[0]?.kind).toBe('post');
    giveBall(s, s.players.find((p) => p.team === 1)!.id);
    step(s, {});
    expect(s.plays[0]).toBeNull();
  });

  it('off the ball, a person’s play is run for them', () => {
    const s = halfCourt(4);
    s.settings.humanTeams = [0];
    s.settings.solo = 1;
    const me = s.players.find((p) => p.team === 0 && p.rosterIdx === 1)!;
    s.controlled[0] = me.id;
    step(s, { 0: { ...NO_INPUT, play: 4 } });
    expect(s.plays[0]?.targetId).toBe(me.id);
    // Pick plays need the ball.
    s.plays[0] = null;
    step(s, { 0: { ...NO_INPUT, play: 1 } });
    expect(s.events.some((e) => e.type === 'call' && e.kind === 'play' && !e.ok)).toBe(true);
  });

  it('expert computers run the whole playbook in a game', () => {
    const s = createGame({ teams: [GSW, LAL], settings: { seed: 9, humanTeams: [], quarterSeconds: 180, difficulty: 'expert' } });
    const kinds = new Set<string>();
    for (let i = 0; i < 30 * 60 * 30 && s.phase !== 'final'; i++) {
      step(s, {});
      for (const p of s.plays) if (p) kinds.add(p.kind);
    }
    expect(s.phase).toBe('final');
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});

describe('cohesion sources', () => {
  it('custom teams and MyTeam decks build cohesion game by game, up to 90', async () => {
    const { customCohesion, newMyTeam, deckCohesion, noteDeckGame } = await import('../src');
    expect(customCohesion({ id: 't1', name: 'A', abbr: 'A', primary: '#000', secondary: '#fff', members: [] })).toBe(40);
    expect(customCohesion({ id: 't1', name: 'A', abbr: 'A', primary: '#000', secondary: '#fff', members: [], games: 40 })).toBe(90);
    const save = newMyTeam(() => 0.5);
    expect(deckCohesion(save)).toBe(40);
    noteDeckGame(save);
    noteDeckGame(save);
    expect(deckCohesion(save)).toBe(44);
    // A new starting five starts over.
    save.deck = [...save.deck.slice(1), save.deck[0]];
    if (save.deck.length > 5) expect(deckCohesion(save)).toBe(40);
  });
});
