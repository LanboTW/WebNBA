import { nextRandom } from './rng';
import { RATING_KEYS, teamRating } from './roster';
import { createGame, step } from './sim';
import type { Difficulty, GameSettings, GameState, Look, PlayerInfo, PlayerStats, Position, Ratings, TeamInfo } from './types';

/**
 * Career mode rules that don't need a screen: building the created player,
 * the draft combine and the draft. Everything here is plain data in, plain
 * data out, so a career save is just JSON.
 */

export const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Heights (m) a created player may pick for each position. */
export const HEIGHT_RANGE: Record<Position, [number, number]> = {
  PG: [1.83, 1.98],
  SG: [1.88, 2.03],
  SF: [1.96, 2.08],
  PF: [2.01, 2.13],
  C: [2.06, 2.24],
};

export const AGE_RANGE: [number, number] = [19, 22];

/** Overall a created player starts at: below every NBA regular, room to grow. */
export const START_OVERALL = 60;

export type ArchetypeId = 'shooter' | 'slasher' | 'playmaker' | 'rim' | 'allround';

export interface Archetype {
  id: ArchetypeId;
  name: string;
  desc: string;
  /** Positions that may pick it. */
  positions: Position[];
  /** Added to the position's usual ratings when the player is created. */
  lean: Partial<Ratings>;
  /** Highest each rating can ever be trained to. */
  caps: Ratings;
}

const caps = (base: number, over: Partial<Ratings>): Ratings => {
  const r = {} as Ratings;
  for (const k of RATING_KEYS) r[k] = over[k] ?? base;
  return r;
};

export const ARCHETYPES: Archetype[] = [
  {
    id: 'shooter',
    name: '射手',
    desc: '三分與中距離是招牌，禁區與籃板較弱',
    positions: POSITIONS,
    lean: { three: 14, mid: 10, ft: 12, handle: 2, close: -6, jump: -4, block: -6, rebound: -6, defense: -4, steal: -2 },
    caps: caps(85, { three: 99, mid: 99, ft: 99, stamina: 99, handle: 90, speed: 90, defense: 82, block: 65, rebound: 72 }),
  },
  {
    id: 'slasher',
    name: '切入型',
    desc: '速度與彈跳出眾，擅長切入上籃灌籃，外線較弱',
    positions: POSITIONS,
    lean: { speed: 10, jump: 12, close: 12, handle: 4, steal: 2, three: -10, mid: -6, ft: -4, pass: -4 },
    caps: caps(88, { speed: 99, jump: 99, close: 99, stamina: 99, handle: 92, three: 78, mid: 85, ft: 85, block: 78, rebound: 82 }),
  },
  {
    id: 'playmaker',
    name: '組織後衛',
    desc: '運球與傳球最好，帶動全隊，限控球與得分後衛',
    positions: ['PG', 'SG'],
    lean: { pass: 14, handle: 14, speed: 6, steal: 4, close: -2, block: -8, rebound: -8, jump: -4 },
    caps: caps(88, { pass: 99, handle: 99, speed: 96, stamina: 99, steal: 92, mid: 92, ft: 92, three: 90, block: 60, rebound: 70 }),
  },
  {
    id: 'rim',
    name: '護框長人',
    desc: '阻攻、籃板與防守是本業，三分上限 70，限大前鋒與中鋒',
    positions: ['PF', 'C'],
    lean: { block: 16, rebound: 12, defense: 10, close: 6, jump: 4, three: -16, mid: -8, handle: -8, ft: -6, pass: -4, speed: -4 },
    caps: caps(85, { block: 99, rebound: 99, defense: 99, close: 95, jump: 92, stamina: 99, three: 70, mid: 78, handle: 70, speed: 80 }),
  },
  {
    id: 'allround',
    name: '全能型',
    desc: '沒有明顯弱點，但每項上限只有 88',
    positions: POSITIONS,
    lean: {},
    caps: caps(88, {}),
  },
];

export function archetype(id: ArchetypeId): Archetype {
  return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[ARCHETYPES.length - 1];
}

/** Typical ratings at each position (league averages, rounded). */
const POSITION_BASE: Record<Position, number[]> = {
  //   spd jmp cls mid 3pt ft  hdl pas stl blk def reb sta
  PG: [80, 66, 76, 76, 78, 82, 84, 81, 66, 33, 65, 50, 86],
  SG: [78, 70, 73, 72, 78, 80, 72, 66, 63, 39, 68, 53, 86],
  SF: [75, 72, 76, 72, 75, 78, 69, 64, 62, 49, 73, 61, 84],
  PF: [71, 73, 78, 67, 68, 73, 64, 61, 60, 59, 73, 72, 83],
  C: [61, 70, 83, 54, 42, 67, 51, 59, 57, 76, 74, 85, 80],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MIN_RATING = 25;

/**
 * Shifts ratings (each kept between MIN_RATING and its cap) until their plain
 * average is `target`, keeping the shape of the profile.
 */
function toOverall(raw: Ratings, cap: Ratings, target: number): Ratings {
  const r = { ...raw };
  for (let i = 0; i < 12; i++) {
    const avg = RATING_KEYS.reduce((s, k) => s + r[k], 0) / RATING_KEYS.length;
    const gap = target - avg;
    if (Math.abs(gap) < 0.05) break;
    for (const k of RATING_KEYS) r[k] = clamp(r[k] + gap, MIN_RATING, cap[k]);
  }
  for (const k of RATING_KEYS) r[k] = Math.round(r[k]);
  return r;
}

/** Where a height sits in its position's range: 0 shortest, 1 tallest. */
function heightShare(position: Position, heightM: number): number {
  const [lo, hi] = HEIGHT_RANGE[position];
  return clamp((heightM - lo) / (hi - lo), 0, 1);
}

/** A new player's ratings: position, then archetype, then height, scaled to START_OVERALL. */
export function startingRatings(position: Position, id: ArchetypeId, heightM: number): Ratings {
  const a = archetype(id);
  const t = heightShare(position, heightM) * 2 - 1; // -1 short .. +1 tall
  const tall: Partial<Ratings> = { speed: -4 * t, handle: -3 * t, steal: -2 * t, block: 5 * t, rebound: 5 * t, close: 2 * t };
  const raw = {} as Ratings;
  RATING_KEYS.forEach((k, i) => (raw[k] = POSITION_BASE[position][i] + (a.lean[k] ?? 0) + (tall[k] ?? 0)));
  return toOverall(raw, a.caps, START_OVERALL);
}

// ----------------------------------------------------------------- the save

export type PlayoffFormat = 'short' | 'single' | 'long' | 'full';

export interface CareerSettings {
  /** Fixed for the whole career: AI strength (and, later, how fast you earn XP). */
  difficulty: Difficulty;
  quarterSeconds: number;
  seasonGames: number;
  playoffs: PlayoffFormat;
}

export const DEFAULT_CAREER_SETTINGS: CareerSettings = {
  difficulty: 'normal',
  quarterSeconds: 180,
  seasonGames: 29,
  playoffs: 'short',
};

export interface CareerPlayer {
  info: PlayerInfo;
  archetype: ArchetypeId;
  age: number;
}

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

/** One finished game, from the career player's side. */
export interface CareerGame {
  stats: PlayerStats;
  /** [us, them]. */
  score: [number, number];
  /** Game score scaled to a 48-minute NBA game (see projectedGameScore). */
  rating: number;
  grade: Grade;
  simmed: boolean;
}

export interface DraftResult {
  pick: number;
  team: string;
  /** Teams in draft order, worst first. */
  order: string[];
}

export type CareerStage = 'combine' | 'drafted';

export interface CareerState {
  v: 1;
  /** Roster the career started from (ROSTER_VERSION). */
  rosterVersion: string;
  /** The season the player was drafted in, e.g. 2026. */
  year: number;
  settings: CareerSettings;
  player: CareerPlayer;
  stage: CareerStage;
  combine: {
    /** [your squad, the other squad]; you are in yours at your position's slot. */
    teams: [TeamInfo, TeamInfo];
    games: CareerGame[];
    seed: number;
  };
  draft: DraftResult | null;
}

export const COMBINE_GAMES = 3;

export interface NewCareer {
  name: string;
  number: number;
  position: Position;
  heightM: number;
  archetype: ArchetypeId;
  age: number;
  look: Look;
  settings: CareerSettings;
  rosterVersion: string;
  year: number;
  seed: number;
}

export function newCareer(c: NewCareer): CareerState {
  const position = c.position;
  const kind = archetype(c.archetype).positions.includes(position) ? c.archetype : 'allround';
  const [lo, hi] = HEIGHT_RANGE[position];
  const heightM = Math.round(clamp(c.heightM, lo, hi) * 100) / 100;
  const info: PlayerInfo = {
    name: c.name.trim().slice(0, 24) || 'Rookie',
    number: clamp(Math.round(c.number), 0, 99),
    heightM,
    position,
    ratings: startingRatings(position, kind, heightM),
    look: { ...c.look },
  };
  const age = clamp(Math.round(c.age), AGE_RANGE[0], AGE_RANGE[1]);
  return {
    v: 1,
    rosterVersion: c.rosterVersion,
    year: c.year,
    settings: { ...c.settings },
    player: { info, archetype: kind, age },
    stage: 'combine',
    combine: { teams: combineTeams(info, c.seed), games: [], seed: c.seed },
    draft: null,
  };
}

// ----------------------------------------------------------------- prospects

const FIRST = [
  'Jalen', 'Marcus', 'Tyrese', 'Caleb', 'Darius', 'Isaiah', 'Jordan', 'Malik', 'Andre', 'Cameron',
  'Elijah', 'Trey', 'Devin', 'Xavier', 'Miles', 'Jaylen', 'Keon', 'Amari', 'Zion', 'Nikola',
  'Luka', 'Josh', 'Aaron', 'Brandon', 'Chris', 'Derrick', 'Evan', 'Gabe', 'Hunter', 'Ivan',
  'Kobe', 'Lonnie', 'Mason', 'Noah', 'Omar', 'Quinn', 'Reggie', 'Sam', 'Theo', 'Victor',
];
const LAST = [
  'Walker', 'Johnson', 'Brooks', 'Carter', 'Mitchell', 'Hayes', 'Coleman', 'Porter', 'Reed', 'Bryant',
  'Simmons', 'Harris', 'Freeman', 'Wallace', 'Barnes', 'Grant', 'Holloway', 'Jenkins', 'Lewis', 'Morgan',
  'Nash', 'Owens', 'Pierce', 'Rivers', 'Stewart', 'Thompson', 'Vaughn', 'Watts', 'Young', 'Allen',
  'Bell', 'Diallo', 'Edwards', 'Fields', 'Greene', 'Ingram', 'Kovac', 'Mensah', 'Novak', 'Okafor',
];
const HAIRS: Look['hair'][] = ['bald', 'buzz', 'short', 'short', 'afro', 'twists', 'dreads', 'long', 'mohawk'];

type Rand = () => number;
function rng(seed: number): Rand {
  const s = { rng: seed | 0 };
  return () => nextRandom(s);
}
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)];

export function randomLook(r: Rand = Math.random): Look {
  return {
    skin: 1 + Math.floor(r() * 6),
    hair: pick(r, HAIRS),
    beard: pick(r, ['none', 'none', 'stubble', 'full'] as const),
    headband: r() < 0.15,
    sleeve: pick(r, ['none', 'none', 'none', 'left', 'right', 'both'] as const),
    kneepad: r() < 0.15,
    shoe: pick(r, ['white', 'black', 'team'] as const),
    socks: r() < 0.5 ? 'high' : 'low',
  };
}

/** A generated player around `ovr`: his position's shape, some random strengths and weaknesses. */
export function makeProspect(r: Rand, position: Position, ovr: number, taken: Set<string>, numbers: Set<number>): PlayerInfo {
  let name = '';
  do name = `${pick(r, FIRST)} ${pick(r, LAST)}`;
  while (taken.has(name));
  taken.add(name);
  let number = 0;
  do number = Math.floor(r() * 56);
  while (numbers.has(number));
  numbers.add(number);
  const [lo, hi] = HEIGHT_RANGE[position];
  const heightM = Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const raw = {} as Ratings;
  RATING_KEYS.forEach((k, i) => (raw[k] = POSITION_BASE[position][i] + (r() - 0.5) * 16));
  return { name, number, heightM, position, ratings: toOverall(raw, caps(95, {}), ovr), look: randomLook(r) };
}

/**
 * The two combine squads: yours with you at your position, the other one
 * of similar prospects. Eight players each, so there is a bench.
 */
export function combineTeams(me: PlayerInfo, seed: number): [TeamInfo, TeamInfo] {
  const r = rng(seed);
  const taken = new Set([me.name]);
  const squad = (withMe: boolean): PlayerInfo[] => {
    const numbers = new Set(withMe ? [me.number] : []);
    const starters = POSITIONS.map((pos) =>
      withMe && pos === me.position ? me : makeProspect(r, pos, 55 + r() * 8, taken, numbers),
    );
    const bench = (['PG', 'SF', 'C'] as Position[]).map((pos) => makeProspect(r, pos, 53 + r() * 6, taken, numbers));
    return [...starters, ...bench];
  };
  return [
    { abbr: 'BLUE', name: '試訓藍隊', primary: '#1d4ed8', secondary: '#f4f4f4', players: squad(true) },
    { abbr: 'RED', name: '試訓紅隊', primary: '#c8102e', secondary: '#f4f4f4', players: squad(false) },
  ];
}

// ----------------------------------------------------------------- games

/** Game settings for a career game: the player's team is team 0, and he is at roster index `me`. */
export function careerGameSettings(career: CareerState, seed: number, me: number): Partial<GameSettings> {
  return {
    mode: 'game',
    humanTeams: [0],
    solo: me,
    difficulty: career.settings.difficulty,
    quarterSeconds: career.settings.quarterSeconds,
    seed,
    rules: { fouls: true, violations: true, fatigue: true },
  };
}

/** Plays a game to the final buzzer with nobody at the controls. */
export function playOut(state: GameState, maxTicks = 30 * 60 * 120): GameState {
  state.settings.humanTeams = [];
  // The career player too: the AI takes him over.
  delete state.settings.solo;
  state.controlled = [-1, -1];
  for (let i = 0; i < maxTicks && state.phase !== 'final'; i++) step(state, {});
  return state;
}

export function simulateGame(teams: [TeamInfo, TeamInfo], settings: Partial<GameSettings>): GameState {
  return playOut(createGame({ teams, settings: { ...settings, humanTeams: [] } }));
}

/** A player's line from a game, wherever he ended up (on the floor or the bench). */
export function statsOf(state: GameState, team: 0 | 1, rosterIdx: number): PlayerStats | null {
  const on = state.players.find((p) => p.team === team && p.rosterIdx === rosterIdx);
  if (on) return { ...on.stats };
  const off = state.bench[team].find((b) => b.rosterIdx === rosterIdx);
  return off ? { ...off.stats } : null;
}

/** John Hollinger's game score: one number for a whole box-score line. */
export function gameScore(s: PlayerStats): number {
  return (
    s.pts + 0.4 * s.fgm - 0.7 * s.fga - 0.4 * (s.fta - s.ftm) + 0.7 * s.oreb + 0.3 * s.dreb + s.stl + 0.7 * s.ast + 0.7 * s.blk - 0.4 * s.pf - s.tov
  );
}

/** NBA points per game for both teams together; short games are scaled up to this. */
const NBA_GAME_POINTS = 230;

/** Game score as if the game had been a full NBA game (by how many points were scored). */
export function projectedGameScore(s: PlayerStats, score: [number, number]): number {
  const total = Math.max(40, score[0] + score[1]);
  return gameScore(s) * (NBA_GAME_POINTS / total);
}

const GRADES: [number, Grade][] = [
  [25, 'A+'],
  [20, 'A'],
  [16, 'B+'],
  [12, 'B'],
  [9, 'C+'],
  [6, 'C'],
  [3, 'D'],
];

export function grade(rating: number): Grade {
  return GRADES.find(([min]) => rating >= min)?.[1] ?? 'F';
}

/** Turns a finished game into the career player's record of it. */
export function careerGame(state: GameState, rosterIdx: number, simmed: boolean): CareerGame {
  const stats = statsOf(state, 0, rosterIdx) ?? emptyLine();
  const score: [number, number] = [state.score[0], state.score[1]];
  const rating = Math.round(projectedGameScore(stats, score) * 10) / 10;
  return { stats, score, rating, grade: grade(rating), simmed };
}

function emptyLine(): PlayerStats {
  return { secs: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ftm: 0, fta: 0, pf: 0 };
}

/** Where the career player is in his combine squad. */
export function combineIndex(career: CareerState): number {
  return POSITIONS.indexOf(career.player.info.position);
}

/** The squads for the next combine game, with the player as he is now. */
export function combineMatch(career: CareerState): [TeamInfo, TeamInfo] {
  const [mine, other] = career.combine.teams;
  const idx = combineIndex(career);
  return [{ ...mine, players: mine.players.map((p, i) => (i === idx ? career.player.info : p)) }, other];
}

export function recordCombineGame(career: CareerState, game: CareerGame): void {
  if (career.stage === 'combine' && career.combine.games.length < COMBINE_GAMES) career.combine.games.push(game);
}

export function combineDone(career: CareerState): boolean {
  return career.combine.games.length >= COMBINE_GAMES;
}

// ----------------------------------------------------------------- draft

/** NBA teams worst first (by team rating), the order they pick in. */
export function draftOrder(teams: TeamInfo[]): string[] {
  return [...teams]
    .sort((a, b) => teamRating(a) - teamRating(b) || a.abbr.localeCompare(b.abbr))
    .map((t) => t.abbr);
}

/** Average combine rating: what the scouts saw. */
export function combineRating(career: CareerState): number {
  const g = career.combine.games;
  return g.length ? g.reduce((s, x) => s + x.rating, 0) / g.length : 0;
}

/** The pick the combine earned: about 1 for a 25+ average, the late 20s for a quiet week. */
export function draftPick(career: CareerState, teams: number): number {
  const noise = (rng(career.combine.seed ^ 0x5eed)() - 0.5) * 3;
  return clamp(Math.round(31 - combineRating(career) * 1.2 + noise), 1, teams);
}

export function runDraft(career: CareerState, teams: TeamInfo[]): DraftResult {
  const order = draftOrder(teams);
  const pick = draftPick(career, order.length);
  return { pick, team: order[pick - 1], order };
}

/** Slot in the team's roster the rookie takes: the ninth man. */
export const ROOKIE_SLOT = 8;

/** A team's roster with the career player added as its ninth man. */
export function withCareerPlayer(team: TeamInfo, me: PlayerInfo): TeamInfo {
  const others = team.players.filter((p) => p.name !== me.name);
  return { ...team, players: [...others.slice(0, ROOKIE_SLOT), me, ...others.slice(ROOKIE_SLOT)] };
}

export function joinDraftedTeam(career: CareerState, draft: DraftResult): void {
  career.draft = draft;
  career.stage = 'drafted';
}
