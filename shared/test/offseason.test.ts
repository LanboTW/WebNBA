import { describe, expect, it } from 'vitest';
import {
  DECLINE_AGE,
  DEFAULT_CAREER_SETTINGS,
  RETIRE_AT,
  RETIRE_FROM,
  acceptOffer,
  ageInSeason,
  beginOffseason,
  canRetire,
  grade,
  guessAge,
  leagueTeams,
  newCareer,
  nextCareerGame,
  parseRoster,
  playerRating,
  randomLook,
  recordSeasonGame,
  requestTrade,
  retire,
  salaryFor,
  simPlayoffsUntilMine,
  startNextSeason,
  startSeason,
  type CareerGame,
  type CareerState,
  type RawRoster,
  type TeamInfo,
} from '../src';
import fixture from './fixture-roster.json';

const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const NBA: TeamInfo[] = parseRoster(fixture as RawRoster).map((t) => ({ ...t, conference: EAST.has(t.abbr) ? 'East' : 'West' }));

const game = (won: boolean): CareerGame => ({
  stats: { secs: 600, pts: 10, fgm: 4, fga: 8, tpm: 1, tpa: 3, oreb: 0, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, ftm: 1, fta: 2, pf: 1 },
  score: won ? [40, 30] : [30, 40],
  rating: 12,
  grade: grade(12),
  simmed: true,
});

function career(age = 20): CareerState {
  const c = newCareer({
    name: 'Test Rookie',
    number: 7,
    position: 'SG',
    heightM: 1.96,
    archetype: 'shooter',
    age: 20,
    look: randomLook(() => 0.3),
    settings: { ...DEFAULT_CAREER_SETTINGS, seasonGames: 4, playoffs: 'single' },
    rosterVersion: 'test',
    year: 2026,
    seed: 1,
  });
  c.player.age = age;
  c.stage = 'drafted';
  c.draft = { pick: 5, team: 'GSW', order: [] };
  startSeason(c, NBA, 3);
  return c;
}

/** Plays out the season (his games all losses) to the offseason. */
function finishSeason(c: CareerState): void {
  for (let i = 0; i < 50 && c.stage === 'season'; i++) {
    const next = nextCareerGame(c);
    if (next) recordSeasonGame(c, NBA, next, game(false));
    else simPlayoffsUntilMine(c, NBA);
  }
}

describe('offseason', () => {
  it('a rookie gets a three-year rookie-scale deal, the top picks paid more', () => {
    const c = career();
    expect(c.contract).toMatchObject({ team: 'GSW', years: 3 });
    expect(salaryFor(80, 26)).toBeGreaterThan(salaryFor(65, 26));
    expect(salaryFor(75, 34)).toBeLessThan(salaryFor(75, 26));
  });

  it('records the season, ages everyone, and refills rosters with rookies', () => {
    const c = career();
    finishSeason(c);
    expect(c.stage).toBe('offseason');
    beginOffseason(c, NBA);
    expect(c.history).toHaveLength(1);
    expect(c.history![0]).toMatchObject({ year: 2026, team: 'GSW', gp: 4 });
    expect(c.player.age).toBe(21);
    expect(c.contract!.years).toBe(2);
    const o = c.offseason!;
    expect(o.kind).toBe('none');
    for (const t of c.league!.teams) expect(t.players.length).toBeGreaterThanOrEqual(8);
    // Every retiree was replaced.
    expect(o.rookies.length).toBeGreaterThanOrEqual(o.retired.length);
    for (const r of o.retired) expect(c.league!.ages[r.name]).toBeUndefined();
    // Calling it twice does nothing more.
    beginOffseason(c, NBA);
    expect(c.history).toHaveLength(1);
  });

  it('young league players tend to improve and old ones to decline', () => {
    const c = career();
    finishSeason(c);
    const before = new Map(NBA.flatMap((t) => t.players.map((p) => [p.name, playerRating(p)])));
    beginOffseason(c, NBA);
    let youngUp = 0;
    let young = 0;
    let oldDown = 0;
    let old = 0;
    for (const t of c.league!.teams)
      for (const p of t.players) {
        const was = before.get(p.name);
        if (was === undefined) continue;
        const age = c.league!.ages[p.name];
        if (age <= 23) {
          young++;
          if (playerRating(p) >= was) youngUp++;
        } else if (age >= 33) {
          old++;
          if (playerRating(p) <= was) oldDown++;
        }
      }
    if (young) expect(youngUp / young).toBeGreaterThan(0.7);
    if (old) expect(oldDown / old).toBeGreaterThan(0.7);
    // Real birthdays where we have them (Jaylen Brown, born October 1996).
    expect(ageInSeason('Jaylen Brown', 2026)).toBe(29);
    expect(ageInSeason('Nobody Atall', 2026)).toBeNull();
    expect(guessAge('Anyone')).toBeGreaterThanOrEqual(20);
    expect(guessAge('Anyone')).toBeLessThanOrEqual(35);
  });

  it('he starts to slow down past thirty', () => {
    const c = career(DECLINE_AGE - 1);
    const speed = c.player.info.ratings.speed;
    finishSeason(c);
    beginOffseason(c, NBA);
    expect(c.player.info.ratings.speed).toBeLessThan(speed);
    expect(c.offseason!.aged.changes.speed).toBeLessThan(0);
  });

  it('free agency when the deal runs out: sign one of the offers, then the next season starts', () => {
    const c = career();
    c.contract!.years = 1;
    finishSeason(c);
    beginOffseason(c, NBA);
    const o = c.offseason!;
    expect(o.kind).toBe('free');
    expect(o.offers.length).toBeGreaterThanOrEqual(1);
    expect(o.offers.length).toBeLessThanOrEqual(4);
    expect(startNextSeason(c, NBA, 5)).toBe(false);
    const pick = o.offers[0];
    acceptOffer(c, pick);
    expect(c.team).toBe(pick.team);
    expect(c.contract).toEqual({ team: pick.team, years: pick.years, salary: pick.salary });
    expect(startNextSeason(c, NBA, 5)).toBe(true);
    expect(c.year).toBe(2027);
    expect(c.stage).toBe('season');
    // The new season uses the aged league, with him on his new team.
    const mine = leagueTeams(c, NBA).get(pick.team)!;
    expect(mine.players.some((p) => p.name === 'Test Rookie')).toBe(true);
    expect(c.season!.games.length).toBeGreaterThan(0);
  });

  it('a trade request brings other teams; his contract goes with him', () => {
    const c = career();
    finishSeason(c);
    beginOffseason(c, NBA);
    const deal = { ...c.contract! };
    requestTrade(c, NBA);
    const o = c.offseason!;
    expect(o.kind).toBe('trade');
    expect(o.offers.length).toBeGreaterThanOrEqual(2);
    expect(o.offers.every((x) => x.team !== 'GSW')).toBe(true);
    const to = o.offers[0];
    acceptOffer(c, to);
    expect(c.team).toBe(to.team);
    expect(c.contract).toEqual({ ...deal, team: to.team });
    requestTrade(c, NBA);
    expect(c.offseason!.offers).toHaveLength(0);
  });

  it('may retire from 35 and must at 40', () => {
    const young = career(30);
    finishSeason(young);
    beginOffseason(young, NBA);
    expect(canRetire(young)).toBe(false);
    const vet = career(RETIRE_FROM - 1);
    finishSeason(vet);
    beginOffseason(vet, NBA);
    expect(canRetire(vet)).toBe(true);
    retire(vet);
    expect(vet.stage).toBe('retired');
    const old = career(RETIRE_AT - 1);
    finishSeason(old);
    beginOffseason(old, NBA);
    expect(old.stage).toBe('retired');
  });
});
