import { ARCHETYPES, startingRatings, toOverall, type ArchetypeId, type CareerState } from './career';
import { careerInfo } from './economy';
import { NBA_TEAMS, RATING_KEYS, TEAMS, overallOf } from './roster';
import type { PlayerInfo, Position, Ratings, TeamInfo } from './types';

/**
 * The account's own players and teams (自訂隊伍/人員) and the career players
 * who have retired. Custom players are made freely (any rating 25-99);
 * custom teams hold custom players (live: editing the player changes the team)
 * and copies of NBA and career players (frozen when added).
 */

export const CUSTOM_LIMITS = {
  players: 60,
  teams: 12,
  teamMin: 5,
  teamMax: 13,
  retired: 30,
  rating: [25, 99] as [number, number],
  height: [1.65, 2.3] as [number, number],
};

/** The menu group these teams and players show under. */
export const MY_GROUP = '我的球隊';

export interface CustomPlayer {
  id: string;
  info: PlayerInfo;
}

/** A custom team's player: a custom player by id, or a frozen copy of anyone else. */
export type TeamMember = { src: 'custom'; id: string } | { src: 'nba' | 'career'; info: PlayerInfo };

export interface CustomTeam {
  id: string;
  name: string;
  /** Up to 3 letters or characters, shown on the scoreboard. */
  abbr: string;
  primary: string;
  secondary: string;
  /** Roster order: the first five start. */
  members: TeamMember[];
  /** Games played together (team cohesion grows with them). */
  games?: number;
}

/** A career player kept after he retired. */
export interface RetiredPlayer {
  /** name|draft year: one entry per career. */
  key: string;
  info: PlayerInfo;
  /** His last team (abbr). */
  team: string;
  /** Seasons played. */
  seasons: number;
  hall: boolean;
}

export interface CustomSave {
  v: 1;
  next: number;
  players: CustomPlayer[];
  teams: CustomTeam[];
  retired: RetiredPlayer[];
}

export const emptyCustom = (): CustomSave => ({ v: 1, next: 1, players: [], teams: [], retired: [] });

export function upgradeCustom(raw: unknown): CustomSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CustomSave>;
  return {
    v: 1,
    next: Math.max(1, Number(s.next) || 1),
    players: Array.isArray(s.players) ? s.players : [],
    teams: Array.isArray(s.teams) ? s.teams : [],
    retired: Array.isArray(s.retired) ? s.retired : [],
  };
}

export function newId(save: CustomSave, prefix: string): string {
  return `${prefix}${save.next++}`;
}

const clampRating = (v: number) => Math.max(CUSTOM_LIMITS.rating[0], Math.min(CUSTOM_LIMITS.rating[1], Math.round(v)));
const CAPS = Object.fromEntries(RATING_KEYS.map((k) => [k, CUSTOM_LIMITS.rating[1]])) as unknown as Ratings;

/** A type's ratings (as for a new career player) lifted or lowered to an overall. */
export function templateRatings(position: Position, id: ArchetypeId, heightM: number, ovr: number): Ratings {
  const kind = ARCHETYPES.find((a) => a.id === id && a.positions.includes(position)) ? id : 'allround';
  const r = toOverall(startingRatings(position, kind, heightM), CAPS, ovr, (x) => overallOf(position, x));
  for (const k of RATING_KEYS) r[k] = clampRating(r[k]);
  return r;
}

/** Names the game already uses: NBA rosters and custom data teams. */
const TAKEN = new Set(TEAMS.flatMap((t) => t.players.map((p) => p.name.toLowerCase())));

/** Why a custom player's name will not do (null when it is fine). */
export function playerNameProblem(save: CustomSave, name: string, selfId?: string): string | null {
  const n = name.trim();
  if (!n) return '請輸入名字';
  if (n.length > 20) return '名字最多 20 個字';
  if (TAKEN.has(n.toLowerCase())) return '這個名字和 NBA 球員重複了';
  if (save.players.some((p) => p.id !== selfId && p.info.name.trim().toLowerCase() === n.toLowerCase())) return '已經有同名的自訂隊員';
  return null;
}

const NBA_ABBRS = new Set(TEAMS.map((t) => t.abbr.toUpperCase()));

/** Why a custom team's name, abbreviation or roster will not do (null when it is fine). */
export function teamProblem(save: CustomSave, team: CustomTeam): string | null {
  if (!team.name.trim()) return '請輸入隊名';
  if (team.name.trim().length > 16) return '隊名最多 16 個字';
  const abbr = team.abbr.trim().toUpperCase();
  if (!abbr || [...abbr].length > 3) return '縮寫要 1–3 個字';
  if (NBA_ABBRS.has(abbr)) return '縮寫和 NBA 球隊重複了';
  if (save.teams.some((t) => t.id !== team.id && t.abbr.trim().toUpperCase() === abbr)) return '已經有同縮寫的自訂隊伍';
  const n = team.members.length;
  if (n < CUSTOM_LIMITS.teamMin) return `至少要 ${CUSTOM_LIMITS.teamMin} 人`;
  if (n > CUSTOM_LIMITS.teamMax) return `最多 ${CUSTOM_LIMITS.teamMax} 人`;
  return null;
}

export function memberInfo(save: CustomSave, m: TeamMember): PlayerInfo | null {
  return m.src === 'custom' ? (save.players.find((p) => p.id === m.id)?.info ?? null) : m.info;
}

/** A custom team as the game plays it (players whose custom entry is gone drop out). */
export function customTeamInfo(save: CustomSave, team: CustomTeam): TeamInfo {
  return {
    abbr: team.abbr.trim().toUpperCase() || 'MY',
    name: team.name.trim() || '自訂隊伍',
    primary: team.primary,
    secondary: team.secondary,
    group: MY_GROUP,
    players: team.members.map((m) => memberInfo(save, m)).filter((p): p is PlayerInfo => !!p),
  };
}

/** Whether a member is already this player (by name). */
export const hasMember = (save: CustomSave, team: CustomTeam, name: string): boolean =>
  team.members.some((m) => memberInfo(save, m)?.name === name);

export const retiredKey = (c: CareerState): string => `${c.player.info.name}|${c.year}`;

/**
 * Keeps a retired career player on the roster (once; new ones first). Returns
 * whether he was added. Over the limit, the oldest entry leaves.
 */
export function keepRetired(save: CustomSave, c: CareerState): boolean {
  if (c.stage !== 'retired') return false;
  const key = retiredKey(c);
  if (save.retired.some((r) => r.key === key)) return false;
  const last = c.history?.[c.history.length - 1]?.team ?? c.team ?? c.draft?.team ?? '';
  save.retired.unshift({
    key,
    info: careerInfo(c),
    team: last,
    seasons: c.history?.length ?? 0,
    hall: (c.hall ?? []).some((m) => m.me),
  });
  save.retired = save.retired.slice(0, CUSTOM_LIMITS.retired);
  return true;
}

/** Every NBA player, for adding a frozen copy to a custom team. */
export const nbaPool = (): { info: PlayerInfo; team: TeamInfo }[] => NBA_TEAMS.flatMap((t) => t.players.map((info) => ({ info, team: t })));
