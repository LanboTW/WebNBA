import { nextRandom } from './rng';
import { teamRating } from './roster';
import type { TeamInfo } from './types';

/**
 * A career season: the schedule, the results, the standings and the playoffs.
 * The career player's games are played (or simmed) with the real engine; every
 * other game is a quick statistical result. Teams are referred to by abbr.
 */

export type PlayoffFormat = 'short' | 'single' | 'long' | 'full';

export interface SeasonGame {
  day: number;
  home: string;
  away: string;
  /** [home, away] on the NBA scale; absent until played. */
  score?: [number, number];
}

export interface PlayoffGame {
  home: string;
  /** [higher seed, lower seed]. */
  score: [number, number];
}

export interface Series {
  /** 1 = first round ... 4 = Finals. */
  round: number;
  conf: 'East' | 'West' | 'Finals';
  /** Higher seed (home court) and lower seed. */
  hi: string;
  lo: string;
  /** Seeds within the conference (Finals: the conference seeds). */
  seeds: [number, number];
  best: number;
  wins: [number, number];
  games: PlayoffGame[];
}

export interface SeasonState {
  year: number;
  /** Mulberry state for the quick sims (the season stays reproducible). */
  rng: number;
  days: number;
  format: PlayoffFormat;
  /** First day with unplayed games. */
  day: number;
  games: SeasonGame[];
  playoffs: { series: Series[] } | null;
  champion: string | null;
}

export const PLAYOFF_TEAMS = 8;
export const ROUND_NAME = ['', '首輪', '分區準決賽', '分區冠軍賽', '總冠軍賽'];

/** NBA team points per game: what career games are scaled to. */
export const NBA_TEAM_POINTS = 115;
/** Points one team scores per second of game time in the engine (measured). */
const ENGINE_POINTS_PER_SECOND = 0.065;

/** Factor from a career game's raw numbers to a 48-minute NBA game. */
export function statScale(quarterSeconds: number): number {
  return NBA_TEAM_POINTS / (ENGINE_POINTS_PER_SECOND * 4 * quarterSeconds);
}

/** A raw final score on the NBA scale (never turning a win into a tie). */
export function scaleScore(raw: [number, number], quarterSeconds: number): [number, number] {
  const k = statScale(quarterSeconds);
  const s: [number, number] = [Math.round(raw[0] * k), Math.round(raw[1] * k)];
  if (s[0] === s[1] && raw[0] !== raw[1]) s[raw[0] > raw[1] ? 0 : 1]++;
  return s;
}

const rand = (s: SeasonState) => nextRandom(s);

/**
 * `days` game days; every team plays once a day, against a random opponent,
 * home and away kept as even as possible.
 */
export function newSeason(teams: TeamInfo[], year: number, days: number, format: PlayoffFormat, seed: number): SeasonState {
  const s: SeasonState = { year, rng: seed | 0, days, format, day: 0, games: [], playoffs: null, champion: null };
  const homes = new Map(teams.map((t) => [t.abbr, 0]));
  const met = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (let day = 0; day < days; day++) {
    const left = teams.map((t) => t.abbr);
    // Shuffle, then pair each team with the opponent it has met least.
    for (let i = left.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [left[i], left[j]] = [left[j], left[i]];
    }
    while (left.length > 1) {
      const a = left.shift()!;
      let bi = 0;
      for (let i = 1; i < left.length; i++) if ((met.get(key(a, left[i])) ?? 0) < (met.get(key(a, left[bi])) ?? 0)) bi = i;
      const b = left.splice(bi, 1)[0];
      met.set(key(a, b), (met.get(key(a, b)) ?? 0) + 1);
      const aHome = homes.get(a)! < homes.get(b)! || (homes.get(a) === homes.get(b) && rand(s) < 0.5);
      const [home, away] = aHome ? [a, b] : [b, a];
      homes.set(home, homes.get(home)! + 1);
      s.games.push({ day, home, away });
    }
  }
  return s;
}

/** A quick result: better teams and home teams win more, scores around the NBA average. */
export function quickScore(s: SeasonState, home: TeamInfo, away: TeamInfo): [number, number] {
  const gauss = () => (rand(s) + rand(s) + rand(s) + rand(s) - 2) * 1.7;
  const edge = (teamRating(home) - teamRating(away)) * 1.6 + 2.5;
  const total = 226 + gauss() * 10;
  const margin = edge + gauss() * 11;
  let h = Math.round((total + margin) / 2);
  let a = Math.round((total - margin) / 2);
  // Overtime: someone wins it.
  if (h === a) {
    const ot = 4 + Math.floor(rand(s) * 8);
    h += ot;
    a += ot;
    if (rand(s) < 0.5 + edge * 0.02) h += 1 + Math.floor(rand(s) * 6);
    else a += 1 + Math.floor(rand(s) * 6);
  }
  return [h, a];
}

// ----------------------------------------------------------------- regular season

export function seasonOver(s: SeasonState): boolean {
  return s.day >= s.days;
}

/** The team's game on the current day, if the regular season is still on. */
export function nextGameOf(s: SeasonState, abbr: string): SeasonGame | null {
  if (seasonOver(s)) return null;
  return s.games.find((g) => g.day === s.day && (g.home === abbr || g.away === abbr)) ?? null;
}

/** Plays every unplayed game of the current day (except `skip`'s) and moves to the next day. */
export function finishDay(s: SeasonState, teams: Map<string, TeamInfo>, skip?: string): void {
  for (const g of s.games) {
    if (g.day !== s.day || g.score || g.home === skip || g.away === skip) continue;
    g.score = quickScore(s, teams.get(g.home)!, teams.get(g.away)!);
  }
  if (s.games.every((g) => g.day !== s.day || g.score)) s.day++;
  if (seasonOver(s) && !s.playoffs) startPlayoffs(s, teams);
}

export interface StandingRow {
  abbr: string;
  w: number;
  l: number;
  pf: number;
  pa: number;
}

export const winPct = (r: StandingRow) => (r.w + r.l ? r.w / (r.w + r.l) : 0);

/** One conference's table, best first (win %, then point difference). */
export function standings(s: SeasonState, teams: Map<string, TeamInfo>, conf: 'East' | 'West'): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const t of teams.values()) if (t.conference === conf) rows.set(t.abbr, { abbr: t.abbr, w: 0, l: 0, pf: 0, pa: 0 });
  for (const g of s.games) {
    if (!g.score) continue;
    const [h, a] = g.score;
    const home = rows.get(g.home);
    const away = rows.get(g.away);
    if (home) {
      home.pf += h;
      home.pa += a;
      if (h > a) home.w++;
      else home.l++;
    }
    if (away) {
      away.pf += a;
      away.pa += h;
      if (a > h) away.w++;
      else away.l++;
    }
  }
  return [...rows.values()].sort(
    (x, y) => winPct(y) - winPct(x) || y.pf - y.pa - (x.pf - x.pa) || x.abbr.localeCompare(y.abbr),
  );
}

export function record(s: SeasonState, abbr: string): [number, number] {
  let w = 0;
  let l = 0;
  for (const g of s.games) {
    if (!g.score || (g.home !== abbr && g.away !== abbr)) continue;
    const mine = g.home === abbr ? g.score[0] : g.score[1];
    const theirs = g.home === abbr ? g.score[1] : g.score[0];
    if (mine > theirs) w++;
    else l++;
  }
  return [w, l];
}

// ----------------------------------------------------------------- playoffs

/** Best-of length for a round under each format. */
export function seriesLength(format: PlayoffFormat, round: number): number {
  switch (format) {
    case 'single':
      return 1;
    case 'short':
      return round === 1 ? 3 : 5;
    case 'long':
      return round === 1 ? 5 : 7;
    case 'full':
      return 7;
  }
}

function startPlayoffs(s: SeasonState, teams: Map<string, TeamInfo>): void {
  const format = s.format;
  const series: Series[] = [];
  for (const conf of ['East', 'West'] as const) {
    const top = standings(s, teams, conf).slice(0, PLAYOFF_TEAMS);
    // 1v8, 4v5, 3v6, 2v7: winners of the first two meet, and of the last two.
    for (const [a, b] of [
      [0, 7],
      [3, 4],
      [2, 5],
      [1, 6],
    ]) {
      if (!top[a] || !top[b]) continue;
      series.push(newSeries(1, conf, top[a].abbr, top[b].abbr, [a + 1, b + 1], seriesLength(format, 1)));
    }
  }
  s.playoffs = { series };
}

function newSeries(round: number, conf: Series['conf'], hi: string, lo: string, seeds: [number, number], best: number): Series {
  return { round, conf, hi, lo, seeds, best, wins: [0, 0], games: [] };
}

export const seriesDone = (x: Series) => Math.max(...x.wins) > x.best / 2;
export const seriesWinner = (x: Series) => (x.wins[0] > x.wins[1] ? x.hi : x.lo);

/** Home team for the series' next game: 2-2-1-1-1 (best of 7), 2-2-1 (5), 1-1-1 (3). */
export function nextHome(x: Series): string {
  const g = x.games.length;
  const hiHome = x.best === 7 ? [0, 1, 4, 6].includes(g) : x.best === 5 ? [0, 1, 4].includes(g) : g % 2 === 0;
  return hiHome ? x.hi : x.lo;
}

export function currentRound(s: SeasonState): Series[] {
  const all = s.playoffs?.series ?? [];
  const round = Math.max(0, ...all.map((x) => x.round));
  return all.filter((x) => x.round === round);
}

/** The team's series in progress, if it is still alive in the playoffs. */
export function activeSeriesOf(s: SeasonState, abbr: string): Series | null {
  return currentRound(s).find((x) => !seriesDone(x) && (x.hi === abbr || x.lo === abbr)) ?? null;
}

/** Records one playoff game ([home, away] score). */
export function recordPlayoffGame(x: Series, home: string, score: [number, number]): void {
  const hiScore = home === x.hi ? score[0] : score[1];
  const loScore = home === x.hi ? score[1] : score[0];
  x.games.push({ home, score: [hiScore, loScore] });
  x.wins[hiScore > loScore ? 0 : 1]++;
}

/**
 * Plays the next game of every unfinished series in the round (except
 * `skip`'s), then starts the next round (or crowns the champion) when the
 * round is over.
 */
export function finishPlayoffSlate(s: SeasonState, teams: Map<string, TeamInfo>, skip?: string): void {
  for (const x of currentRound(s)) {
    if (seriesDone(x) || x.hi === skip || x.lo === skip) continue;
    const home = nextHome(x);
    const away = home === x.hi ? x.lo : x.hi;
    recordPlayoffGame(x, home, quickScore(s, teams.get(home)!, teams.get(away)!));
  }
  advanceRound(s, teams);
}

function advanceRound(s: SeasonState, teams: Map<string, TeamInfo>): void {
  const round = currentRound(s);
  if (!round.length || !round.every(seriesDone) || s.champion) return;
  const r = round[0].round;
  if (r === 4) {
    s.champion = seriesWinner(round[0]);
    return;
  }
  const format = s.format;
  const best = seriesLength(format, r + 1);
  const winnerSeed = (x: Series) => (x.wins[0] > x.wins[1] ? x.seeds[0] : x.seeds[1]);
  if (r < 3) {
    for (const conf of ['East', 'West'] as const) {
      const done = round.filter((x) => x.conf === conf);
      for (let i = 0; i + 1 < done.length; i += 2) {
        const a = done[i];
        const b = done[i + 1];
        const [hi, lo] = winnerSeed(a) <= winnerSeed(b) ? [a, b] : [b, a];
        s.playoffs!.series.push(newSeries(r + 1, conf, seriesWinner(hi), seriesWinner(lo), [winnerSeed(hi), winnerSeed(lo)], best));
      }
    }
  } else {
    // Finals: home court to the better regular-season record.
    const [e, w] = [round.find((x) => x.conf === 'East')!, round.find((x) => x.conf === 'West')!];
    const ea = seriesWinner(e);
    const wa = seriesWinner(w);
    const pct = (a: string) => {
      const [wn, l] = record(s, a);
      return wn / Math.max(1, wn + l);
    };
    const [hi, lo] = pct(ea) >= pct(wa) ? [ea, wa] : [wa, ea];
    s.playoffs!.series.push(
      newSeries(4, 'Finals', hi, lo, [hi === ea ? winnerSeed(e) : winnerSeed(w), hi === ea ? winnerSeed(w) : winnerSeed(e)], best),
    );
  }
}
