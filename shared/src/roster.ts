import rosterJson from '../data/roster.json';
import type { PlayerInfo, Position, Ratings, TeamInfo } from './types';

/**
 * The roster file stores each player compactly as
 * [name, number, heightM, position, [ratings in RATING_KEYS order]].
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

type RawPlayer = [string, number, number, string, number[]];

export interface RawRoster {
  season: string;
  ratingKeys: string[];
  teams: { abbr: string; name: string; primary: string; secondary: string; players: RawPlayer[] }[];
}

export function parseRoster(raw: RawRoster): TeamInfo[] {
  const keys = raw.ratingKeys as (keyof Ratings)[];
  return raw.teams.map((t) => ({
    abbr: t.abbr,
    name: t.name,
    primary: t.primary,
    secondary: t.secondary,
    players: t.players.map(([name, number, heightM, position, values]): PlayerInfo => {
      const ratings = {} as Ratings;
      for (const k of RATING_KEYS) ratings[k] = 50;
      keys.forEach((k, i) => (ratings[k] = values[i] ?? 50));
      return { name, number, heightM, position: position as Position, ratings };
    }),
  }));
}

export const ROSTER_SEASON = (rosterJson as RawRoster).season;
export const TEAMS: TeamInfo[] = parseRoster(rosterJson as RawRoster);

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
