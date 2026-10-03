import type { CareerState, LoggedGame } from './career';
import { ageInSeason, playerRating, ratingAverage } from './roster';
import { record, seasonOver, standings, statScale, type SeasonState } from './season';
import type { PlayerInfo, PlayerStats, Position, TeamInfo } from './types';

/**
 * Season stat lines for the whole league, the awards they earn, the All-Star
 * teams, his career highs, the news feed and the Hall of Fame.
 *
 * Only his games are played with the engine; every other player's numbers are
 * a projection from his ratings, his minutes and his team (stable for a
 * season, so the award race only moves with the standings and his own play).
 */

/** Per-game numbers on the NBA scale. */
export interface StatLine {
  name: string;
  team: string;
  position: Position;
  gp: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  /** The career player's own line (played, not projected). */
  me?: boolean;
}

export type StatKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk';
export const STAT_KEYS: StatKey[] = ['pts', 'reb', 'ast', 'stl', 'blk'];
export const STAT_TITLE: Record<StatKey, string> = { pts: '得分王', reb: '籃板王', ast: '助攻王', stl: '抄截王', blk: '阻攻王' };
export const STAT_NAME: Record<StatKey, string> = { pts: '得分', reb: '籃板', ast: '助攻', stl: '抄截', blk: '阻攻' };

export interface AwardPick {
  name: string;
  team: string;
  line: StatLine;
  /** The vote score it won on (for the ladders). */
  score: number;
}

export interface SeasonAwards {
  year: number;
  champion: string | null;
  /** Vote order, winner first. */
  mvp: AwardPick[];
  roy: AwardPick[];
  finalsMvp: AwardPick | null;
  leaders: Record<StatKey, AwardPick | null>;
  allStars: AllStars | null;
}

export interface AllStars {
  year: number;
  East: string[];
  West: string[];
}

export type AwardId = 'champ' | 'mvp' | 'fmvp' | 'roy' | 'allstar' | StatKey;
export const AWARD_NAME: Record<AwardId, string> = {
  champ: '總冠軍',
  mvp: '年度 MVP',
  fmvp: '總冠軍賽 MVP',
  roy: '年度新人王',
  allstar: '明星賽',
  ...STAT_TITLE,
};

/** A share of the season he must have played to win an award (as in the NBA's 65 games of 82). */
export const AWARD_GAMES = 0.65;
export const ALL_STARS_PER_CONFERENCE = 12;

// ----------------------------------------------------------------- stat lines

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rand(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minutes per game by rank on the team (best first). */
const MINUTES = [35, 34, 32, 30, 28, 25, 21, 17, 12, 8, 5];
/** A team's numbers per game: points come from its strength, the rest is league average. */
const TEAM: Record<Exclude<StatKey, 'pts'>, number> = { reb: 44, ast: 26.5, stl: 7.8, blk: 5 };

/** How much of a team's numbers each player takes: minutes, times the skill (a steep curve: stars take the most). */
const WEIGHT: Record<StatKey, (p: PlayerInfo) => number> = {
  pts: (p) => {
    const r = p.ratings;
    const scoring = r.close * 0.3 + r.mid * 0.22 + r.three * 0.3 + r.handle * 0.1 + r.ft * 0.08;
    return Math.exp((scoring - 72) / 30);
  },
  reb: (p) => Math.exp((p.ratings.rebound - 70) / 40) * (p.heightM / 2) ** 2,
  ast: (p) => Math.exp((p.ratings.pass * 0.8 + p.ratings.handle * 0.2 - 70) / 21),
  stl: (p) => Math.exp((p.ratings.steal - 70) / 24),
  blk: (p) => Math.exp((p.ratings.block - 70) / 18),
};

/** Above these, projections grow at half speed (a lopsided roster shouldn't make a 40-point scorer). */
const SOFT_CAP: Record<StatKey, number> = { pts: 30, reb: 13, ast: 10, stl: 2.2, blk: 3 };
const soft = (k: StatKey, v: number) => (v > SOFT_CAP[k] ? SOFT_CAP[k] + (v - SOFT_CAP[k]) * 0.5 : v);

/** Games each team has played this regular season. */
function gamesPlayed(s: SeasonState): number {
  return Math.min(s.day, s.days);
}

/** His regular-season line from the games he played. */
export function myLine(career: CareerState, team: string): StatLine | null {
  const games = (career.games ?? []).filter((g) => !g.playoff && g.stats.secs > 0);
  return gamesLine(career, team, games);
}

function gamesLine(career: CareerState, team: string, games: LoggedGame[]): StatLine | null {
  if (!games.length) return null;
  const q = career.settings.quarterSeconds;
  const k = statScale(q) / games.length;
  const sum = (f: (s: PlayerStats) => number) => games.reduce((a, g) => a + f(g.stats), 0);
  const p = career.player.info;
  return {
    name: p.name,
    team,
    position: p.position,
    gp: games.length,
    min: (sum((s) => s.secs) / (4 * q) / games.length) * 48,
    pts: sum((s) => s.pts) * k,
    reb: sum((s) => s.oreb + s.dreb) * k,
    ast: sum((s) => s.ast) * k,
    stl: sum((s) => s.stl) * k,
    blk: sum((s) => s.blk) * k,
    me: true,
  };
}

/**
 * Every player's season line so far: his from his games, the rest projected.
 * `league` is the league as the season sees it (his team with him on it).
 */
export function seasonLines(career: CareerState, league: Map<string, TeamInfo>): StatLine[] {
  const s = career.season;
  if (!s) return [];
  const played = gamesPlayed(s);
  const me = career.player.info.name;
  const lines: StatLine[] = [];
  const all = [...league.values()].flatMap((t) => t.players);
  const leagueWeight = Object.fromEntries(STAT_KEYS.map((k) => [k, all.reduce((a, p) => a + WEIGHT[k](p), 0) / Math.max(1, all.length)])) as Record<StatKey, number>;
  for (const t of league.values()) {
    const players = [...t.players].sort((a, b) => playerRating(b) - playerRating(a));
    const minutes = players.map((_, i) => MINUTES[Math.min(i, MINUTES.length - 1)]);
    // A star takes more of his team's numbers, but a weak supporting cast
    // doesn't hand him all of theirs: half the measure is the league's average player.
    const share = (key: StatKey) => {
      const w = players.map((p, i) => WEIGHT[key](p) * minutes[i]);
      const own = w.reduce((a, b) => a + b, 0);
      const avg = minutes.reduce((a, b) => a + b, 0) * leagueWeight[key];
      return w.map((x) => x / (own * 0.5 + avg * 0.5 || 1));
    };
    const teamPts = 112 + (teamLevel(t) - 70) * 0.8;
    const shares = Object.fromEntries(STAT_KEYS.map((k) => [k, share(k)])) as Record<StatKey, number[]>;
    players.forEach((p, i) => {
      if (p.name === me) {
        const mine = myLine(career, t.abbr);
        if (mine) lines.push(mine);
        return;
      }
      const r = rand(hash(`${s.year}${p.name}`));
      const noise = () => 0.9 + r() * 0.2;
      // Most play nearly every game; a few miss a stretch.
      const gp = Math.round(played * (1 - Math.pow(r(), 3) * 0.4));
      if (!gp) return;
      lines.push({
        name: p.name,
        team: t.abbr,
        position: p.position,
        gp,
        min: minutes[i],
        pts: soft('pts', teamPts * shares.pts[i] * noise()),
        reb: soft('reb', TEAM.reb * shares.reb[i] * noise()),
        ast: soft('ast', TEAM.ast * shares.ast[i] * noise()),
        stl: soft('stl', TEAM.stl * shares.stl[i] * noise()),
        blk: soft('blk', TEAM.blk * shares.blk[i] * noise()),
      });
    });
  }
  return lines;
}

/** The best five's rating averages (the internal strength scale). */
function teamLevel(t: TeamInfo): number {
  const avg = (p: PlayerInfo) => Math.round(ratingAverage(p));
  const best = [...t.players].sort((a, b) => avg(b) - avg(a)).slice(0, 5);
  return best.reduce((a, p) => a + avg(p), 0) / Math.max(1, best.length);
}

/** One number for a season's production, for the votes. */
export function impact(l: StatLine): number {
  return l.pts + l.reb * 1.1 + l.ast * 1.4 + (l.stl + l.blk) * 2;
}

function eligible(l: StatLine, s: SeasonState): boolean {
  return l.gp >= Math.max(1, Math.floor(gamesPlayed(s) * AWARD_GAMES));
}

function winPct(s: SeasonState, abbr: string): number {
  const [w, l] = record(s, abbr);
  return w + l ? w / (w + l) : 0.5;
}

const pick = (l: StatLine, score: number): AwardPick => ({ name: l.name, team: l.team, line: l, score });

/** Is this player in his first NBA season? */
export function isRookie(career: CareerState, name: string): boolean {
  if (name === career.player.info.name) return !(career.history ?? []).length;
  const debut = career.league?.debut?.[name];
  if (debut !== undefined) return debut === career.season?.year;
  // The real league's first season: its teenagers are this year's rookies.
  if (career.season?.year !== career.year) return false;
  return (ageInSeason(name, career.year) ?? 99) <= 19;
}

/** The MVP ladder: production, weighted by how well his team is doing. */
export function mvpRace(career: CareerState, lines: StatLine[]): AwardPick[] {
  const s = career.season!;
  return lines
    .filter((l) => eligible(l, s))
    .map((l) => pick(l, impact(l) * (0.45 + winPct(s, l.team) * 1.1)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function royRace(career: CareerState, lines: StatLine[]): AwardPick[] {
  const s = career.season!;
  return lines
    .filter((l) => eligible(l, s) && isRookie(career, l.name))
    .map((l) => pick(l, impact(l)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export function statLeaders(career: CareerState, lines: StatLine[]): Record<StatKey, AwardPick | null> {
  const s = career.season!;
  const ok = lines.filter((l) => eligible(l, s));
  const best = (k: StatKey) => ok.reduce<StatLine | null>((b, l) => (!b || l[k] > b[k] ? l : b), null);
  return Object.fromEntries(STAT_KEYS.map((k) => {
    const l = best(k);
    return [k, l ? pick(l, l[k]) : null];
  })) as Record<StatKey, AwardPick | null>;
}

/**
 * Twelve a conference: the most productive players, the winning teams' a
 * little ahead. Picked halfway through the regular season (there is no game).
 */
export function selectAllStars(career: CareerState, league: Map<string, TeamInfo>): AllStars {
  const s = career.season!;
  const lines = seasonLines(career, league).filter((l) => l.gp >= Math.max(1, gamesPlayed(s) * 0.5));
  const conf = (abbr: string) => league.get(abbr)?.conference ?? 'East';
  const team = (c: 'East' | 'West') =>
    lines
      .filter((l) => conf(l.team) === c)
      .map((l) => ({ name: l.name, v: impact(l) * (0.75 + winPct(s, l.team) * 0.5) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, ALL_STARS_PER_CONFERENCE)
      .map((x) => x.name);
  return { year: s.year, East: team('East'), West: team('West') };
}

/** The best player of the champions in the Finals (his own Finals games when he played them). */
export function finalsMvp(career: CareerState, lines: StatLine[]): AwardPick | null {
  const s = career.season!;
  if (!s.champion) return null;
  const r = rand(hash(`${s.year}finals`));
  const champs = lines
    .filter((l) => l.team === s.champion && !l.me)
    .map((l) => pick(l, impact(l) * (0.8 + r() * 0.4)));
  if (s.champion === career.team) {
    const finals = gamesLine(career, s.champion, (career.games ?? []).filter((g) => g.playoff === 4 && g.stats.secs > 0));
    if (finals) champs.push(pick(finals, impact(finals)));
  }
  return champs.sort((a, b) => b.score - a.score)[0] ?? null;
}

/** Every award of a finished season. */
export function seasonAwards(career: CareerState, league: Map<string, TeamInfo>): SeasonAwards {
  const s = career.season!;
  const lines = seasonLines(career, league);
  return {
    year: s.year,
    champion: s.champion,
    mvp: mvpRace(career, lines),
    roy: royRace(career, lines),
    finalsMvp: finalsMvp(career, lines),
    leaders: statLeaders(career, lines),
    allStars: career.allStars?.year === s.year ? career.allStars : null,
  };
}

/** What he won in a season. */
export function myAwards(career: CareerState, a: SeasonAwards): AwardId[] {
  const me = career.player.info.name;
  const out: AwardId[] = [];
  if (a.champion && a.champion === career.team) out.push('champ');
  if (a.mvp[0]?.name === me) out.push('mvp');
  if (a.finalsMvp?.name === me) out.push('fmvp');
  if (a.roy[0]?.name === me) out.push('roy');
  if (a.allStars && [...a.allStars.East, ...a.allStars.West].includes(me)) out.push('allstar');
  for (const k of STAT_KEYS) if (a.leaders[k]?.name === me) out.push(k);
  return out;
}

/** His trophies over the career: how many of each. */
export function trophyCase(career: CareerState): Partial<Record<AwardId, number>> {
  const n: Partial<Record<AwardId, number>> = {};
  for (const h of career.history ?? []) for (const id of h.mine ?? []) n[id] = (n[id] ?? 0) + 1;
  return n;
}

// ----------------------------------------------------------------- news

export interface NewsItem {
  year: number;
  /** Game day of the regular season; days past it are the playoffs; -1 the offseason. */
  day: number;
  text: string;
  /** His own story (highlighted). */
  mine?: boolean;
}

const NEWS_KEEP = 200;

export function addNews(career: CareerState, text: string, mine = false): void {
  const s = career.season;
  const day = career.stage === 'offseason' || career.stage === 'retired' || !s ? -1 : s.day;
  career.news = [...(career.news ?? []), { year: career.season?.year ?? career.year, day, text, mine }].slice(-NEWS_KEEP);
}

// ----------------------------------------------------------------- career highs

export type RecordKey = StatKey | 'tpm';
export const RECORD_KEYS: RecordKey[] = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm'];
export const RECORD_NAME: Record<RecordKey, string> = { ...STAT_NAME, tpm: '三分球' };
/** A new career high this good makes the news. */
const HEADLINE: Record<RecordKey, number> = { pts: 30, reb: 15, ast: 12, stl: 5, blk: 5, tpm: 7 };

export interface CareerHigh {
  value: number;
  year: number;
  opp: string;
  playoff: number;
}

/** One game's numbers on the NBA scale. */
export function scaledGame(stats: PlayerStats, quarterSeconds: number): Record<RecordKey, number> {
  const k = statScale(quarterSeconds);
  const r = (v: number) => Math.round(v * k);
  return { pts: r(stats.pts), reb: r(stats.oreb + stats.dreb), ast: r(stats.ast), stl: r(stats.stl), blk: r(stats.blk), tpm: r(stats.tpm) };
}

/** Counts a game he played toward his career highs, and makes news of the big ones. */
export function noteGame(career: CareerState, g: LoggedGame, oppName: string): void {
  if (g.stats.secs <= 0) return;
  const line = scaledGame(g.stats, career.settings.quarterSeconds);
  const highs = (career.highs ??= {});
  const year = career.season?.year ?? career.year;
  const news: string[] = [];
  for (const k of RECORD_KEYS) {
    const old = highs[k];
    if (old && old.value >= line[k]) continue;
    highs[k] = { value: line[k], year, opp: g.opp, playoff: g.playoff };
    if (old && line[k] >= HEADLINE[k]) news.push(`${line[k]} ${RECORD_NAME[k]}`);
  }
  const name = career.player.info.name;
  const doubles = (['pts', 'reb', 'ast', 'stl', 'blk'] as const).filter((k) => line[k] >= 10).length;
  if (doubles >= 3) addNews(career, `${name} 對 ${oppName} 拿下大三元：${line.pts} 分 ${line.reb} 籃板 ${line.ast} 助攻！`, true);
  else if (line.pts >= 40) addNews(career, `${name} 對 ${oppName} 狂砍 ${line.pts} 分！`, true);
  if (news.length) addNews(career, `${name} 對 ${oppName} 刷新生涯新高：${news.join('、')}`, true);
}

// ----------------------------------------------------------------- the regular season's milestones

/** Halfway through the regular season the All-Stars are named (no game is played). */
export function checkMidseason(career: CareerState, league: Map<string, TeamInfo>): void {
  const s = career.season;
  if (!s || s.playoffs || career.allStars?.year === s.year) return;
  if (s.day < Math.ceil(s.days / 2) && !seasonOver(s)) return;
  const stars = selectAllStars(career, league);
  career.allStars = stars;
  const me = career.player.info.name;
  const conf = league.get(career.team ?? '')?.conference ?? 'East';
  const confName = conf === 'East' ? '東區' : '西區';
  if (stars[conf].includes(me)) addNews(career, `${me} 入選 ${s.year + 1} 年明星賽${confName}名單！`, true);
  else addNews(career, `${s.year + 1} 年明星賽名單公布，${me} 沒有入選。`);
}

/** The standings' top seed per conference (for news when the regular season ends). */
export function topSeeds(s: SeasonState, league: Map<string, TeamInfo>): string[] {
  return (['East', 'West'] as const).map((c) => standings(s, league, c)[0]?.abbr).filter((x): x is string => !!x);
}

// ----------------------------------------------------------------- Hall of Fame

export interface HallMember {
  name: string;
  /** Season he retired after. */
  year: number;
  team: string;
  /** Why: the line on the plaque. */
  note: string;
  /** The career player. */
  me?: boolean;
}

/** Points a career needs for the Hall of Fame. */
export const HOF_POINTS = 30;

/** His Hall of Fame case: points for trophies and for a long, productive career. */
export function hofCase(career: CareerState): { points: number; parts: [string, number][] } {
  const t = trophyCase(career);
  const hist = career.history ?? [];
  // Seasons are shorter than the NBA's: totals count as if each season were 82 games.
  const per82 = hist.reduce((n, h) => n + (h.gp ? (h.totals.pts * h.scale * 82) / Math.max(h.gp, career.settings.seasonGames) : 0), 0);
  const parts: [string, number][] = [
    ['年度 MVP', (t.mvp ?? 0) * 10],
    ['總冠軍', (t.champ ?? 0) * 4],
    ['總冠軍賽 MVP', (t.fmvp ?? 0) * 4],
    ['明星賽', (t.allstar ?? 0) * 3],
    ['數據王', STAT_KEYS.reduce((n, k) => n + (t[k] ?? 0), 0) * 2],
    ['年度新人王', (t.roy ?? 0) * 2],
    ['生涯得分', Math.floor(per82 / 2000) * 2],
  ];
  return { points: parts.reduce((n, [, v]) => n + v, 0), parts: parts.filter(([, v]) => v > 0) };
}

/** A league player retiring: in on his overall and the awards he won during the career. */
export function leagueHofNote(career: CareerState, name: string, ovr: number): string | null {
  let mvp = 0;
  let stars = 0;
  for (const h of career.history ?? []) {
    if (h.awards?.mvp[0]?.name === name) mvp++;
    if (h.awards?.allStars && [...h.awards.allStars.East, ...h.awards.allStars.West].includes(name)) stars++;
  }
  if (mvp) return `${mvp} 座 MVP`;
  if (stars >= 4) return `${stars} 次明星賽`;
  if (ovr >= 91) return `退休時總評 ${ovr}`;
  return null;
}
