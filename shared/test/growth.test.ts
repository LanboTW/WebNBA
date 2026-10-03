import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAREER_SETTINGS,
  ROLES,
  archetype,
  careerMatchup,
  gameXp,
  grade,
  minutesRating,
  newCareer,
  nextCareerGame,
  parseRoster,
  randomLook,
  recordSeasonGame,
  rotationRole,
  simulateGame,
  startSeason,
  statsOf,
  train,
  trainCost,
  type CareerGame,
  type CareerState,
  type RawRoster,
  type TeamInfo,
} from '../src';
import fixture from './fixture-roster.json';
import { GSW, LAL } from './helpers';

const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const NBA: TeamInfo[] = parseRoster(fixture as RawRoster).map((t) => ({ ...t, conference: EAST.has(t.abbr) ? 'East' : 'West' }));

function rookie(difficulty: CareerState['settings']['difficulty'] = 'normal'): CareerState {
  const c = newCareer({
    name: 'Test Rookie',
    number: 7,
    position: 'SG',
    heightM: 1.96,
    archetype: 'shooter',
    age: 20,
    look: randomLook(() => 0.3),
    settings: { ...DEFAULT_CAREER_SETTINGS, difficulty },
    rosterVersion: 'test',
    year: 2026,
    seed: 1,
  });
  c.stage = 'drafted';
  c.draft = { pick: 10, team: 'GSW', order: [] };
  startSeason(c, NBA, 3);
  return c;
}

const played = (rating: number, won = true, secs = 600): CareerGame => ({
  stats: { secs, pts: 10, fgm: 4, fga: 8, tpm: 1, tpa: 3, oreb: 0, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, ftm: 1, fta: 2, pf: 1 },
  score: won ? [40, 30] : [30, 40],
  rating,
  grade: secs ? grade(rating) : 'DNP',
  simmed: true,
});

describe('minutes', () => {
  it('a rookie at the bottom of the roster starts as a reserve', () => {
    const role = rotationRole(rookie(), NBA);
    expect(role.rank).toBeGreaterThan(8);
    expect(role.tier).toBeGreaterThanOrEqual(3);
    expect(role.form).toBeNull();
  });

  it('good games earn more minutes, bad ones cost them', () => {
    const good = rookie();
    const bad = rookie();
    for (let i = 0; i < 5; i++) {
      recordSeasonGame(good, NBA, nextCareerGame(good)!, played(26));
      recordSeasonGame(bad, NBA, nextCareerGame(bad)!, played(0, false));
    }
    const g = rotationRole(good, NBA);
    const b = rotationRole(bad, NBA);
    expect(g.form).toBe('A+');
    expect(b.form).toBe('F');
    expect(g.minutes).toBeGreaterThan(rotationRole(rookie(), NBA).minutes);
    expect(b.tier).toBe(4);
  });

  it('a starter is put in the starting five at his position', () => {
    const c = rookie();
    for (let i = 0; i < 5; i++) recordSeasonGame(c, NBA, nextCareerGame(c)!, played(26));
    c.player.info = { ...c.player.info, ratings: Object.fromEntries(Object.keys(c.player.info.ratings).map((k) => [k, 90])) as unknown as typeof c.player.info.ratings };
    const m = careerMatchup(c, NBA, nextCareerGame(c)!);
    expect(m.role.tier).toBe(0);
    expect(m.rosterIdx).toBeLessThan(5);
    expect(m.teams[0].players).toHaveLength(NBA.find((t) => t.abbr === 'GSW')!.players.length + 1);
  });

  it('the coach keeps a reserve near his planned minutes, played or simulated', () => {
    for (const minutes of [ROLES[3][1], ROLES[1][1]]) {
      let total = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const s = simulateGame([GSW, LAL], { seed, humanTeams: [0], solo: 7, soloMinutes: minutes / 48, quarterSeconds: 120 });
        total += (statsOf(s, 0, 7)!.secs / 480) * 48;
      }
      expect(Math.abs(total / 3 - minutes)).toBeLessThan(5);
    }
  }, 30000);
});

describe('grading by minutes', () => {
  it('judges production per minute, and short stints stay near average', () => {
    // Same per-minute output over real minutes: a rotation man and a starter grade alike.
    expect(minutesRating(15, 30)).toBeCloseTo(minutesRating(18, 36), 5);
    // Doing nothing in four minutes is a quiet night, not a disaster.
    expect(grade(minutesRating(0, 5))).toBe('C');
    expect(minutesRating(0, 36)).toBeLessThan(minutesRating(0, 4));
  });
});

describe('experience and training', () => {
  it('pays more for good games, wins, playoffs and hard careers', () => {
    const c = rookie();
    expect(gameXp(c, played(20), 0)).toBeGreaterThan(gameXp(c, played(5), 0));
    expect(gameXp(c, played(10, true), 0)).toBeGreaterThan(gameXp(c, played(10, false), 0));
    expect(gameXp(c, played(10), 1)).toBeGreaterThan(gameXp(c, played(10), 0));
    expect(gameXp(rookie('hard'), played(10), 0)).toBeGreaterThan(gameXp(rookie('easy'), played(10), 0));
    expect(gameXp(c, played(0, false, 0), 0)).toBeGreaterThan(0);
  });

  it('a season of XP is worth a few overall points, whatever its length', () => {
    const short = rookie();
    const long = { ...rookie(), settings: { ...DEFAULT_CAREER_SETTINGS, seasonGames: 82 } };
    expect(gameXp(short, played(12), 0) * 29).toBeCloseTo(gameXp(long, played(12), 0) * 82, -2);
  });

  it('training spends XP, costs more as a rating climbs, and stops at the cap', () => {
    expect(trainCost(80)).toBeGreaterThan(trainCost(60));
    const c = rookie();
    c.player.xp = 0;
    expect(train(c, 'three')).toBe(false);
    c.player.xp = 100000;
    const before = c.player.info.ratings.three;
    expect(train(c, 'three')).toBe(true);
    expect(c.player.info.ratings.three).toBe(before + 1);
    expect(c.player.xp).toBe(100000 - trainCost(before));
    const cap = archetype('shooter').caps.block;
    c.player.info.ratings.block = cap;
    expect(train(c, 'block')).toBe(false);
  });

  it('games add XP to the player', () => {
    const c = rookie();
    recordSeasonGame(c, NBA, nextCareerGame(c)!, played(15));
    expect(c.player.xp).toBeGreaterThan(0);
    expect(c.games![0].xp).toBe(c.player.xp);
  });
});
