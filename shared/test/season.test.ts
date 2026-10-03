import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAREER_SETTINGS,
  PLAYOFF_TEAMS,
  activeSeriesOf,
  careerMatchup,
  finishDay,
  finishPlayoffSlate,
  grade,
  newCareer,
  newSeason,
  nextCareerGame,
  nextHome,
  parseRoster,
  randomLook,
  record,
  recordSeasonGame,
  scaleScore,
  seriesDone,
  seriesLength,
  simPlayoffsUntilMine,
  standings,
  startSeason,
  statScale,
  type CareerGame,
  type CareerState,
  type RawRoster,
  type TeamInfo,
} from '../src';
import fixture from './fixture-roster.json';

// The fixture has no conferences: split it like the real league.
const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const NBA: TeamInfo[] = parseRoster(fixture as RawRoster).map((t) => ({ ...t, conference: EAST.has(t.abbr) ? 'East' : 'West' }));
const league = new Map(NBA.map((t) => [t.abbr, t]));

function drafted(days = 6, format: CareerState['settings']['playoffs'] = 'single'): CareerState {
  const c = newCareer({
    name: 'Test Rookie',
    number: 7,
    position: 'SG',
    heightM: 1.96,
    archetype: 'shooter',
    age: 20,
    look: randomLook(() => 0.3),
    settings: { ...DEFAULT_CAREER_SETTINGS, seasonGames: days, playoffs: format },
    rosterVersion: 'test',
    year: 2026,
    seed: 1,
  });
  c.stage = 'drafted';
  c.draft = { pick: 1, team: NBA[0].abbr, order: NBA.map((t) => t.abbr) };
  startSeason(c, NBA, 9);
  return c;
}

const result = (us: number, them: number): CareerGame => ({
  stats: { secs: 600, pts: 10, fgm: 4, fga: 8, tpm: 1, tpa: 3, oreb: 0, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, ftm: 1, fta: 2, pf: 1 },
  score: [us, them],
  rating: 12,
  grade: grade(12),
  simmed: true,
});

describe('schedule', () => {
  it('every team plays once a day, home and away nearly even', () => {
    const s = newSeason(NBA, 2026, 29, 'short', 3);
    expect(s.games).toHaveLength((29 * NBA.length) / 2);
    for (let d = 0; d < 29; d++) {
      const teams = s.games.filter((g) => g.day === d).flatMap((g) => [g.home, g.away]);
      expect(new Set(teams).size).toBe(NBA.length);
    }
    for (const t of NBA) {
      const home = s.games.filter((g) => g.home === t.abbr).length;
      expect(Math.abs(home - (29 - home))).toBeLessThanOrEqual(1);
    }
  });

  it('quick results look like NBA scores and favour the better team', () => {
    const s = newSeason(NBA, 2026, 82, 'short', 4);
    for (let d = 0; d < 82; d++) finishDay(s, league);
    const totals = s.games.map((g) => g.score![0] + g.score![1]);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(avg).toBeGreaterThan(215);
    expect(avg).toBeLessThan(240);
    expect(s.games.every((g) => g.score![0] !== g.score![1])).toBe(true);
    const east = standings(s, league, 'East');
    expect(east[0].w).toBeGreaterThan(east[east.length - 1].w);
    expect(east.reduce((n, r) => n + r.w + r.l, 0)).toBe(82 * east.length);
  });

  it('career game scores are scaled to the NBA without turning a win into a tie', () => {
    expect(statScale(180) * 0.065 * 720).toBeCloseTo(115, 5);
    const [a, b] = scaleScore([101, 100], 720);
    expect(a).toBeGreaterThan(b);
  });
});

describe('playoffs', () => {
  it('series lengths follow the format', () => {
    expect([1, 2, 3, 4].map((r) => seriesLength('short', r))).toEqual([3, 5, 5, 5]);
    expect([1, 4].map((r) => seriesLength('long', r))).toEqual([5, 7]);
    expect(seriesLength('single', 3)).toBe(1);
  });

  it('home court goes 2-2-1-1-1 in a best of seven', () => {
    const x = { round: 1, conf: 'East' as const, hi: 'A', lo: 'B', seeds: [1, 8] as [number, number], best: 7, wins: [0, 0] as [number, number], games: [] as { home: string; score: [number, number] }[] };
    const homes: string[] = [];
    for (let g = 0; g < 7; g++) {
      homes.push(nextHome(x));
      x.games.push({ home: homes[g], score: [1, 0] });
    }
    expect(homes.join('')).toBe('AABBABA');
  });

  it('runs from eight teams a side to one champion', () => {
    const s = newSeason(NBA, 2026, 10, 'short', 5);
    for (let d = 0; d < 10; d++) finishDay(s, league);
    expect(s.playoffs!.series.filter((x) => x.round === 1)).toHaveLength(PLAYOFF_TEAMS);
    const top = standings(s, league, 'West')[0].abbr;
    expect(s.playoffs!.series.some((x) => x.round === 1 && x.hi === top && x.seeds[0] === 1)).toBe(true);
    for (let i = 0; i < 100 && !s.champion; i++) finishPlayoffSlate(s, league);
    expect(s.champion).toBeTruthy();
    const finals = s.playoffs!.series.filter((x) => x.round === 4);
    expect(finals).toHaveLength(1);
    expect(seriesDone(finals[0])).toBe(true);
    expect(finals[0].wins).toContain(3);
  });
});

describe('career season', () => {
  it('plays the season one game at a time, the rest of the league alongside', () => {
    const c = drafted(6);
    for (let i = 0; i < 6; i++) {
      const next = nextCareerGame(c)!;
      expect(next.playoff).toBe(0);
      const m = careerMatchup(c, NBA, next);
      expect(m.teams[0].abbr).toBe(c.team);
      expect(m.teams[0].players[m.rosterIdx].name).toBe('Test Rookie');
      recordSeasonGame(c, NBA, next, result(40, 30));
    }
    expect(record(c.season!, c.team!)).toEqual([6, 0]);
    expect(c.games).toHaveLength(6);
    expect(c.games![0].shown[0]).toBeGreaterThan(c.games![0].shown[1]);
    // Unbeaten: in the playoffs.
    expect(activeSeriesOf(c.season!, c.team!)).toBeTruthy();
  });

  it('a team out of the playoffs can sim to the champion', () => {
    const c = drafted(6);
    for (let i = 0; i < 6; i++) recordSeasonGame(c, NBA, nextCareerGame(c)!, result(10, 40));
    if (!activeSeriesOf(c.season!, c.team!)) {
      expect(nextCareerGame(c)).toBeNull();
      simPlayoffsUntilMine(c, NBA);
      expect(c.season!.champion).toBeTruthy();
      expect(c.stage).toBe('offseason');
    }
  });

  it('winning every playoff game wins the title', () => {
    const c = drafted(6, 'short');
    for (let i = 0; i < 6; i++) recordSeasonGame(c, NBA, nextCareerGame(c)!, result(40, 30));
    for (let i = 0; i < 40 && c.stage === 'season'; i++) {
      const next = nextCareerGame(c);
      if (!next) simPlayoffsUntilMine(c, NBA);
      else recordSeasonGame(c, NBA, next, result(40, 30));
    }
    expect(c.season!.champion).toBe(c.team);
    expect(c.stage).toBe('offseason');
    expect(c.games!.filter((g) => g.playoff === 4).length).toBe(3);
  });
});
