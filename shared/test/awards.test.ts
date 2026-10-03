import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAREER_SETTINGS,
  HOF_POINTS,
  beginOffseason,
  grade,
  hofCase,
  leagueTeams,
  mvpRace,
  newCareer,
  nextCareerGame,
  parseRoster,
  randomLook,
  recordSeasonGame,
  retire,
  seasonLines,
  simPlayoffsUntilMine,
  startNextSeason,
  startSeason,
  statLeaders,
  type CareerGame,
  type CareerState,
  type PlayerStats,
  type RawRoster,
  type TeamInfo,
} from '../src';
import fixture from './fixture-roster.json';

const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);
const NBA: TeamInfo[] = parseRoster(fixture as RawRoster).map((t) => ({ ...t, conference: EAST.has(t.abbr) ? 'East' : 'West' }));

const stats = (pts: number, extra: Partial<PlayerStats> = {}): PlayerStats => ({
  secs: 500, pts, fgm: 4, fga: 8, tpm: 1, tpa: 3, oreb: 0, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, ftm: 1, fta: 2, pf: 1, ...extra,
});
const game = (s: PlayerStats, won = true): CareerGame => ({ stats: s, score: won ? [40, 30] : [30, 40], rating: 12, grade: grade(12), simmed: true });

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

function finishSeason(c: CareerState, line: (i: number) => PlayerStats): void {
  for (let i = 0; i < 80 && c.stage === 'season'; i++) {
    const next = nextCareerGame(c);
    if (next) recordSeasonGame(c, NBA, next, game(line(i)));
    else simPlayoffsUntilMine(c, NBA);
  }
}

describe('awards', () => {
  it('projected league lines look like an NBA season', () => {
    const c = career();
    finishSeason(c, () => stats(4));
    const lines = seasonLines(c, leagueTeams(c, NBA));
    const leaders = statLeaders(c, lines);
    console.log(Object.entries(leaders).map(([k, v]) => `${k} ${v?.name} ${v?.score.toFixed(1)}`).join(' | '));
    console.log(mvpRace(c, lines).map((x) => `${x.name} ${x.line.pts.toFixed(1)}/${x.line.reb.toFixed(1)}/${x.line.ast.toFixed(1)}`).join(' | '));
    expect(leaders.pts!.score).toBeGreaterThan(26);
    expect(leaders.pts!.score).toBeLessThan(38);
    expect(leaders.reb!.score).toBeGreaterThan(10);
    expect(leaders.ast!.score).toBeGreaterThan(7);
    expect(leaders.blk!.score).toBeGreaterThan(1.8);
  });

  it('names All-Stars halfway, gives the awards at the offseason and makes news of them', () => {
    const c = career();
    // A monster season: he should be an All-Star, the scoring champion and the rookie of the year.
    finishSeason(c, () => stats(14, { dreb: 4, ast: 3 }));
    expect(c.allStars?.year).toBe(2026);
    expect([...c.allStars!.East, ...c.allStars!.West]).toHaveLength(24);
    expect(c.allStars!.West).toContain('Test Rookie');
    beginOffseason(c, NBA);
    const h = c.history![0];
    expect(h.awards?.mvp.length).toBeGreaterThan(0);
    expect(h.mine).toEqual(expect.arrayContaining(['allstar', 'pts', 'roy']));
    expect(c.news!.some((n) => n.text.includes('得分王'))).toBe(true);
    expect(c.highs?.pts?.value).toBeGreaterThan(30);
  });

  it('career highs make the news only when they are big', () => {
    const c = career();
    finishSeason(c, (i) => stats(i === 3 ? 13 : 3));
    const big = c.news!.filter((n) => n.text.includes('生涯新高'));
    expect(big).toHaveLength(1);
    expect(c.highs!.pts!.value).toBeGreaterThanOrEqual(30);
  });

  it('a decorated career goes into the Hall of Fame when he retires', () => {
    const c = career();
    for (let year = 0; year < 4; year++) {
      finishSeason(c, () => stats(14, { dreb: 4, ast: 3 }));
      beginOffseason(c, NBA);
      if (year < 3) {
        if (c.offseason!.mustSign) c.offseason!.mustSign = false;
        startNextSeason(c, NBA, year + 10);
      }
    }
    expect(hofCase(c).points).toBeGreaterThanOrEqual(HOF_POINTS);
    retire(c);
    expect(c.hall?.some((m) => m.me)).toBe(true);
  });
});
