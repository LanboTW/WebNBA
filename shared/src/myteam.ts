import archiveJson from '../data/card-archive.json';
import headshotsJson from '../data/headshots.json';
import historyJson from '../data/history.json';
import myteamJson from '../data/myteam.json';
import specialJson from '../data/special-cards.json';
import { POSITIONS, startingRatings, toOverall, type ArchetypeId } from './career';
import {
  NBA_TEAMS,
  RATING_KEYS,
  ROSTER_SEASON,
  TEAMS,
  findTeam,
  overallOf,
  parseRoster,
  playerRating,
  teamRating,
  type RawRoster,
} from './roster';
import { DIFFICULTY_COINS, type Difficulty, type Look, type PlayerInfo, type Position, type Ratings, type TeamInfo } from './types';

/**
 * MyTeam: collect player cards with coins, build a deck, play with it.
 * Cards: every current player at his own overall squeezed into 66-93 (one
 * card per season: within a season it follows the roster, a new season brings
 * new cards and the old ones go to the 復刻 pack), history cards (champions,
 * awards, MVPs, the Hall of Fame) and hand-made special cards. A card can be
 * owned up to five times at once; duplicates merge into +1 overall each.
 */

export type TierId = 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'pink' | 'orange' | 'black';

export interface Tier {
  id: TierId;
  name: string;
  min: number;
  max: number;
  /** Frame colour. */
  color: string;
  /** Coins for a sold card (or one past the five copies). */
  value: number;
}

export const TIERS: Tier[] = [
  { id: 'white', name: '白', min: 66, max: 70, color: '#d9dde3', value: 25 },
  { id: 'green', name: '綠', min: 71, max: 75, color: '#3fb96b', value: 50 },
  { id: 'blue', name: '藍', min: 76, max: 80, color: '#3b82f6', value: 100 },
  { id: 'purple', name: '紫', min: 81, max: 85, color: '#9b5de5', value: 200 },
  { id: 'gold', name: '金', min: 86, max: 89, color: '#e8b931', value: 350 },
  { id: 'pink', name: '粉紅', min: 90, max: 93, color: '#ff5fa2', value: 600 },
  { id: 'orange', name: '橘', min: 94, max: 96, color: '#ff7a1a', value: 1000 },
  { id: 'black', name: '黑', min: 97, max: 99, color: '#1a1a1f', value: 2000 },
];

export const tier = (id: TierId): Tier => TIERS.find((t) => t.id === id)!;
export const tierIndex = (id: TierId): number => TIERS.findIndex((t) => t.id === id);
export function tierOf(ovr: number): TierId {
  return [...TIERS].reverse().find((t) => ovr >= t.min)?.id ?? 'white';
}

/** Rental cards wear grey, whatever their rating. */
export const RENTAL_COLOR = '#8a9099';

/** Ladder periods (挑戰之路). They no longer limit what packs give. */
export const PERIODS = 6;

export type CardSource = 'current' | 'champion' | 'award' | 'hof' | 'special';
export const CARD_SOURCES: [CardSource, string][] = [
  ['current', '現役'],
  ['champion', '冠軍'],
  ['award', '獎項'],
  ['hof', '名人堂'],
  ['special', '特殊'],
];

/** A card in the catalog. */
export interface CardDef {
  id: string;
  name: string;
  team: string;
  position: Position;
  number: number;
  heightM: number;
  tier: TierId;
  ovr: number;
  source: CardSource;
  /** On the card face: 26-27, 2016 MVP, 名人堂, 聖誕… */
  label: string;
  /** Current-player cards: their season (2026-27). */
  season?: string;
  /** A past season's card: only the 復刻 pack gives it. */
  retired?: boolean;
  /** Special cards: the theme (frame, limited-pack week) and the picture in client/public/cards/. */
  theme?: string;
  image?: string;
  /** Never in a pack: special levels give it. */
  levelOnly?: boolean;
}

/** A card the player owns: one copy, with its ratings (kept for cards that leave the catalog). */
export interface OwnedCard extends CardDef {
  /** This copy (decks point at it). */
  uid: string;
  /** Duplicates merged in: +1 overall each (ovr already has it). */
  plus?: number;
  /** RATING_KEYS order, at ovr. */
  ratings: number[];
}

/** A loaned card: plays `games` more games, then it is gone. */
export interface RentalCard extends OwnedCard {
  games: number;
}

/** At most this many copies of one card at once; more turn into coins. */
export const COPY_MAX = 5;
/** Merging duplicates: up to +5. */
export const PLUS_MAX = 5;

export interface PackDef {
  id: string;
  name: string;
  price: number;
  count: number;
  /** Only these tiers. */
  tiers?: TierId[];
  positions?: Position[];
  /** Only these players (by name). */
  players?: string[];
  /** Relative odds per tier; missing tiers use DEFAULT_WEIGHTS. */
  weights?: Partial<Record<TierId, number>>;
  /** The first card is of this tier or better. */
  guarantee?: TierId;
  /** limited: this week's special cards join; reissue: one past season's cards only. */
  kind?: 'limited' | 'reissue';
  /** Not sold in the shop (rewards can still give it). */
  hidden?: boolean;
}

export const DEFAULT_WEIGHTS: Record<TierId, number> = {
  white: 30,
  green: 30,
  blue: 22,
  purple: 10,
  gold: 5,
  pink: 2,
  orange: 0.6,
  black: 0.2,
};

export const OFFICIAL_PACKS: PackDef[] = (myteamJson as unknown as { packs: PackDef[] }).packs;

/** ESPN ids of the players who have a downloaded headshot (npm run headshots:update). */
const HEADSHOTS = (headshotsJson as { players: Record<string, string> }).players;
export const headshotId = (name: string): string | null => HEADSHOTS[name] ?? null;

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

// ----------------------------------------------------------------- the data

type LegendRow = [string, number, Position, number, ArchetypeId, number, Look['hair'], Look['beard']];
interface History {
  champions: [number, string, string[]][];
  awards: Record<HistoryAward, ([number, string, string] | [number, string, string, number])[]>;
  hof: [string, string, number][];
  legends: LegendRow[];
  /** Each champion team's two next men (opponents only). */
  championBench: Record<string, string[]>;
  hofTeams: { id: string; name: string; team: string; players: string[] }[];
  /** Team USA: a bare name plays at his best card; [name, ovr] for someone with none. */
  olympics: { year: number; card: string; players: (string | [string, number])[] }[];
}
const HISTORY = historyJson as unknown as History;

export type HistoryAward = 'mvp' | 'fmvp' | 'dpoy' | 'roy' | 'smoy' | 'mip' | 'scoring';
const AWARDS: Record<HistoryAward, { name: string; ovr: number }> = {
  mvp: { name: 'MVP', ovr: 95 },
  fmvp: { name: 'FMVP', ovr: 93 },
  scoring: { name: '得分王', ovr: 92 },
  dpoy: { name: '最佳防守', ovr: 91 },
  mip: { name: '進步獎', ovr: 90 },
  roy: { name: '新人王', ovr: 90 },
  smoy: { name: '第六人', ovr: 90 },
};
/** A champion team's six, best first. */
const CHAMPION_OVR = [93, 92, 91, 91, 90, 90];

export interface SpecialTheme {
  id: string;
  name: string;
  color: string;
  accent: string;
  /** Its cards come from special levels only, never a pack. */
  levelOnly?: boolean;
}
/** A line of special-cards.json's cards. */
export interface SpecialRow {
  id: string;
  player: string;
  ovr: number;
  theme: string;
  team?: string;
  image?: string;
  position?: Position;
  heightM?: number;
  number?: number;
  style?: ArchetypeId;
  look?: Partial<Look>;
  /** The card's line (default: the theme's name). */
  label?: string;
}
/** special-cards.json. */
export interface SpecialFile {
  $comment?: string;
  themes: SpecialTheme[];
  cards: SpecialRow[];
}
const SPECIAL = specialJson as unknown as SpecialFile;
export const SPECIAL_THEMES: SpecialTheme[] = SPECIAL.themes;
export const specialTheme = (id: string | undefined): SpecialTheme | undefined => SPECIAL_THEMES.find((t) => t.id === id);

const ARCHIVE = (archiveJson as unknown as { seasons: RawRoster[] }).seasons;
/** Past seasons whose cards the 復刻 pack sells, oldest first. */
export const ARCHIVED_SEASONS: string[] = ARCHIVE.map((s) => s.season).filter((s) => s !== ROSTER_SEASON);

/** 2026-27 -> 26-27. */
export const seasonLabel = (season: string): string => season.replace(/^\d\d(\d\d)-(\d\d)$/, '$1-$2');
const seasonTag = (season: string): string => seasonLabel(season).replace('-', '');

const LOOK: Look = { skin: 4, hair: 'short', beard: 'none', headband: false, sleeve: 'none', kneepad: false, shoe: 'white', socks: 'low' };

/** A player the history files describe (not on the roster): ratings from his style and height. */
function legendPlayer(row: LegendRow): PlayerInfo {
  const [name, number, position, cm, style, skin, hair, beard] = row;
  const heightM = cm / 100;
  return { name, number, heightM, position, ratings: startingRatings(position, style, heightM), look: { ...LOOK, skin, hair, beard } };
}

/** Everyone a card or an opponent can be: history players, then today's roster over them. */
let peopleMemo: Map<string, PlayerInfo> | null = null;
function people(): Map<string, PlayerInfo> {
  if (peopleMemo) return peopleMemo;
  const out = new Map<string, PlayerInfo>();
  for (const row of HISTORY.legends) out.set(row[0], legendPlayer(row));
  for (const t of NBA_TEAMS) for (const p of t.players) out.set(p.name, p);
  peopleMemo = out;
  return out;
}

// ----------------------------------------------------------------- the catalog

let catalog: CardDef[] | null = null;
let byId = new Map<string, CardDef>();
/** Each card's player: whose ratings (reshaped to the card's overall) and look it has. */
const cardBase = new Map<string, PlayerInfo>();

/** A season's current players, their real overall squeezed into 66-93 (the best one 93). */
function seasonCards(teams: TeamInfo[], season: string, retired: boolean): CardDef[] {
  const players = teams.flatMap((t) => t.players.map((p) => ({ p, t })));
  const top = Math.max(67, ...players.map((x) => playerRating(x.p)));
  return players.map(({ p, t }) => {
    const real = playerRating(p);
    const ovr = real <= 66 ? 66 : Math.min(93, Math.round(66 + ((real - 66) * 27) / (top - 66)));
    const id = `s${seasonTag(season)}-${slug(p.name)}`;
    cardBase.set(id, p);
    return {
      id,
      name: p.name,
      team: t.abbr,
      position: p.position,
      number: p.number,
      heightM: p.heightM,
      tier: tierOf(ovr),
      ovr,
      source: 'current' as const,
      label: seasonLabel(season),
      season,
      ...(retired ? { retired: true } : {}),
    };
  });
}

/** Every card there is (the same for everyone). */
export function cardCatalog(): CardDef[] {
  if (catalog) return catalog;
  const out: CardDef[] = seasonCards(NBA_TEAMS, ROSTER_SEASON, false);
  for (const raw of ARCHIVE) if (raw.season !== ROSTER_SEASON) out.push(...seasonCards(parseRoster(raw), raw.season, true));

  const add = (id: string, name: string, team: string, ovr: number, source: CardSource, label: string, extra: Partial<CardDef> = {}) => {
    const p = people().get(name);
    if (!p) return;
    cardBase.set(id, p);
    out.push({ id, name, team, position: p.position, number: p.number, heightM: p.heightM, tier: tierOf(ovr), ovr, source, label, ...extra });
  };
  for (const [year, team, six] of HISTORY.champions) {
    six.forEach((name, i) => add(`c${year}-${slug(name)}`, name, team, CHAMPION_OVR[i] ?? 90, 'champion', `${year} 冠軍`));
  }
  for (const key of Object.keys(AWARDS) as HistoryAward[]) {
    for (const [year, name, team, ovr] of HISTORY.awards[key] ?? []) {
      const o = ovr ?? AWARDS[key].ovr;
      add(`a${year}-${key}-${slug(name)}`, name, team, o, 'award', `${year} ${key === 'mvp' && o >= 97 ? '巔峰MVP' : AWARDS[key].name}`);
    }
  }
  for (const [name, team, ovr] of HISTORY.hof) add(`h-${slug(name)}`, name, team, ovr, 'hof', '名人堂');
  for (const s of SPECIAL.cards) {
    const { def, base } = specialCard(s, SPECIAL_THEMES);
    cardBase.set(def.id, base);
    out.push(def);
  }
  catalog = out;
  byId = new Map(out.map((c) => [c.id, c]));
  return out;
}

/** A special card's catalog entry and the player under it (a known one, or one made from the line's position, height and style). */
function specialCard(s: SpecialRow, themes: SpecialTheme[]): { def: CardDef; base: PlayerInfo } {
  const theme = themes.find((t) => t.id === s.theme);
  const known = people().get(s.player);
  const position = s.position ?? known?.position ?? 'SF';
  const heightM = s.heightM ?? known?.heightM ?? 2;
  const base: PlayerInfo = known
    ? { ...known, ...(s.look ? { look: { ...(known.look ?? LOOK), ...s.look } } : {}) }
    : { name: s.player, number: s.number ?? 0, heightM, position, ratings: startingRatings(position, s.style ?? 'allround', heightM), look: { ...LOOK, ...s.look } };
  const def: CardDef = {
    id: `x-${s.id}`,
    name: s.player,
    team: s.team ?? 'LAL',
    position,
    number: s.number ?? base.number,
    heightM,
    tier: tierOf(s.ovr),
    ovr: s.ovr,
    source: 'special',
    label: s.label ?? theme?.name ?? '特殊',
    theme: s.theme,
    ...(s.image ? { image: s.image } : {}),
    ...(theme?.levelOnly ? { levelOnly: true } : {}),
  };
  return { def, base };
}

/** A special card from a line not saved yet (the content editor's preview). */
export function previewSpecial(s: SpecialRow, themes: SpecialTheme[]): OwnedCard {
  const { def, base } = specialCard(s, themes);
  const ovr = Math.max(1, Math.min(99, Math.round(def.ovr) || 1));
  const r = exactly(base.ratings, def.position, ovr);
  return { ...def, ovr, tier: tierOf(ovr), uid: 'preview', ratings: RATING_KEYS.map((k) => r[k]) };
}

/** Whether a name is a player the game knows (today's roster or the history files). */
export const knownPlayer = (name: string): boolean => people().has(name);
/** Every player the game knows, by name. */
export const knownPlayers = (): string[] => [...people().keys()].sort();

export function catalogCard(id: string): CardDef | undefined {
  cardCatalog();
  return byId.get(id);
}

const CAPS = Object.fromEntries(RATING_KEYS.map((k) => [k, 99])) as unknown as Ratings;
const ratingsMemo = new Map<string, Ratings>();

/** The card's ratings at an overall (its own, or with its +N): its player's, reshaped until they show that overall. */
export function cardRatings(c: CardDef, ovr: number = c.ovr): Ratings {
  cardCatalog();
  const key = `${c.id}@${ovr}`;
  const hit = ratingsMemo.get(key);
  if (hit) return { ...hit };
  const real = cardBase.get(c.id);
  if (!real) return Object.fromEntries(RATING_KEYS.map((k) => [k, ovr])) as unknown as Ratings;
  const r = exactly(real.ratings, c.position, ovr);
  ratingsMemo.set(key, r);
  return { ...r };
}

/** Ratings reshaped to show an overall (whole-number ratings land a point off: step single ratings until it shows right). */
function exactly(ratings: Ratings, position: Position, ovr: number): Ratings {
  const r = toOverall(ratings, CAPS, ovr, (x) => overallOf(position, x));
  for (let i = 0; i < 60; i++) {
    const off = ovr - playerRating({ position, ratings: r });
    if (!off) break;
    const k = RATING_KEYS[i % RATING_KEYS.length];
    r[k] = Math.max(25, Math.min(99, r[k] + Math.sign(off)));
  }
  return r;
}

/** A copy of a catalog card (uid '' for a card shown but not owned). */
export function ownCard(c: CardDef, uid = '', plus = 0): OwnedCard {
  const ovr = Math.min(99, c.ovr + plus);
  const r = cardRatings(c, ovr);
  return { ...c, uid, ovr, ...(plus ? { plus } : {}), ratings: RATING_KEYS.map((k) => r[k]) };
}

/** Brings an owned copy up to date with the catalog (a roster update this season, a fixed history line). */
export function syncCard<T extends OwnedCard>(c: T): T {
  const def = catalogCard(c.id);
  const { period: _p, base: _b, ...rest } = c as T & { period?: unknown; base?: unknown };
  if (!def) {
    // Gone from the game: kept as it was, never dropping again.
    return { ...rest, source: rest.source ?? 'current', label: rest.label ?? '舊版', retired: true } as T;
  }
  return { ...rest, ...ownCard(def, c.uid, Math.min(PLUS_MAX, c.plus ?? 0)) } as T;
}

export function ratingsOf(c: OwnedCard): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k, i) => [k, c.ratings[i] ?? 50])) as unknown as Ratings;
}

/** The card as a player in a game (his look from the roster or the history files). */
export function cardPlayer(c: OwnedCard): PlayerInfo {
  cardCatalog();
  const look: Look | undefined = cardBase.get(c.id)?.look ?? NBA_TEAMS.flatMap((t) => t.players).find((p) => p.name === c.name)?.look;
  return { name: c.name, number: c.number, heightM: c.heightM, position: c.position, ratings: ratingsOf(c), ...(look ? { look } : {}) };
}

/** The card's three best ratings. */
export function topRatings(c: OwnedCard, n = 3): { key: keyof Ratings; value: number }[] {
  return RATING_KEYS.filter((k) => k !== 'stamina' && k !== 'ft')
    .map((key) => ({ key, value: c.ratings[RATING_KEYS.indexOf(key)] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

export const cardTeam = (c: CardDef): TeamInfo => findTeam(c.team);

// ----------------------------------------------------------------- packs

/** What one pull gave. */
export interface Drop {
  card: CardDef;
  /** Games, when it came as a rental (rewards only: packs never give rentals). */
  rental?: number;
}

/** Weeks since 1970 starting on Mondays: what is on this week. */
export const eventWeek = (now: number = Date.now()): number => Math.floor((Math.floor(now / 86_400_000) + 3) / 7);

const rotate = <T>(list: T[], week: number): T | undefined => (list.length ? list[((week % list.length) + list.length) % list.length] : undefined);

/** A theme with cards a pack may sell (not a levels-only one). */
const sells = (id: string | undefined): boolean => !!id && !specialTheme(id)?.levelOnly && SPECIAL.cards.some((c) => c.theme === id);

/**
 * The limited pack's theme: a running holiday's (活動關卡); otherwise this
 * week's in turn among the themes no holiday owns. A holiday's theme is never
 * sold outside its days; with nothing to sell the pack is off the shelf.
 */
export function limitedTheme(week: number = eventWeek(), now: number = Date.now()): SpecialTheme | undefined {
  const holiday = activeHolidays(now).find((h) => sells(h.theme));
  if (holiday) return specialTheme(holiday.theme);
  return rotate(
    SPECIAL_THEMES.filter((t) => sells(t.id) && !HOLIDAYS.some((h) => h.theme === t.id)),
    week,
  );
}

/** The next holiday that brings the limited pack back, and the day it starts (local midnight). */
export function nextLimited(now: number = Date.now()): { holiday: HolidayDef; starts: number } | null {
  const d = new Date(now);
  let best: { holiday: HolidayDef; starts: number } | null = null;
  for (const h of HOLIDAYS) {
    if (!sells(h.theme)) continue;
    const [m, day] = h.from.split('-').map(Number);
    let starts = new Date(d.getFullYear(), m - 1, day).getTime();
    if (starts <= now) starts = new Date(d.getFullYear() + 1, m - 1, day).getTime();
    if (!best || starts < best.starts) best = { holiday: h, starts };
  }
  return best;
}

/** This week's 復刻 season. */
export const reissueSeason = (week: number = eventWeek()): string | undefined => rotate(ARCHIVED_SEASONS, week);

/** The cards a pack can give this week. */
export function packPool(pack: PackDef, week: number = eventWeek()): CardDef[] {
  const names = pack.players?.length ? new Set(pack.players) : null;
  const theme = pack.kind === 'limited' ? limitedTheme(week)?.id : undefined;
  const season = pack.kind === 'reissue' ? reissueSeason(week) : undefined;
  if (pack.kind === 'reissue' && !season) return [];
  if (pack.kind === 'limited' && !theme) return [];
  return cardCatalog().filter(
    (c) =>
      (pack.kind === 'reissue' ? c.retired && c.season === season : !c.retired && !c.levelOnly && (c.source !== 'special' || c.theme === theme)) &&
      (!pack.tiers?.length || pack.tiers.includes(c.tier)) &&
      (!pack.positions?.length || pack.positions.includes(c.position)) &&
      (!names || names.has(c.name)),
  );
}

/** Each tier's chance of being pulled from this pack (tiers it cannot give are left out). */
export function packOdds(pack: PackDef, week: number = eventWeek()): { tier: TierId; chance: number }[] {
  const pool = packPool(pack, week);
  const tiers = TIERS.filter((t) => pool.some((c) => c.tier === t.id));
  const weight = (t: TierId) => Math.max(0, pack.weights?.[t] ?? DEFAULT_WEIGHTS[t]);
  const total = tiers.reduce((s, t) => s + weight(t.id), 0) || 1;
  return tiers.map((t) => ({ tier: t.id, chance: weight(t.id) / total }));
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

function rollTier(odds: { tier: TierId; chance: number }[], rand: () => number): TierId {
  const total = odds.reduce((s, o) => s + o.chance, 0);
  let r = rand() * total;
  for (const o of odds) {
    if (r < o.chance) return o.tier;
    r -= o.chance;
  }
  return odds[odds.length - 1].tier;
}

/** Opens a pack: no card twice in one pack. Empty when it has nothing to give this week. */
export function openPack(pack: PackDef, rand: () => number = Math.random, week: number = eventWeek()): Drop[] {
  const pool = packPool(pack, week);
  if (!pool.length) return [];
  const odds = packOdds(pack, week);
  const taken = new Set<string>();
  const drops: Drop[] = [];
  for (let i = 0; i < Math.max(1, Math.min(10, pack.count)); i++) {
    const g = i === 0 && pack.guarantee ? odds.filter((o) => tierIndex(o.tier) >= tierIndex(pack.guarantee!)) : [];
    const t = rollTier(g.length ? g : odds, rand);
    const ofTier = pool.filter((c) => c.tier === t);
    const left = ofTier.filter((c) => !taken.has(c.id));
    let from = left.length ? left : ofTier;
    // The limited pack: half its pulls of a tier with this week's special cards are one of them.
    const featured = from.filter((c) => c.source === 'special');
    if (featured.length && featured.length < from.length) from = rand() < 0.5 ? featured : from.filter((c) => c.source !== 'special');
    const card = pick(from, rand);
    taken.add(card.id);
    drops.push({ card });
  }
  // Best last, for the reveal.
  return drops.sort((a, b) => a.card.ovr - b.card.ovr);
}

/** Where a card comes from, in words (the collection's locked cards). */
export function cardWhere(c: CardDef): string[] {
  const out: string[] = [];
  if (c.source === 'special') {
    if (!c.levelOnly) {
      const holiday = HOLIDAYS.find((h) => h.theme === c.theme);
      out.push(`限定卡包（${specialTheme(c.theme)?.name ?? '特殊'}主題${holiday ? `，${holiday.name}期間` : '週'}）`);
    }
  } else if (c.retired) out.push('復刻卡包（輪到它的球季時）');
  else
    for (const p of OFFICIAL_PACKS) {
      if (p.kind || p.hidden) continue;
      if ((!p.tiers?.length || p.tiers.includes(c.tier)) && (!p.positions?.length || p.positions.includes(c.position))) out.push(p.name);
    }
  const sources = [...rewardSources(), ...MISSIONS.map((m) => ({ reward: m.reward, where: '' }))];
  if (!c.retired && c.source !== 'special' && sources.some((r) => r.reward.card === c.tier)) out.push(`${tier(c.tier).name}卡獎勵（關卡、任務）`);
  for (const s of sources) if (s.where && s.reward.cards?.includes(c.id)) out.push(s.reward.cards.length > 1 ? `${s.where}首勝（隨機一張）` : `${s.where}首勝`);
  return out;
}

// ----------------------------------------------------------------- the save

export const DECK_MAX = 13;
export const DECK_MIN = 5;

export interface MyTeamSave {
  v: 2;
  /** Highest ladder period unlocked (1-6). */
  period: number;
  /** Owned copies (a card up to five times). */
  cards: OwnedCard[];
  rentals: RentalCard[];
  /** Copy uids; the first five start. */
  deck: string[];
  /** Next copy or rental number. */
  next: number;
  packsOpened: number;
  /** Ladder levels beaten (ids). */
  cleared: string[];
  /** Missions whose reward was taken (ids). */
  claimed: string[];
  /** Running totals the missions count. */
  stats: Partial<Record<MissionStat, number>>;
  /** Event levels won this week (week:index). */
  events: string[];
  /** Holiday event levels won (id:year:index). */
  holidays: string[];
  /** Games in a row with the same starting five (its cohesion grows with them). */
  chem?: { key: string; games: number };
  /** The local day (YYYY-MM-DD) the first win's bonus was paid. */
  firstWin?: string;
  /** Coins the card update gave back (retired boosted cards), waiting for the wallet. */
  refund?: number;
}

export function emptyMyTeam(): MyTeamSave {
  return { v: 2, period: 1, cards: [], rentals: [], deck: [], next: 1, packsOpened: 0, cleared: [], claimed: [], stats: {}, events: [], holidays: [] };
}

/**
 * Version 1 saves: one copy per card id, the deck by card id, period-boosted
 * cards. Base cards become this season's cards; boosted ones are paid back at
 * their tier's value (save.refund, for the wallet).
 */
function fromV1(s: MyTeamSave): void {
  const tag = seasonTag(ROSTER_SEASON);
  const uids = new Map<string, string>();
  let refund = 0;
  const cards: OwnedCard[] = [];
  for (const c of s.cards as (OwnedCard & { id: string })[]) {
    if (/^p\d/.test(c.id)) {
      refund += tier(c.tier).value;
      continue;
    }
    const id = c.id.startsWith('b-') ? `s${tag}-${c.id.slice(2)}` : c.id;
    const uid = `c${s.next++}`;
    uids.set(c.id, uid);
    cards.push({ ...c, id, uid });
  }
  s.cards = cards;
  s.rentals = s.rentals.map((r) => (r.id.startsWith('b-') ? { ...r, id: `s${tag}-${r.id.slice(2)}` } : r));
  s.deck = s.deck.map((ref) => uids.get(ref) ?? ref);
  s.refund = (s.refund ?? 0) + refund;
}

/** Accepts anything that looks like a save, filling what is missing. */
export function upgradeMyTeam(raw: unknown): MyTeamSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const { customPacks: _gone, ...rest } = raw as Partial<MyTeamSave> & { customPacks?: unknown };
  if (!Array.isArray(rest.cards)) return null;
  const s: MyTeamSave = {
    ...emptyMyTeam(),
    ...rest,
    v: 2,
    period: Math.min(PERIODS, Math.max(1, Number(rest.period) || 1)),
    next: Math.max(1, Number(rest.next) || 1),
    rentals: Array.isArray(rest.rentals) ? rest.rentals.filter((r) => r.games > 0) : [],
    deck: Array.isArray(rest.deck) ? rest.deck : [],
    cleared: Array.isArray(rest.cleared) ? rest.cleared : [],
    claimed: Array.isArray(rest.claimed) ? rest.claimed : [],
    stats: rest.stats && typeof rest.stats === 'object' ? rest.stats : {},
    events: Array.isArray(rest.events) ? rest.events : [],
    holidays: Array.isArray(rest.holidays) ? rest.holidays : [],
  };
  if (rest.v !== 2) fromV1(s);
  s.cards = s.cards.map(syncCard);
  s.rentals = s.rentals.map(syncCard);
  return s;
}

/** A deck slot's card: an owned copy or a rental, by uid. */
export function deckCard(save: MyTeamSave, ref: string): OwnedCard | RentalCard | null {
  return save.rentals.find((r) => r.uid === ref) ?? save.cards.find((c) => c.uid === ref) ?? null;
}

export const isRental = (c: OwnedCard): c is RentalCard => 'games' in c;
export const refOf = (c: OwnedCard): string => c.uid;

/** How many copies of a card are owned. */
export const copiesOf = (save: MyTeamSave, id: string): OwnedCard[] => save.cards.filter((c) => c.id === id);

/** Starters: the best card at each position; then the best of the rest. */
export function autoDeck(save: MyTeamSave): string[] {
  const all: OwnedCard[] = [...save.cards, ...save.rentals].sort((a, b) => b.ovr - a.ovr);
  const used = new Set<string>();
  const names = new Set<string>();
  const deck: string[] = [];
  const take = (c: OwnedCard) => {
    used.add(refOf(c));
    names.add(c.name);
    deck.push(refOf(c));
  };
  for (const pos of POSITIONS) {
    const c = all.find((x) => x.position === pos && !used.has(refOf(x)) && !names.has(x.name));
    if (c) take(c);
  }
  for (const c of all) {
    if (deck.length >= DECK_MAX) break;
    if (!used.has(refOf(c)) && !names.has(c.name)) take(c);
  }
  return deck;
}

/** Keeps only cards that still exist, no player twice, at most 13. */
export function cleanDeck(save: MyTeamSave): void {
  const names = new Set<string>();
  save.deck = save.deck.filter((ref) => {
    const c = deckCard(save, ref);
    if (!c || names.has(c.name)) return false;
    names.add(c.name);
    return true;
  });
  save.deck = save.deck.slice(0, DECK_MAX);
}

const uidFor = (save: MyTeamSave, rental = false) => `${rental ? 'r' : 'c'}${save.next++}`;

/** Cards packs and rewards can give (not past seasons, not special cards). */
const regularCards = (): CardDef[] => cardCatalog().filter((c) => !c.retired && c.source !== 'special');

/** A new collection: two plain current cards per position and five loaned stars (three games each). */
export function newMyTeam(rand: () => number = Math.random): MyTeamSave {
  const save = emptyMyTeam();
  const cards = regularCards();
  for (const pos of POSITIONS) {
    const plain = cards.filter((c) => c.source === 'current' && c.position === pos && c.ovr <= 75);
    for (let i = 0; i < 2; i++) {
      const left = plain.filter((c) => !save.cards.some((o) => o.id === c.id));
      if (left.length) save.cards.push(ownCard(pick(left, rand), uidFor(save)));
    }
  }
  for (const pos of POSITIONS) {
    const stars = cards.filter((c) => c.position === pos && (c.tier === 'gold' || c.tier === 'pink') && !save.rentals.some((r) => r.name === c.name));
    if (stars.length) save.rentals.push({ ...ownCard(pick(stars, rand), uidFor(save, true)), games: 3 });
  }
  save.deck = autoDeck(save);
  return save;
}

/** What adding one drop did: a new card, another copy, a sixth copy turned into coins, or a rental. */
export interface DropResult {
  card: OwnedCard | RentalCard;
  coins: number;
  /** The first copy. */
  isNew: boolean;
  /** Already five copies: paid out instead. */
  full?: boolean;
}

/** Adds a pack's cards to the collection (a sixth copy becomes coins: returned, for the wallet). */
export function addDrops(save: MyTeamSave, drops: Drop[], fromPack = true): DropResult[] {
  if (fromPack) save.packsOpened++;
  return drops.map((d) => {
    if (d.rental) {
      const r: RentalCard = { ...ownCard(d.card, uidFor(save, true)), games: d.rental };
      save.rentals.push(r);
      return { card: r, coins: 0, isNew: true };
    }
    const have = copiesOf(save, d.card.id).length;
    if (have >= COPY_MAX) return { card: ownCard(d.card), coins: tier(d.card.tier).value, isNew: false, full: true };
    const c = ownCard(d.card, uidFor(save));
    save.cards.push(c);
    return { card: c, coins: 0, isNew: have === 0 };
  });
}

/** What a copy sells for: its tier's value for it and every duplicate merged into it. */
export const sellValue = (c: OwnedCard): number => tier(c.tier).value * (1 + (c.plus ?? 0));

/** Sells an owned copy (never a rental) for coins; it leaves the deck too. */
export function sellCard(save: MyTeamSave, uid: string): number {
  const i = save.cards.findIndex((c) => c.uid === uid);
  if (i < 0) return 0;
  const [c] = save.cards.splice(i, 1);
  save.deck = save.deck.filter((r) => r !== uid);
  return sellValue(c);
}

/** The copy a merge would use up: the weakest other copy, one outside the deck if it can. */
export function mergeFodder(save: MyTeamSave, uid: string): OwnedCard | null {
  const target = save.cards.find((c) => c.uid === uid);
  if (!target) return null;
  const others = copiesOf(save, target.id).filter((c) => c.uid !== uid);
  others.sort((a, b) => Number(save.deck.includes(a.uid)) - Number(save.deck.includes(b.uid)) || (a.plus ?? 0) - (b.plus ?? 0));
  return others[0] ?? null;
}

/** Merges one duplicate into a copy: +1 overall, up to +5. False when it cannot. */
export function mergeCard(save: MyTeamSave, uid: string): boolean {
  const i = save.cards.findIndex((c) => c.uid === uid);
  const fodder = mergeFodder(save, uid);
  if (i < 0 || !fodder || (save.cards[i].plus ?? 0) >= PLUS_MAX) return false;
  save.cards = save.cards.filter((c) => c.uid !== fodder.uid);
  save.deck = save.deck.filter((r) => r !== fodder.uid);
  const at = save.cards.findIndex((c) => c.uid === uid);
  save.cards[at] = syncCard({ ...save.cards[at], plus: (save.cards[at].plus ?? 0) + 1 });
  return true;
}

/** The deck as a team: starters first, in position order. */
export function deckTeam(save: MyTeamSave, info: Pick<TeamInfo, 'abbr' | 'name' | 'primary' | 'secondary'>): TeamInfo {
  return { ...info, players: deckLineup(save).map(cardPlayer) };
}

/** The deck's cards in game roster order. */
export function deckLineup(save: MyTeamSave): OwnedCard[] {
  const cards = save.deck.map((r) => deckCard(save, r)).filter((c): c is OwnedCard => !!c);
  const starters = cards.slice(0, 5).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
  return [...starters, ...cards.slice(5)];
}

/** The deck's rating: its starters' average overall. */
export function deckRating(save: MyTeamSave): number {
  const starters = save.deck.slice(0, 5).map((r) => deckCard(save, r)?.ovr ?? 0);
  return starters.length ? Math.round(starters.reduce((a, b) => a + b, 0) / starters.length) : 0;
}

/** The starting five, order aside: the same five keep building cohesion. */
const starterKey = (save: MyTeamSave): string => [...save.deck.slice(0, 5)].sort().join('|');

/** The deck's cohesion: 40 for a new starting five, +2 a game together, up to 90. */
export function deckCohesion(save: MyTeamSave): number {
  const games = save.chem?.key === starterKey(save) ? save.chem.games : 0;
  return Math.min(90, 40 + 2 * games);
}

/** A game played with the deck's starting five. */
export function noteDeckGame(save: MyTeamSave): void {
  const key = starterKey(save);
  save.chem = { key, games: save.chem?.key === key ? save.chem.games + 1 : 1 };
}

/** The first MyTeam win of each local day pays this on top. */
export const FIRST_WIN_COINS = 900;

export function localDay(now: number = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day's first win: pays (once a day) and remembers. */
export function firstWinBonus(save: MyTeamSave, won: boolean, day: string = localDay()): number {
  if (!won || save.firstWin === day) return 0;
  save.firstWin = day;
  return FIRST_WIN_COINS;
}

// ----------------------------------------------------------------- playing

/** Your side's colours in MyTeam games. */
export const MYTEAM_INFO: Pick<TeamInfo, 'abbr' | 'name' | 'primary' | 'secondary'> = {
  abbr: 'MY',
  name: 'MyTeam',
  primary: '#ff7a1a',
  secondary: '#14161f',
};

export type MissionStat =
  | 'games'
  | 'wins'
  | 'cleared'
  | 'streetWins'
  | 'points'
  | 'threes'
  | 'assists'
  | 'blocks'
  | 'steals'
  | 'packs'
  | 'cards'
  | 'deckRating'
  | 'bigWins'
  /** Street dynasty periods fully beaten. */
  | 'dynasty'
  /** Special levels (特殊關卡) beaten. */
  | 'limited'
  /** Event levels won (each counts once a week). */
  | 'events';

/** What a level, a mission or a boss gives. */
export interface Reward {
  coins?: number;
  /** An official pack, opened on the spot. */
  pack?: string;
  /** A rental (3 games) of this tier. */
  rental?: TierId;
  /** A card of this tier to keep. */
  card?: TierId;
  /** One of these cards (by id), at random. */
  cards?: string[];
}

export interface LevelDef {
  id: string;
  period: number;
  /** NBA team (abbreviation) ... */
  team: string;
  /** ... with its starters rescaled to this team rating. */
  ovr: number;
  difficulty: Difficulty;
  boss?: boolean;
  /** For the first win. */
  reward: Reward;
}

export interface MissionDef {
  id: string;
  text: string;
  stat: MissionStat;
  target: number;
  reward: Reward;
}

const CONTENT = myteamJson as unknown as { levels: LevelDef[]; missions: MissionDef[] };
export const LEVELS: LevelDef[] = CONTENT.levels;
export const MISSIONS: MissionDef[] = CONTENT.missions;
/** Missions claimed that open each next period (3 open period 2, 6 period 3, ...). */
export const MISSIONS_PER_PERIOD = 3;
/** Coins for games that are not a first ladder win. */
export const GAME_COINS = { win: 675, loss: 225, ladderReplay: 450 };

export const periodLevels = (period: number): LevelDef[] => LEVELS.filter((l) => l.period === period);

/** Playable: its period is open and the level before it is beaten. */
export function levelOpen(save: MyTeamSave, level: LevelDef): boolean {
  if (level.period > save.period) return false;
  const list = periodLevels(level.period);
  const i = list.indexOf(level);
  return i <= 0 || save.cleared.includes(list[i - 1].id);
}

export function periodCleared(save: MyTeamSave, period: number): boolean {
  const list = periodLevels(period);
  return list.length > 0 && list.every((l) => save.cleared.includes(l.id));
}

/** What a mission counts right now. */
export function statValue(save: MyTeamSave, key: MissionStat): number {
  if (key === 'cards') return new Set(save.cards.map((c) => c.id)).size;
  if (key === 'packs') return save.packsOpened;
  if (key === 'cleared') return LEVELS.filter((l) => save.cleared.includes(l.id)).length;
  if (key === 'limited') return [...LIMITED, ...legacyLevels()].filter((l) => save.cleared.includes(l.id)).length;
  if (key === 'dynasty') return Array.from({ length: PERIODS }, (_, i) => i + 1).filter((p) => dynastyCleared(save, p)).length;
  if (key === 'deckRating') {
    // Your own cards' best five: rentals do not count.
    const own = { ...save, rentals: [] };
    return deckRating({ ...own, deck: autoDeck(own) });
  }
  return save.stats[key] ?? 0;
}

export const missionDone = (save: MyTeamSave, m: MissionDef): boolean => statValue(save, m.stat) >= m.target;

/** Opens every period the save has earned. Returns the new period when one opened. */
export function updatePeriod(save: MyTeamSave): number | null {
  const before = save.period;
  while (save.period < PERIODS && (periodCleared(save, save.period) || save.claimed.length >= MISSIONS_PER_PERIOD * save.period)) {
    save.period++;
  }
  return save.period > before ? save.period : null;
}

/** A team of real players rescaled so its starters rate `target` (each keeps his place in the order). */
export function scaleTeam(team: TeamInfo, target: number): TeamInfo {
  const shifted = (delta: number): TeamInfo => ({
    ...team,
    players: team.players.map((p) => {
      const want = Math.max(45, Math.min(99, playerRating(p) + delta));
      return { ...p, ratings: toOverall(p.ratings, CAPS, want, (r) => overallOf(p.position, r)) };
    }),
  });
  // Players at the 45-99 limits stop moving: push the rest a little further.
  let delta = target - teamRating(team);
  let out = shifted(delta);
  for (let i = 0; i < 4 && teamRating(out) !== target; i++) {
    delta += target - teamRating(out);
    out = shifted(delta);
  }
  return out;
}

export const levelTeam = (level: LevelDef): TeamInfo => scaleTeam(findTeam(level.team), level.ovr);

/** A random NBA team at your deck's level, for a quick game. */
export function quickOpponent(save: MyTeamSave, rand: () => number = Math.random): TeamInfo {
  return scaleTeam(pick(NBA_TEAMS, rand), Math.max(60, deckRating(save)));
}

/** Street opponents: `n` random NBA players (one per position, guards first) rated around `ovr`. */
export function streetOpponents(n: number, ovr: number, avoid: string[], rand: () => number = Math.random): PlayerInfo[] {
  const order: Position[][] = [['PG', 'SG'], ['SF', 'PF'], ['C', 'PF']];
  const used = new Set(avoid);
  const out: PlayerInfo[] = [];
  for (let i = 0; i < n; i++) {
    const want = order[i % order.length];
    const pool = NBA_TEAMS.flatMap((t) => t.players).filter((p) => want.includes(p.position) && !used.has(p.name));
    const p = pick(pool, rand);
    used.add(p.name);
    const target = Math.max(45, Math.min(99, Math.round(ovr + (rand() - 0.5) * 4)));
    out.push({ ...p, ratings: toOverall(p.ratings, CAPS, target, (r) => overallOf(p.position, r)) });
  }
  return out;
}

/** Gives a reward: coins to add to the wallet, and any cards it brought (for the reveal). */
export function grantReward(save: MyTeamSave, reward: Reward, rand: () => number = Math.random): { coins: number; drops: DropResult[] } {
  let coins = reward.coins ?? 0;
  const drops: DropResult[] = [];
  const pack = reward.pack ? OFFICIAL_PACKS.find((p) => p.id === reward.pack) : undefined;
  if (pack) drops.push(...addDrops(save, openPack(pack, rand)));
  const ofTier = (t: TierId) => regularCards().filter((c) => c.tier === t);
  if (reward.rental && ofTier(reward.rental).length) drops.push(...addDrops(save, [{ card: pick(ofTier(reward.rental), rand), rental: 3 }], false));
  if (reward.card && ofTier(reward.card).length) drops.push(...addDrops(save, [{ card: pick(ofTier(reward.card), rand) }], false));
  const named = (reward.cards ?? []).map(catalogCard).filter((c): c is CardDef => !!c);
  if (named.length) drops.push(...addDrops(save, [{ card: pick(named, rand) }], false));
  coins += drops.reduce((s, d) => s + d.coins, 0);
  return { coins, drops };
}

export type GameKind = 'ladder' | 'quick' | 'street' | 'dynasty' | 'limited' | 'event';

export interface GameResult {
  kind: GameKind;
  won: boolean;
  /** Your score minus theirs. */
  margin: number;
  /** Ladder, dynasty or limited level id. */
  level?: string;
  /** An event level: its week and place in the week. */
  event?: { week: number; index: number };
  /** A holiday event level: which, the year it runs, its place. */
  holiday?: { id: string; year: number; index: number };
  /** A 3v3 game (counts as a street win). */
  street?: boolean;
  /** Deck refs that played (rentals among them lose a game). */
  used: string[];
  /** Your team's totals. */
  totals: { points: number; threes: number; assists: number; blocks: number; steals: number };
  /** Left before the end: a loss with no coins. */
  forfeit?: boolean;
  /** The computer's level: scales the game's coins (not level rewards). */
  difficulty?: Difficulty;
}

export interface GameOutcome {
  coins: number;
  drops: DropResult[];
  firstClear: boolean;
  /** Rentals that played their last game (names). */
  gone: string[];
  /** The period that just opened. */
  unlocked: number | null;
  /** The day's first win bonus (in coins already). */
  firstWin: number;
}

/** Books a finished MyTeam game: counters, rentals, coins and ladder rewards. */
export function recordGame(save: MyTeamSave, g: GameResult, rand: () => number = Math.random, day: string = localDay()): GameOutcome {
  const won = g.won && !g.forfeit;
  const add = (k: MissionStat, n: number) => (save.stats[k] = (save.stats[k] ?? 0) + n);
  add('games', 1);
  if (won) add('wins', 1);
  if (won && (g.kind === 'street' || g.street)) add('streetWins', 1);
  if (won && g.margin >= 20) add('bigWins', 1);
  if (!g.forfeit) {
    add('points', g.totals.points);
    add('threes', g.totals.threes);
    add('assists', g.totals.assists);
    add('blocks', g.totals.blocks);
    add('steals', g.totals.steals);
  }
  const gone: string[] = [];
  for (const ref of g.used) {
    const r = save.rentals.find((x) => x.uid === ref);
    if (!r) continue;
    r.games--;
    if (r.games <= 0) gone.push(r.name);
  }
  save.rentals = save.rentals.filter((r) => r.games > 0);
  cleanDeck(save);

  let coins = 0;
  let drops: DropResult[] = [];
  let firstClear = false;
  const level = g.level ? [...LEVELS, ...DYNASTY, ...LIMITED, ...legacyLevels()].find((l) => l.id === g.level) : undefined;
  const theme = g.event ? eventTheme(g.event.week) : undefined;
  const holiday = g.holiday ? HOLIDAYS.find((h) => h.id === g.holiday!.id) : undefined;
  if (g.forfeit) coins = 0;
  else if (level) {
    if (won && !save.cleared.includes(level.id)) {
      firstClear = true;
      save.cleared.push(level.id);
      ({ coins, drops } = grantReward(save, level.reward, rand));
    } else coins = won ? GAME_COINS.ladderReplay : GAME_COINS.loss;
  } else if (g.holiday && holiday?.levels[g.holiday.index]) {
    // Each holiday level pays once a year.
    const key = holidayKey(holiday.id, g.holiday.year, g.holiday.index);
    if (won && !save.holidays.includes(key)) {
      firstClear = true;
      save.holidays.push(key);
      add('events', 1);
      ({ coins, drops } = grantReward(save, holiday.levels[g.holiday.index].reward, rand));
    } else coins = won ? GAME_COINS.ladderReplay : GAME_COINS.loss;
  } else if (g.event && theme?.levels[g.event.index]) {
    // Only this week's wins are kept; each level pays once a week.
    const key = eventKey(g.event.week, g.event.index);
    save.events = save.events.filter((k) => k.startsWith(`${g.event!.week}:`));
    if (won && !save.events.includes(key)) {
      firstClear = true;
      save.events.push(key);
      add('events', 1);
      ({ coins, drops } = grantReward(save, theme.levels[g.event.index].reward, rand));
    } else coins = won ? GAME_COINS.ladderReplay : GAME_COINS.loss;
  } else coins = won ? GAME_COINS.win : GAME_COINS.loss;
  if (!firstClear) coins = Math.round(coins * DIFFICULTY_COINS[g.difficulty ?? 'normal']);
  const firstWin = g.forfeit ? 0 : firstWinBonus(save, won, day);
  return { coins: coins + firstWin, drops, firstClear, gone, unlocked: updatePeriod(save), firstWin };
}

/** Takes a finished mission's reward. Null when it is not done or already taken. */
export function claimMission(
  save: MyTeamSave,
  id: string,
  rand: () => number = Math.random,
): { coins: number; drops: DropResult[]; unlocked: number | null } | null {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m || save.claimed.includes(id) || !missionDone(save, m)) return null;
  save.claimed.push(id);
  const r = grantReward(save, m.reward, rand);
  return { ...r, unlocked: updatePeriod(save) };
}

// ------------------------------------------------- dynasty, limited, events

/** Street dynasty (街頭王朝): 3v3 crews, five a period, beaten in order like the ladder. */
export interface DynastyDef {
  id: string;
  period: number;
  /** The crew. */
  name: string;
  /** Each of its three players rates about this. */
  ovr: number;
  difficulty: Difficulty;
  boss?: boolean;
  reward: Reward;
}

/** What a limited level lets you play with. Height limits are the lineup's average (m). */
export interface LineupRule {
  positions?: Position[];
  maxOvr?: number;
  sameTeam?: boolean;
  maxHeight?: number;
  minHeight?: number;
  noRentals?: boolean;
  tiers?: TierId[];
  /** Current-player cards only. */
  baseOnly?: boolean;
  /** Only cards from these sources. */
  sources?: CardSource[];
  /** The card's year (see cardYear) within these; cards with no year never fit. */
  minYear?: number;
  maxYear?: number;
  /** Every card from the same year. */
  sameYear?: boolean;
  /** Only this award's cards. */
  award?: HistoryAward;
  /** At least this many current-player / history (champion, award, Hall of Fame) cards. */
  minCurrent?: number;
  minHistory?: number;
}

/** 特殊關卡's groups: the two rule sets, then the history teams. */
export type SpecialGroup = 'c1' | 'c2' | 'champions' | 'hof' | 'olympic';
export const SPECIAL_GROUPS: [SpecialGroup, string][] = [
  ['c1', '挑戰（一）'],
  ['c2', '挑戰（二）'],
  ['champions', '歷年總冠軍'],
  ['hof', '名人堂'],
  ['olympic', '奧運美國隊'],
];

/** Rule levels (特殊關卡 挑戰): a lineup rule, 3v3 or 5v5 (against `team`), one reward each. */
export interface LimitedDef {
  id: string;
  /** c1 (the first twenty) unless set. */
  group?: 'c1' | 'c2';
  name: string;
  rule: LineupRule;
  size: 3 | 5;
  team?: string;
  ovr: number;
  difficulty: Difficulty;
  reward: Reward;
}

/** Who an event team is made of: the best by a rating (or height) among a set of players. */
export interface EventPick {
  sort?: keyof Ratings | 'height';
  positions?: Position[];
  teams?: string[];
  conference?: 'East' | 'West';
  /** A custom-team menu group, e.g. 台灣. */
  group?: string;
}

export interface EventLevelDef {
  size: 3 | 5;
  /** Added to your period's base rating. */
  offset: number;
  difficulty: Difficulty;
  reward: Reward;
  pick: EventPick;
}

/** A week's event (活動關卡): three themed levels, each paying once a week. */
export interface EventTheme {
  id: string;
  name: string;
  desc: string;
  levels: EventLevelDef[];
}

/** A holiday event (活動關卡): the same days every year, five levels in order, each paying once a year. */
export interface HolidayDef {
  id: string;
  name: string;
  desc: string;
  /** MM-DD, both days in. */
  from: string;
  to: string;
  /** A special-card theme: the limited pack sells it while the holiday runs. */
  theme?: string;
  levels: EventLevelDef[];
}

interface LegacyKind {
  difficulty: Difficulty;
  reward: Reward;
}

const MODES = myteamJson as unknown as {
  dynasty: DynastyDef[];
  limited: LimitedDef[];
  events: EventTheme[];
  holidays: HolidayDef[];
  legacy: Record<'champions' | 'hof' | 'olympic', LegacyKind>;
};
export const DYNASTY: DynastyDef[] = MODES.dynasty;
export const LIMITED: LimitedDef[] = MODES.limited;
export const EVENT_THEMES: EventTheme[] = MODES.events;
export const HOLIDAYS: HolidayDef[] = MODES.holidays ?? [];

export const limitedGroup = (l: LimitedDef): 'c1' | 'c2' => l.group ?? 'c1';

/** Every level and boss reward there is, with where it is won (for rewards that name cards). */
function rewardSources(): { reward: Reward; where: string }[] {
  const group = (g: SpecialGroup) => SPECIAL_GROUPS.find(([k]) => k === g)?.[1] ?? '';
  return [
    ...[...LEVELS, ...DYNASTY, ...LIMITED, ...EVENT_THEMES.flatMap((t) => t.levels)].map((l) => ({ reward: l.reward, where: '' })),
    ...legacyLevels().map((l) => ({ reward: l.reward, where: `特殊關卡・${group(l.group)}・${l.name}` })),
    ...HOLIDAYS.flatMap((h) => h.levels.map((l, i) => ({ reward: l.reward, where: `活動關卡・${h.name}第 ${i + 1} 關` }))),
  ];
}

// ----------------------------------------------------------------- history levels

/** A history level (特殊關卡 歷年總冠軍 / 名人堂 / 奧運美國隊): a real team of the past, played with your deck. */
export interface LegacyDef {
  id: string;
  group: 'champions' | 'hof' | 'olympic';
  name: string;
  /** Logo and colours: an NBA team, or Team USA. */
  team?: string;
  colors?: [string, string];
  difficulty: Difficulty;
  reward: Reward;
  /** Starters first: each at his card's overall (card: the card he plays as). */
  players: { name: string; ovr: number; card?: string }[];
}

/** A player's best card overall (special cards aside). */
function bestCardOvr(name: string): number | undefined {
  const own = cardCatalog().filter((c) => c.name === name && c.source !== 'special');
  return own.length ? Math.max(...own.map((c) => c.ovr)) : undefined;
}

const avg = (list: number[]) => Math.round(list.reduce((a, b) => a + b, 0) / Math.max(1, list.length));

let legacyMemo: LegacyDef[] | null = null;
export function legacyLevels(): LegacyDef[] {
  if (legacyMemo) return legacyMemo;
  const kinds = MODES.legacy;
  const out: LegacyDef[] = [];
  for (const [year, team, six] of HISTORY.champions) {
    const players: LegacyDef['players'] = six.map((name, i) => ({ name, ovr: CHAMPION_OVR[i] ?? 90, card: `c${year}-${slug(name)}` }));
    const bench = avg(players.map((p) => p.ovr));
    for (const name of HISTORY.championBench?.[year] ?? []) players.push({ name, ovr: bench });
    out.push({
      id: `ch${year}`,
      group: 'champions',
      name: `${year} ${findTeam(team).name}`,
      team,
      difficulty: kinds.champions.difficulty,
      reward: { ...kinds.champions.reward, cards: six.map((n) => `c${year}-${slug(n)}`) },
      players,
    });
  }
  const hofOvr = new Map(HISTORY.hof.map(([name, , ovr]) => [name, ovr]));
  for (const g of HISTORY.hofTeams ?? []) {
    const five = g.players.map((name) => ({ name, ovr: hofOvr.get(name) ?? 90, card: `h-${slug(name)}` }));
    const bench = avg(five.map((p) => p.ovr));
    // Three more Hall of Famers from other teams: a guard, a wing, a big (the same ones every time).
    const others = HISTORY.hof.map(([name]) => name).filter((name) => !g.players.includes(name));
    const rand = seeded(hash(g.id));
    const extra: string[] = [];
    for (const want of [['PG', 'SG'], ['SF', 'PF'], ['C', 'PF']] as Position[][]) {
      const fits = others.filter((name) => !extra.includes(name) && want.includes(people().get(name)?.position ?? 'SF'));
      if (fits.length) extra.push(pick(fits, rand));
    }
    out.push({
      id: `hof-${g.id}`,
      group: 'hof',
      name: g.name,
      team: g.team,
      colors: ['#8a6d1f', '#14161f'],
      difficulty: kinds.hof.difficulty,
      reward: { ...kinds.hof.reward, cards: g.players.map((n) => `h-${slug(n)}`) },
      players: [...five, ...extra.map((name) => ({ name, ovr: bench, card: `h-${slug(name)}` }))],
    });
  }
  for (const o of HISTORY.olympics ?? []) {
    out.push({
      id: `oly${o.year}`,
      group: 'olympic',
      name: `${o.year} 美國隊`,
      colors: ['#0a3161', '#b31942'],
      difficulty: kinds.olympic.difficulty,
      reward: { ...kinds.olympic.reward, cards: [`x-${o.card}`] },
      players: o.players.map((p) => (typeof p === 'string' ? { name: p, ovr: bestCardOvr(p) ?? 88 } : { name: p[0], ovr: p[1] })),
    });
  }
  legacyMemo = out;
  return out;
}

/** A history level's opponent: its players at their card overalls (the card's look and shape when there is one). */
export function legacyTeam(l: LegacyDef): TeamInfo {
  const players = l.players.flatMap((p) => {
    const def = p.card ? catalogCard(p.card) : undefined;
    if (def) return [reshape(cardPlayer(ownCard(def)), p.ovr)];
    const base = people().get(p.name);
    return base ? [reshape(base, p.ovr)] : [];
  });
  const starters = players.slice(0, 5).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
  const nba = l.team ? findTeam(l.team) : undefined;
  const [primary, secondary] = l.colors ?? [nba?.primary ?? '#7a3cff', nba?.secondary ?? '#ffffff'];
  return {
    abbr: l.group === 'olympic' ? 'USA' : l.group === 'hof' ? 'HOF' : (nba?.abbr ?? '冠軍'),
    name: l.name,
    primary,
    secondary,
    players: [...starters, ...players.slice(5)],
  };
}

/** A player with his ratings moved to an overall. */
function reshape(p: PlayerInfo, ovr: number): PlayerInfo {
  if (playerRating(p) === ovr) return p;
  return { ...p, ratings: exactly(p.ratings, p.position, ovr) };
}

// ----------------------------------------------------------------- holidays

const monthDay = (text: string): number => {
  const [m, d] = text.split('-').map(Number);
  return m * 100 + d;
};

/** Whether a holiday runs on this local day: the year it began and when it ends. */
export function holidayOn(h: HolidayDef, now: number = Date.now()): { year: number; ends: number } | null {
  const d = new Date(now);
  const today = (d.getMonth() + 1) * 100 + d.getDate();
  const a = monthDay(h.from);
  const b = monthDay(h.to);
  const on = a <= b ? today >= a && today <= b : today >= a || today <= b;
  if (!on) return null;
  const year = a <= b || today >= a ? d.getFullYear() : d.getFullYear() - 1;
  const [m, day] = h.to.split('-').map(Number);
  return { year, ends: new Date(a <= b ? year : year + 1, m - 1, day + 1).getTime() };
}

export const activeHolidays = (now: number = Date.now()): HolidayDef[] => HOLIDAYS.filter((h) => holidayOn(h, now));
export const holidayKey = (id: string, year: number, index: number): string => `${id}:${year}:${index}`;

/** Holiday levels go in order: the one before must be won this year. */
export const holidayOpen = (save: MyTeamSave, h: HolidayDef, year: number, index: number): boolean =>
  index <= 0 || save.holidays.includes(holidayKey(h.id, year, index - 1));

/** Whole days left until `ends` (at least 1). */
export const daysLeft = (ends: number, now: number = Date.now()): number => Math.max(1, Math.ceil((ends - now) / 86_400_000));

/** A repeatable random stream from a seed (opponents stay the same each visit). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dynastyLevels = (period: number): DynastyDef[] => DYNASTY.filter((d) => d.period === period);

/** Playable: the ladder has opened its period and the crew before it is beaten. */
export function dynastyOpen(save: MyTeamSave, d: DynastyDef): boolean {
  if (d.period > save.period) return false;
  const list = dynastyLevels(d.period);
  const i = list.indexOf(d);
  return i <= 0 || save.cleared.includes(list[i - 1].id);
}

export function dynastyCleared(save: MyTeamSave, period: number): boolean {
  const list = dynastyLevels(period);
  return list.length > 0 && list.every((d) => save.cleared.includes(d.id));
}

/** The crew's three players (the same every time). */
export const dynastyCrew = (d: DynastyDef): PlayerInfo[] => streetOpponents(3, d.ovr, [], seeded(hash(d.id)));

/** A limited level's opponent: a rescaled NBA team, or a fixed street trio. */
export function limitedTeam(l: LimitedDef): TeamInfo {
  if (l.size === 5) return scaleTeam(findTeam(l.team ?? 'NYK'), l.ovr);
  return { abbr: '限定', name: l.name, primary: '#7a3cff', secondary: '#ffffff', players: streetOpponents(3, l.ovr, [], seeded(hash(l.id))) };
}

/** Whether a card fits the rule next to the cards already picked. */
export function cardAllowed(rule: LineupRule, card: OwnedCard, picked: OwnedCard[] = []): boolean {
  if (rule.positions && !rule.positions.includes(card.position)) return false;
  if (rule.sources && !rule.sources.includes(card.source)) return false;
  if (rule.award && !(card.source === 'award' && card.id.includes(`-${rule.award}-`))) return false;
  const year = cardYear(card);
  if ((rule.minYear !== undefined || rule.maxYear !== undefined || rule.sameYear) && year === undefined) return false;
  if (rule.minYear !== undefined && year! < rule.minYear) return false;
  if (rule.maxYear !== undefined && year! > rule.maxYear) return false;
  if (rule.sameYear && picked.length && cardYear(picked[0]) !== year) return false;
  if (rule.maxOvr !== undefined && card.ovr > rule.maxOvr) return false;
  if (rule.noRentals && isRental(card)) return false;
  if (rule.tiers && !rule.tiers.includes(card.tier)) return false;
  if (rule.baseOnly && card.source !== 'current') return false;
  if (rule.sameTeam && picked.length && picked[0].team !== card.team) return false;
  return true;
}

/** Why a lineup cannot play this rule, or null when it can. */
export function lineupProblem(rule: LineupRule, cards: OwnedCard[], size: number): string | null {
  if (cards.length !== size) return `要選 ${size} 人`;
  if (new Set(cards.map((c) => c.name)).size !== cards.length) return '同一名球員只能上一張';
  if (cards.some((c, i) => !cardAllowed(rule, c, cards.slice(0, i)))) return '有卡不符合限定條件';
  const current = cards.filter((c) => c.source === 'current').length;
  const history = cards.filter(isHistory).length;
  if (rule.minCurrent && current < rule.minCurrent) return `至少要 ${rule.minCurrent} 張現役卡`;
  if (rule.minHistory && history < rule.minHistory) return `至少要 ${rule.minHistory} 張歷史卡`;
  const h = cards.reduce((t, c) => t + c.heightM, 0) / cards.length;
  if (rule.maxHeight !== undefined && h > rule.maxHeight + 1e-9) return `平均身高 ${Math.round(h * 100)} 公分，要 ≤ ${Math.round(rule.maxHeight * 100)}`;
  if (rule.minHeight !== undefined && h < rule.minHeight - 1e-9) return `平均身高 ${Math.round(h * 100)} 公分，要 ≥ ${Math.round(rule.minHeight * 100)}`;
  return null;
}

/** The rule in words, one condition each. */
export function ruleText(rule: LineupRule): string[] {
  const out: string[] = [];
  if (rule.positions) out.push(`只能用 ${rule.positions.join('／')}`);
  if (rule.maxOvr !== undefined) out.push(`每張卡總評 ≤ ${rule.maxOvr}`);
  if (rule.sameTeam) out.push('全部同一支 NBA 球隊');
  if (rule.maxHeight !== undefined) out.push(`平均身高 ≤ ${Math.round(rule.maxHeight * 100)} 公分`);
  if (rule.minHeight !== undefined) out.push(`平均身高 ≥ ${Math.round(rule.minHeight * 100)} 公分`);
  if (rule.noRentals) out.push('不能用租借卡');
  if (rule.tiers) out.push(`只能用${rule.tiers.map((t) => tier(t).name).join('、')}卡`);
  if (rule.baseOnly) out.push('只能用現役卡');
  if (rule.sources) out.push(`只能用${rule.sources.map((s) => CARD_SOURCES.find(([k]) => k === s)?.[1] ?? s).join('、')}卡`);
  if (rule.award) out.push(`只能用${AWARDS[rule.award].name}卡`);
  if (rule.minYear !== undefined && rule.maxYear !== undefined) out.push(`卡片年份 ${rule.minYear}–${rule.maxYear}`);
  else if (rule.maxYear !== undefined) out.push(`卡片年份 ${rule.maxYear} 以前`);
  else if (rule.minYear !== undefined) out.push(`卡片年份 ${rule.minYear} 以後`);
  if (rule.sameYear) out.push('全部同一年');
  if (rule.minCurrent) out.push(`至少 ${rule.minCurrent} 張現役卡`);
  if (rule.minHistory) out.push(`至少 ${rule.minHistory} 張歷史卡（冠軍、獎項、名人堂）`);
  return out;
}

/** Champion, award and Hall of Fame cards. */
export const isHistory = (c: CardDef): boolean => c.source === 'champion' || c.source === 'award' || c.source === 'hof';

/** A card's year: champion and award cards their season, current cards their season's end; others none. */
export function cardYear(c: CardDef): number | undefined {
  const m = /^[ca](\d{4})-/.exec(c.id);
  if ((c.source === 'champion' || c.source === 'award') && m) return Number(m[1]);
  if (c.source === 'current' && c.season) return Number(c.season.slice(0, 4)) + 1;
  return undefined;
}

export const eventTheme = (week: number): EventTheme => EVENT_THEMES[((week % EVENT_THEMES.length) + EVENT_THEMES.length) % EVENT_THEMES.length];
/** Event levels are rated from your period (its ladder's second level). */
export const eventBase = (save: MyTeamSave): number => periodLevels(save.period)[1]?.ovr ?? 75;
export const eventKey = (week: number, index: number): string => `${week}:${index}`;
/** When the week ends (local midnight going into Monday). */
export const eventEnds = (week: number): number => (week * 7 - 3 + 7) * 86_400_000;

/** An event level's opponent: the theme's best players, rescaled around its rating. */
export function eventTeam(theme: Pick<EventTheme, 'name' | 'levels'>, index: number, base: number): TeamInfo {
  const lv = theme.levels[index];
  const pk = lv.pick;
  const target = Math.min(99, base + lv.offset);
  const teams = pk.group
    ? TEAMS.filter((t) => t.group === pk.group)
    : NBA_TEAMS.filter((t) => (!pk.teams || pk.teams.includes(t.abbr)) && (!pk.conference || t.conference === pk.conference));
  const picked = teams.flatMap((t) => t.players).filter((p) => !pk.positions || pk.positions.includes(p.position));
  // Too few to field a side (a custom group renamed away, say): the whole league instead.
  const pool = picked.length >= lv.size ? picked : NBA_TEAMS.flatMap((t) => t.players);
  const by = (p: PlayerInfo) => (pk.sort === 'height' ? p.heightM : pk.sort ? p.ratings[pk.sort] : playerRating(p));
  const best = [...pool].sort((a, b) => by(b) - by(a) || playerRating(b) - playerRating(a));
  const n = lv.size === 3 ? 3 : 8;
  // Each level of the week a different slice: level 1 the best, then the next ones.
  const start = Math.min(index * 2, Math.max(0, best.length - n));
  const chosen = best.slice(start, start + n);
  const starters = chosen.slice(0, Math.min(chosen.length, lv.size)).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
  const players = [...starters, ...chosen.slice(starters.length)].map((p, i) => {
    const want = Math.max(45, Math.min(99, i < lv.size ? target : target - 4));
    return { ...p, ratings: toOverall(p.ratings, CAPS, want, (r) => overallOf(p.position, r)) };
  });
  return { abbr: '活動', name: theme.name, primary: '#d4a017', secondary: '#14161f', players };
}

/** Practice games (隨機比賽) pay by game time: 90 coins every 3 minutes, a win 1.5x, times the level. */
export const PRACTICE_COINS = { per3: 90, win: 1.5 };
export function practiceCoins(minutes: number, won: boolean, difficulty: Difficulty): number {
  return Math.round((minutes / 3) * PRACTICE_COINS.per3 * (won ? PRACTICE_COINS.win : 1) * DIFFICULTY_COINS[difficulty]);
}
