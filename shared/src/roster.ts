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

/** Player rating shown in menus: the plain average of every rating. */
export function playerRating(info: PlayerInfo): number {
  return Math.round(RATING_KEYS.reduce((sum, k) => sum + info.ratings[k], 0) / RATING_KEYS.length);
}

/** Team rating: average of the five starters' player ratings. */
export function teamRating(team: TeamInfo): number {
  const starters = team.players.slice(0, 5);
  return Math.round(starters.reduce((sum, p) => sum + playerRating(p), 0) / Math.max(1, starters.length));
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
