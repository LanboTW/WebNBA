import { describe, expect, it } from 'vitest';
import {
  CAMPS_PER_SEASON,
  CAMP_XP,
  COIN_TRANSFER_MAX,
  DEFAULT_CAREER_SETTINGS,
  START_COHESION,
  acceptOffer,
  beginOffseason,
  buyCamp,
  buyGear,
  canBuyGear,
  careerInfo,
  careerMatchup,
  grade,
  newCareer,
  nextCareerGame,
  parseRoster,
  playerRating,
  randomLook,
  recordSeasonGame,
  retire,
  settle,
  simPlayoffsUntilMine,
  startSeason,
  toggleGear,
  transferCoins,
  type CareerGame,
  type CareerState,
  type PlayerStats,
  type RawRoster,
  type TeamInfo,
} from '../src';
import fixture from './fixture-roster.json';

const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const NBA: TeamInfo[] = parseRoster(fixture as RawRoster).map((t) => ({ ...t, conference: EAST.has(t.abbr) ? 'East' : 'West' }));

const stats = (pts: number): PlayerStats => ({
  secs: 500, pts, fgm: 4, fga: 8, tpm: 1, tpa: 3, oreb: 0, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, ftm: 1, fta: 2, pf: 1,
});
const game = (pts: number, rating: number): CareerGame => ({ stats: stats(pts), score: [40, 30], rating, grade: grade(rating), simmed: true });

function career(games = 10): CareerState {
  const c = newCareer({
    name: 'Test Rookie',
    number: 7,
    position: 'SG',
    heightM: 1.96,
    archetype: 'shooter',
    age: 20,
    look: randomLook(() => 0.3),
    settings: { ...DEFAULT_CAREER_SETTINGS, seasonGames: games, playoffs: 'single' },
    rosterVersion: 'test',
    year: 2026,
    seed: 1,
  });
  c.stage = 'drafted';
  c.draft = { pick: 5, team: 'GSW', order: [] };
  startSeason(c, NBA, 3);
  return c;
}

function finishSeason(c: CareerState, pts: number, rating: number): void {
  for (let i = 0; i < 80 && c.stage === 'season'; i++) {
    const next = nextCareerGame(c);
    if (next) recordSeasonGame(c, NBA, next, game(pts, rating));
    else simPlayoffsUntilMine(c, NBA);
  }
}

describe('career economy', () => {
  it('pays his salary over the regular season and builds fans and cohesion', () => {
    const c = career();
    finishSeason(c, 10, 18);
    // The whole rookie salary, paid game by game (in 萬).
    expect(c.money).toBeCloseTo(c.contract!.salary * 100, 0);
    expect(c.fans!).toBeGreaterThan(50_000);
    expect(c.cohesion!).toBeGreaterThan(START_COHESION + 10);
    const before = c.money!;
    beginOffseason(c, NBA);
    // Endorsements at the end of the season.
    expect(c.money!).toBeGreaterThan(before);
    expect(c.history![0].endorsement).toBeGreaterThan(0);
  });

  it('gear costs money, is worn in games and the best of it needs fans', () => {
    const c = career();
    c.money = 2000;
    const before = careerInfo(c).ratings.speed;
    expect(buyGear(c, 'quick2')).toBe(true);
    expect(c.money).toBe(1700);
    expect(careerInfo(c).ratings.speed).toBe(Math.min(99, before + 2));
    expect(careerInfo(c).look?.shoeColor).toBeTruthy();
    // His trained ratings don't move; the game sees the gear.
    expect(c.player.info.ratings.speed).toBe(before);
    const next = nextCareerGame(c)!;
    const m = careerMatchup(c, NBA, next);
    expect(m.teams[0].players[m.rosterIdx].ratings.speed).toBe(Math.min(99, before + 2));
    expect(canBuyGear(c, 'quick3')).toBe('fans');
    c.fans = 2_000_000;
    c.money = 100;
    expect(canBuyGear(c, 'quick3')).toBe('money');
    toggleGear(c, 'quick2');
    expect(careerInfo(c).ratings.speed).toBe(before);
  });

  it('private camps turn money into XP, three a season', () => {
    const c = career();
    c.money = 10_000;
    const xp = c.player.xp ?? 0;
    for (let i = 0; i < CAMPS_PER_SEASON; i++) expect(buyCamp(c)).toBe(true);
    expect(buyCamp(c)).toBe(false);
    expect(c.player.xp).toBe(xp + CAMPS_PER_SEASON * CAMP_XP);
  });

  it('a new team starts cohesion over, re-signing keeps it', () => {
    const c = career();
    finishSeason(c, 6, 10);
    beginOffseason(c, NBA);
    const built = c.cohesion!;
    c.offseason!.kind = 'free';
    c.offseason!.offers = [{ team: 'GSW', years: 2, salary: 5 }];
    acceptOffer(c, c.offseason!.offers[0], NBA);
    expect(c.cohesion).toBe(built);
    c.offseason!.kind = 'free';
    c.offseason!.offers = [{ team: 'BOS', years: 2, salary: 5 }];
    acceptOffer(c, c.offseason!.offers[0], NBA);
    expect(c.cohesion).toBe(START_COHESION);
  });

  it('coins come in before the first season and once per offseason, and go out once at retirement', () => {
    const c = newCareer({
      name: 'Coin Test',
      number: 3,
      position: 'PG',
      heightM: 1.9,
      archetype: 'playmaker',
      age: 20,
      look: randomLook(() => 0.5),
      settings: { ...DEFAULT_CAREER_SETTINGS, seasonGames: 10, playoffs: 'single' },
      rosterVersion: 'test',
      year: 2026,
      seed: 2,
    });
    expect(transferCoins(c, COIN_TRANSFER_MAX + 10, 0)).toBe(false);
    expect(transferCoins(c, 100, 200)).toBe(true);
    expect(c.money).toBe(500);
    expect(c.player.xp).toBe(1000);
    expect(transferCoins(c, 10, 0)).toBe(false);
    c.stage = 'retired';
    c.money = 1234;
    c.player.xp = 99;
    expect(settle(c)).toBe(123 + 9);
    expect(settle(c)).toBe(0);
  });

  it('retirement coins are capped by seasons played, plus honours', async () => {
    const { settlementParts, SETTLE_PER_SEASON, SETTLE_HOF, SETTLE_TROPHY } = await import('../src');
    const c = career();
    c.stage = 'retired';
    c.money = 10_000_000;
    c.player.xp = 0;
    c.history = [{ mine: ['mvp', 'champ', 'allstar'] }, { mine: ['champ'] }] as unknown as CareerState['history'];
    c.hall = [{ name: c.player.info.name, year: 2030, team: 'BOS', note: '', me: true }];
    const p = settlementParts(c);
    expect(p.cap).toBe(2 * SETTLE_PER_SEASON);
    expect(p.leftover).toBe(p.cap);
    expect(p.honours).toBe(SETTLE_HOF + 3 * SETTLE_TROPHY);
    expect(settle(c)).toBe(p.total);
  });

  it('fans level off near the ceiling; awards add, not multiply', async () => {
    const { fansAfterAwards, FANS_CEILING, endorsement } = await import('../src');
    expect(fansAfterAwards(1_000_000, ['mvp'])).toBeGreaterThan(2_800_000);
    let fans = 1_000_000;
    for (let i = 0; i < 60; i++) fans = fansAfterAwards(fans, ['mvp', 'champ', 'allstar']);
    expect(fans).toBeLessThan(FANS_CEILING * 1.05);
    expect(endorsement(FANS_CEILING)).toBe(5000);
  });

  it('training costs climb with his overall past 80', async () => {
    const { trainCost } = await import('../src');
    expect(trainCost(80, 90)).toBeGreaterThan(trainCost(80, 80) * 3);
    expect(trainCost(80, 70)).toBe(trainCost(80, 80));
  });

  it('a star season makes him a bigger name', () => {
    const c = career();
    finishSeason(c, 14, 28);
    beginOffseason(c, NBA);
    expect(c.fans!).toBeGreaterThan(150_000);
    retire(c);
    expect(playerRating(careerInfo(c))).toBeGreaterThan(0);
  });
});
