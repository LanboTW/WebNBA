import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  COMBINE_GAMES,
  DEFAULT_CAREER_SETTINGS,
  HEIGHT_RANGE,
  POSITIONS,
  ROOKIE_SLOT,
  START_OVERALL,
  careerGame,
  careerGameSettings,
  combineDone,
  combineIndex,
  combineMatch,
  draftOrder,
  gameScore,
  grade,
  newCareer,
  parseRoster,
  playerRating,
  randomLook,
  recordCombineGame,
  runDraft,
  simulateGame,
  startingRatings,
  teamRating,
  withCareerPlayer,
  type CareerState,
  type NewCareer,
  type RawRoster,
} from '../src';
import fixture from './fixture-roster.json';

const TEAMS = parseRoster(fixture as RawRoster);

function career(over: Partial<NewCareer> = {}): CareerState {
  return newCareer({
    name: 'Test Rookie',
    number: 7,
    position: 'SG',
    heightM: 1.96,
    archetype: 'shooter',
    age: 20,
    look: randomLook(() => 0.3),
    settings: { ...DEFAULT_CAREER_SETTINGS, quarterSeconds: 60 },
    rosterVersion: 'test',
    year: 2026,
    seed: 42,
    ...over,
  });
}

describe('created player', () => {
  it('starts near the starting overall within every cap, for every position and archetype', () => {
    for (const pos of POSITIONS) {
      for (const a of ARCHETYPES) {
        if (!a.positions.includes(pos)) continue;
        for (const h of HEIGHT_RANGE[pos]) {
          const r = startingRatings(pos, a.id, h);
          const ovr = playerRating({ name: '', number: 0, heightM: h, position: pos, ratings: r });
          expect(Math.abs(ovr - START_OVERALL)).toBeLessThanOrEqual(1);
          for (const [k, v] of Object.entries(r)) expect(v).toBeLessThanOrEqual(a.caps[k as keyof typeof r]);
        }
      }
    }
  });

  it('archetypes shape the ratings', () => {
    const shooter = startingRatings('SG', 'shooter', 1.96);
    const slasher = startingRatings('SG', 'slasher', 1.96);
    expect(shooter.three).toBeGreaterThan(slasher.three);
    expect(slasher.close).toBeGreaterThan(shooter.close);
    const rim = startingRatings('C', 'rim', 2.13);
    expect(rim.three).toBeLessThanOrEqual(70);
    expect(rim.block).toBeGreaterThan(startingRatings('C', 'allround', 2.13).block);
  });

  it('taller players rebound more and move slower', () => {
    const short = startingRatings('SF', 'allround', HEIGHT_RANGE.SF[0]);
    const tall = startingRatings('SF', 'allround', HEIGHT_RANGE.SF[1]);
    expect(tall.rebound).toBeGreaterThan(short.rebound);
    expect(tall.speed).toBeLessThan(short.speed);
  });

  it('falls back to all-round when the archetype does not fit the position, and clamps height and age', () => {
    const c = career({ position: 'C', archetype: 'playmaker', heightM: 3, age: 30 });
    expect(c.player.archetype).toBe('allround');
    expect(c.player.info.heightM).toBe(HEIGHT_RANGE.C[1]);
    expect(c.player.age).toBe(22);
  });
});

describe('draft combine', () => {
  it('puts the player at his position in his squad, among unique prospects', () => {
    const c = career({ position: 'PF', archetype: 'rim', heightM: 2.08 });
    const [mine, other] = c.combine.teams;
    expect(mine.players[combineIndex(c)].name).toBe('Test Rookie');
    expect(mine.players.map((p) => p.position).slice(0, 5)).toEqual(POSITIONS);
    const names = [...mine.players, ...other.players].map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of [...mine.players, ...other.players]) expect(playerRating(p)).toBeLessThan(66);
  });

  it('plays a combine game to the end headless and records the player', () => {
    const c = career();
    const state = simulateGame(combineMatch(c), careerGameSettings(c, 3));
    expect(state.phase).toBe('final');
    const g = careerGame(state, combineIndex(c), true);
    expect(g.stats.secs).toBeGreaterThan(0);
    expect(g.score).toEqual([state.score[0], state.score[1]]);
    expect(g.grade).toBe(grade(g.rating));
    recordCombineGame(c, g);
    expect(c.combine.games).toHaveLength(1);
    expect(combineDone(c)).toBe(false);
  }, 20000);

  it('grades game scores', () => {
    expect(grade(30)).toBe('A+');
    expect(grade(12)).toBe('B');
    expect(grade(-2)).toBe('F');
    const line = { secs: 0, pts: 20, fgm: 8, fga: 15, tpm: 2, tpa: 5, oreb: 1, dreb: 4, ast: 5, stl: 1, blk: 0, tov: 2, ftm: 2, fta: 2, pf: 2 };
    expect(gameScore(line)).toBeCloseTo(20 + 3.2 - 10.5 + 0.7 + 1.2 + 1 + 3.5 - 0.8 - 2, 5);
  });
});

describe('draft', () => {
  const game = (rating: number) => ({
    stats: { secs: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ftm: 0, fta: 0, pf: 0 },
    score: [50, 50] as [number, number],
    rating,
    grade: grade(rating),
    simmed: false,
  });

  it('the worst team picks first', () => {
    const order = draftOrder(TEAMS);
    const ratings = order.map((a) => teamRating(TEAMS.find((t) => t.abbr === a)!));
    expect([...ratings].sort((a, b) => a - b)).toEqual(ratings);
  });

  it('a great combine goes early, a poor one late', () => {
    const great = career();
    const poor = career();
    for (let i = 0; i < COMBINE_GAMES; i++) {
      recordCombineGame(great, game(26));
      recordCombineGame(poor, game(4));
    }
    recordCombineGame(great, game(0)); // a fourth game is ignored
    expect(combineDone(great)).toBe(true);
    const early = runDraft(great, TEAMS);
    const late = runDraft(poor, TEAMS);
    expect(early.pick).toBeLessThanOrEqual(3);
    expect(late.pick).toBeGreaterThanOrEqual(23);
    expect(early.team).toBe(early.order[early.pick - 1]);
  });

  it('the rookie joins as the ninth man', () => {
    const c = career();
    const team = withCareerPlayer(TEAMS[0], c.player.info);
    expect(team.players[ROOKIE_SLOT].name).toBe('Test Rookie');
    expect(team.players).toHaveLength(TEAMS[0].players.length + 1);
  });
});
