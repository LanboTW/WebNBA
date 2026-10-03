import birthdaysJson from '../data/birthdays.json';
import customJson from '../data/custom-teams.json';
import overridesJson from '../data/overrides.json';
import rosterJson from '../data/roster.json';
import type { Look, PlayerInfo, Position, Ratings, TeamInfo } from './types';

/**
 * The roster file stores each player compactly as
 * [name, number, heightM, position, [ratings in RATING_KEYS order], look?].
 */
export const RATING_KEYS: (keyof Ratings)[] = [
  'speed',
  'jump',
  'close',
  'mid',
  'three',
  'ft',
  'handle',
  'pass',
  'steal',
  'block',
  'defense',
  'rebound',
  'stamina',
];

type RawPlayer = [string, number, number, string, number[], Look?];

/** Looks set by hand in overrides.json win over the roster's, without running the update tool. */
const LOOK_OVERRIDES = new Map(
  Object.entries(overridesJson as Record<string, { look?: Partial<Look> }>).flatMap(([name, o]) =>
    typeof o === 'object' && o?.look ? [[name, o.look] as const] : [],
  ),
);

export interface RawRoster {
  season: string;
  updated?: string;
  ratingKeys: string[];
  teams: { abbr: string; name: string; primary: string; secondary: string; group?: string; logo?: string; players: RawPlayer[] }[];
}

/** shared/data/custom-teams.json: hand-made teams the roster update tool never touches. */
export interface RawCustomTeams {
  ratingKeys: string[];
  teams: RawRoster['teams'];
}

export function parseRoster(raw: RawRoster): TeamInfo[] {
  const keys = raw.ratingKeys as (keyof Ratings)[];
  return raw.teams.map((t) => ({
    abbr: t.abbr,
    name: t.name,
    primary: t.primary,
    secondary: t.secondary,
    ...(t.group ? { group: t.group } : {}),
    ...(t.logo ? { logo: t.logo } : {}),
    players: t.players.map(([name, number, heightM, position, values, look]): PlayerInfo => {
      const ratings = {} as Ratings;
      for (const k of RATING_KEYS) ratings[k] = 50;
      keys.forEach((k, i) => (ratings[k] = values[i] ?? 50));
      const extra = LOOK_OVERRIDES.get(name);
      const merged = look || extra ? ({ ...look, ...extra } as Look) : undefined;
      return { name, number, heightM, position: position as Position, ratings, ...(merged ? { look: merged } : {}) };
    }),
  }));
}

export const ROSTER_SEASON = (rosterJson as RawRoster).season;
const EAST = new Set(['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS']);

export const NBA_TEAMS: TeamInfo[] = parseRoster(rosterJson as RawRoster).map((t) => ({
  ...t,
  logo: `nba/${t.abbr}.png`,
  conference: EAST.has(t.abbr) ? 'East' : 'West',
}));
export const CUSTOM_TEAMS: TeamInfo[] = parseRoster({ season: '', ...(customJson as unknown as RawCustomTeams) }).map((t) => ({
  ...t,
  group: t.group ?? '自訂隊伍',
}));
/** NBA teams first, then custom teams in file order. */
export const TEAMS: TeamInfo[] = [...NBA_TEAMS, ...CUSTOM_TEAMS];

export function findTeam(abbr: string): TeamInfo {
  return TEAMS.find((t) => t.abbr === abbr) ?? TEAMS[0];
}

/**
 * Plain average of every rating: the game's internal strength measure (team
 * strength in quick results, salaries, retirements). Not shown to players.
 */
export function ratingAverage(info: Pick<PlayerInfo, 'ratings'>): number {
  return RATING_KEYS.reduce((sum, k) => sum + info.ratings[k], 0) / RATING_KEYS.length;
}

/** How much each rating counts toward the overall at each position (RATING_KEYS order). */
const OVERALL_WEIGHTS: Record<Position, number[]> = {
  //   spd  jmp  cls  mid  3pt  ft  hdl  pas  stl  blk  def  reb  sta
  PG: [3, 1, 2, 2, 3, 1, 4, 4, 2, 0.5, 2, 0.5, 1],
  SG: [3, 1.5, 2.5, 3, 4, 1, 3, 2, 2, 0.5, 2.5, 1, 1],
  SF: [2.5, 2, 3, 2.5, 3, 1, 2, 2, 2, 1, 3, 2, 1],
  PF: [1.5, 2, 4, 2, 2, 1, 1.5, 1.5, 1, 2.5, 3, 3.5, 1],
  C: [1, 2, 4, 1.5, 1, 0.5, 1, 1.5, 1, 4, 3.5, 4.5, 1],
};

/**
 * Score -> overall, fitted once to the 2026-27 league so the best player is 98
 * (MVPs are 97-99), the tenth best 93, the median 76 and the end of the
 * bench 62. Frozen: later rosters and career players use the same curve.
 */
const OVERALL_CURVE: [number, number][] = [
  [64, 62],
  [76, 76],
  [82, 88],
  [85, 93],
  [87, 96],
  [89.5, 98],
  [91, 99],
];

function curve(points: [number, number][], x: number): number {
  const [x0, y0] = points[0];
  if (x <= x0) return y0 + (x - x0) * ((points[1][1] - y0) / (points[1][0] - x0));
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [xa, ya] = points[i - 1];
      return ya + ((x - xa) * (y1 - ya)) / (x1 - xa);
    }
  }
  return points[points.length - 1][1];
}

/**
 * The overall, unrounded: what the position needs, plus the player's five best
 * ratings (stars are judged by their strengths), on a 2K-like scale.
 */
export function overallOf(position: Position, ratings: Ratings): number {
  const w = OVERALL_WEIGHTS[position] ?? OVERALL_WEIGHTS.SF;
  let sum = 0;
  let total = 0;
  RATING_KEYS.forEach((k, i) => {
    sum += ratings[k] * w[i];
    total += w[i];
  });
  const best = RATING_KEYS.map((k) => ratings[k])
    .sort((a, b) => b - a)
    .slice(0, 5);
  const score = 0.6 * (sum / total) + 0.4 * (best.reduce((a, b) => a + b, 0) / best.length);
  return Math.max(25, Math.min(99, curve(OVERALL_CURVE, score)));
}

/** Overall shown everywhere (and used to rank players). */
export function playerRating(info: Pick<PlayerInfo, 'position' | 'ratings'>): number {
  return Math.round(overallOf(info.position, info.ratings));
}

/**
 * Old plain-average overall -> roughly the same player's overall now, matched
 * by league rank. Only for numbers saved before the new overall existed.
 */
const LEGACY_CURVE: [number, number][] = [
  [56, 62],
  [62, 69.5],
  [66.6, 73],
  [69.2, 76],
  [72.4, 82],
  [75.3, 88],
  [78.3, 93],
  [82.3, 98],
  [84, 99],
];
export function legacyOverall(avg: number): number {
  return Math.round(Math.max(25, Math.min(99, curve(LEGACY_CURVE, avg))));
}

/** Team rating shown in menus: average of the five starters' overalls. */
export function teamRating(team: TeamInfo): number {
  const starters = team.players.slice(0, 5);
  return Math.round(starters.reduce((sum, p) => sum + playerRating(p), 0) / Math.max(1, starters.length));
}

/** Internal team strength (quick results, draft order): the starters' rating averages. */
export function teamStrength(team: TeamInfo): number {
  const starters = team.players.slice(0, 5);
  return Math.round(starters.reduce((sum, p) => sum + Math.round(ratingAverage(p)), 0) / Math.max(1, starters.length));
}
/** Date of the last automatic roster update (absent for the hand-made baseline). */
export const ROSTER_UPDATED: string | undefined = (rosterJson as RawRoster).updated;

/**
 * Fingerprint of the roster. Career saves refer to players by roster index,
 * so a save remembers which roster it was made with.
 * Looks are left out: they only change how players are drawn.
 */
const simTeams = (teams: RawRoster['teams']) => teams.map((t) => ({ ...t, players: t.players.map((p) => p.slice(0, 5)) }));
export const ROSTER_VERSION = fnv1a(
  JSON.stringify([simTeams((rosterJson as RawRoster).teams), simTeams((customJson as unknown as RawCustomTeams).teams)]),
);

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const BIRTHDAYS = (birthdaysJson as { players: Record<string, string> }).players;

/** A real player's age when the season starting in October of `year` begins (null when unknown). */
export function ageInSeason(name: string, year: number): number | null {
  const born = BIRTHDAYS[name];
  if (!born) return null;
  const [y, m] = born.split('-').map(Number);
  return year - y - (m >= 10 ? 1 : 0);
}
