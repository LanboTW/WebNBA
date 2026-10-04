import headshotsJson from '../data/headshots.json';
import myteamJson from '../data/myteam.json';
import { POSITIONS, toOverall } from './career';
import { NBA_TEAMS, RATING_KEYS, TEAMS, findTeam, overallOf, playerRating, teamRating } from './roster';
import { DIFFICULTY_COINS, type Difficulty, type Look, type PlayerInfo, type Position, type Ratings, type TeamInfo } from './types';

/**
 * MyTeam: collect player cards with coins, build a deck, play with it.
 * Cards are made from the current roster: every player's base card at his
 * own overall, plus boosted versions released period by period. Owned cards
 * are kept as snapshots, so a roster update never takes a card away.
 */

export type TierId = 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'pink' | 'orange' | 'black';

export interface Tier {
  id: TierId;
  name: string;
  min: number;
  max: number;
  /** Frame colour. */
  color: string;
  /** Coins for a duplicate or a sold card. */
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

export const PERIODS = 6;
/** The best tier each period releases (period 1 first). */
export const PERIOD_TOP: TierId[] = ['blue', 'purple', 'gold', 'pink', 'orange', 'black'];
export const periodTop = (period: number): TierId => PERIOD_TOP[Math.min(PERIODS, Math.max(1, period)) - 1];

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
  /** The period that releases it. */
  period: number;
  /** The player's own card (not a boosted one). */
  base: boolean;
}

/** A card the player owns: the card plus its ratings, frozen when it was pulled. */
export interface OwnedCard extends CardDef {
  /** RATING_KEYS order. */
  ratings: number[];
}

/** A loaned card: plays `games` more games, then it is gone. */
export interface RentalCard extends OwnedCard {
  uid: string;
  games: number;
}

export interface PackDef {
  id: string;
  name: string;
  price: number;
  count: number;
  /** Only these tiers (else every tier the period has released). */
  tiers?: TierId[];
  positions?: Position[];
  /** Only these players (by name). */
  players?: string[];
  /** Relative odds per tier; missing tiers use DEFAULT_WEIGHTS. */
  weights?: Partial<Record<TierId, number>>;
  /** At least one card of the current period's best tier. */
  guaranteeTop?: boolean;
  /** Chance for each card to come as a high-rated rental instead. */
  rentalChance?: number;
}

export const DEFAULT_WEIGHTS: Record<TierId, number> = {
  white: 30,
  green: 30,
  blue: 22,
  purple: 10,
  gold: 5,
  pink: 2,
  orange: 0.8,
  black: 0.25,
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

/** Boosted cards each period releases, at its best tier and the one below. */
const BOOSTED_TOP = 14;
const BOOSTED_NEXT = 8;

let catalog: CardDef[] | null = null;
const realPlayers = new Map<string, { p: PlayerInfo; t: TeamInfo }>();

/** Every card there is, made from the NBA roster (the same for everyone). */
export function cardCatalog(): CardDef[] {
  if (catalog) return catalog;
  const players = NBA_TEAMS.flatMap((t) => t.players.map((p) => ({ p, t })));
  for (const x of players) realPlayers.set(x.p.name, x);
  const card = (x: { p: PlayerInfo; t: TeamInfo }, id: string, ovr: number, period: number, base: boolean): CardDef => ({
    id,
    name: x.p.name,
    team: x.t.abbr,
    position: x.p.position,
    number: x.p.number,
    heightM: x.p.heightM,
    tier: tierOf(ovr),
    ovr,
    period,
    base,
  });
  const out: CardDef[] = players.map((x) => {
    const ovr = Math.max(66, Math.min(99, playerRating(x.p)));
    const period = Math.max(1, PERIOD_TOP.findIndex((t) => tierIndex(t) >= tierIndex(tierOf(ovr))) + 1);
    return card(x, `b-${slug(x.p.name)}`, ovr, period, true);
  });
  for (let period = 2; period <= PERIODS; period++) {
    const used = new Set<string>();
    const release = (t: Tier, n: number, tag: string) => {
      const pool = players
        .filter((x) => !used.has(x.p.name) && playerRating(x.p) < t.min && playerRating(x.p) >= t.min - 14)
        .sort((a, b) => hash(`${tag}:${a.p.name}`) - hash(`${tag}:${b.p.name}`))
        .slice(0, n);
      for (const x of pool) {
        used.add(x.p.name);
        const ovr = t.min + (hash(`${tag}/ovr:${x.p.name}`) % (t.max - t.min + 1));
        out.push(card(x, `${tag}-${slug(x.p.name)}`, ovr, period, false));
      }
    };
    release(tier(periodTop(period)), BOOSTED_TOP, `p${period}`);
    if (period >= 3) release(TIERS[tierIndex(periodTop(period)) - 1], BOOSTED_NEXT, `p${period}n`);
  }
  catalog = out;
  return out;
}

const CAPS = Object.fromEntries(RATING_KEYS.map((k) => [k, 99])) as unknown as Ratings;

/** The card's ratings: the player's own, shifted until his overall is the card's. */
export function cardRatings(c: CardDef): Ratings {
  cardCatalog();
  const real = realPlayers.get(c.name)?.p;
  if (!real) return Object.fromEntries(RATING_KEYS.map((k) => [k, c.ovr])) as unknown as Ratings;
  const r = toOverall(real.ratings, CAPS, c.ovr, (x) => overallOf(c.position, x));
  // Whole-number ratings can land a point off: step single ratings until it shows right.
  for (let i = 0; i < 60; i++) {
    const off = c.ovr - playerRating({ position: c.position, ratings: r });
    if (!off) break;
    const k = RATING_KEYS[i % RATING_KEYS.length];
    r[k] = Math.max(25, Math.min(99, r[k] + Math.sign(off)));
  }
  return r;
}

export function ownCard(c: CardDef): OwnedCard {
  const r = cardRatings(c);
  return { ...c, ratings: RATING_KEYS.map((k) => r[k]) };
}

export function ratingsOf(c: OwnedCard): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k, i) => [k, c.ratings[i] ?? 50])) as unknown as Ratings;
}

/** The card as a player in a game (his look from the roster when he is still on it). */
export function cardPlayer(c: OwnedCard): PlayerInfo {
  cardCatalog();
  const look: Look | undefined = realPlayers.get(c.name)?.p.look;
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
  /** Games, when it came as a rental. */
  rental?: number;
}

/** The cards a pack can give in this period. */
export function packPool(pack: PackDef, period: number): CardDef[] {
  const names = pack.players?.length ? new Set(pack.players) : null;
  return cardCatalog().filter(
    (c) =>
      c.period <= period &&
      (!pack.tiers?.length || pack.tiers.includes(c.tier)) &&
      (!pack.positions?.length || pack.positions.includes(c.position)) &&
      (!names || names.has(c.name)),
  );
}

/** Each tier's chance of being pulled from this pack now (tiers it cannot give are left out). */
export function packOdds(pack: PackDef, period: number): { tier: TierId; chance: number }[] {
  const pool = packPool(pack, period);
  const tiers = TIERS.filter((t) => pool.some((c) => c.tier === t.id));
  const weight = (t: TierId) => Math.max(0, pack.weights?.[t] ?? DEFAULT_WEIGHTS[t]);
  const total = tiers.reduce((s, t) => s + weight(t.id), 0) || 1;
  return tiers.map((t) => ({ tier: t.id, chance: weight(t.id) / total }));
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

/** Opens a pack. Empty when it has nothing to give in this period. */
export function openPack(pack: PackDef, period: number, rand: () => number = Math.random): Drop[] {
  const pool = packPool(pack, period);
  if (!pool.length) return [];
  const odds = packOdds(pack, period);
  const drops: Drop[] = [];
  const taken = new Set<string>();
  const fresh = (cards: CardDef[]) => {
    const left = cards.filter((c) => !taken.has(c.id));
    return left.length ? left : cards;
  };
  const top = pool.filter((c) => c.tier === periodTop(period));
  // Rentals are the pool's best: its top two tiers.
  const best = TIERS.filter((t) => pool.some((c) => c.tier === t.id)).slice(-2).map((t) => t.id);
  const rentals = pool.filter((c) => best.includes(c.tier));
  for (let i = 0; i < Math.max(1, Math.min(10, pack.count)); i++) {
    let card: CardDef;
    let rental: number | undefined;
    if (i === 0 && pack.guaranteeTop && top.length) {
      card = pick(fresh(top), rand);
    } else if (rand() < (pack.rentalChance ?? 0)) {
      card = pick(fresh(rentals), rand);
      rental = 2 + Math.floor(rand() * 3);
    } else {
      let r = rand();
      let t = odds[odds.length - 1].tier;
      for (const o of odds) {
        if (r < o.chance) {
          t = o.tier;
          break;
        }
        r -= o.chance;
      }
      card = pick(fresh(pool.filter((c) => c.tier === t)), rand);
    }
    taken.add(card.id);
    drops.push(rental ? { card, rental } : { card });
  }
  // Best last, for the reveal.
  return drops.sort((a, b) => a.card.ovr - b.card.ovr);
}

// ----------------------------------------------------------------- the save

export const DECK_MAX = 13;
export const DECK_MIN = 5;

export interface MyTeamSave {
  v: 1;
  /** Highest period unlocked (1-6). */
  period: number;
  cards: OwnedCard[];
  rentals: RentalCard[];
  /** Card ids and rental uids; the first five start. */
  deck: string[];
  /** Next rental number. */
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
  /** Games in a row with the same starting five (its cohesion grows with them). */
  chem?: { key: string; games: number };
}

export function emptyMyTeam(): MyTeamSave {
  return { v: 1, period: 1, cards: [], rentals: [], deck: [], next: 1, packsOpened: 0, cleared: [], claimed: [], stats: {}, events: [] };
}

/** Accepts anything that looks like a save, filling what is missing. */
export function upgradeMyTeam(raw: unknown): MyTeamSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const { customPacks: _gone, ...s } = raw as Partial<MyTeamSave> & { customPacks?: unknown };
  if (!Array.isArray(s.cards)) return null;
  return {
    ...emptyMyTeam(),
    ...s,
    v: 1,
    period: Math.min(PERIODS, Math.max(1, Number(s.period) || 1)),
    rentals: Array.isArray(s.rentals) ? s.rentals.filter((r) => r.games > 0) : [],
    deck: Array.isArray(s.deck) ? s.deck : [],
    cleared: Array.isArray(s.cleared) ? s.cleared : [],
    claimed: Array.isArray(s.claimed) ? s.claimed : [],
    stats: s.stats && typeof s.stats === 'object' ? s.stats : {},
    events: Array.isArray(s.events) ? s.events : [],
  };
}

/** A deck slot's card: an owned card by id or a rental by uid. */
export function deckCard(save: MyTeamSave, ref: string): OwnedCard | RentalCard | null {
  return save.rentals.find((r) => r.uid === ref) ?? save.cards.find((c) => c.id === ref) ?? null;
}

export const isRental = (c: OwnedCard): c is RentalCard => 'uid' in c;
export const refOf = (c: OwnedCard): string => (isRental(c) ? c.uid : c.id);

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

/** A new collection: two plain cards per position and five loaned stars (three games each). */
export function newMyTeam(rand: () => number = Math.random): MyTeamSave {
  const save = emptyMyTeam();
  const cards = cardCatalog();
  for (const pos of POSITIONS) {
    const plain = cards.filter((c) => c.base && c.position === pos && c.ovr <= 75);
    for (let i = 0; i < 2; i++) {
      const left = plain.filter((c) => !save.cards.some((o) => o.id === c.id));
      if (left.length) save.cards.push(ownCard(pick(left, rand)));
    }
  }
  for (const pos of POSITIONS) {
    const stars = cards.filter((c) => c.position === pos && (c.tier === 'gold' || c.tier === 'pink') && !save.rentals.some((r) => r.name === c.name));
    if (stars.length) save.rentals.push({ ...ownCard(pick(stars, rand)), uid: `r${save.next++}`, games: 3 });
  }
  save.deck = autoDeck(save);
  return save;
}

/** What adding one drop did: a new card, a duplicate turned into coins, or a rental. */
export interface DropResult {
  card: OwnedCard | RentalCard;
  coins: number;
  isNew: boolean;
}

/** Adds a pack's cards to the collection; duplicates become coins (returned, for the wallet). */
export function addDrops(save: MyTeamSave, drops: Drop[], fromPack = true): DropResult[] {
  if (fromPack) save.packsOpened++;
  return drops.map((d) => {
    if (d.rental) {
      const r: RentalCard = { ...ownCard(d.card), uid: `r${save.next++}`, games: d.rental };
      save.rentals.push(r);
      return { card: r, coins: 0, isNew: true };
    }
    const have = save.cards.find((c) => c.id === d.card.id);
    if (have) return { card: have, coins: tier(have.tier).value, isNew: false };
    const c = ownCard(d.card);
    save.cards.push(c);
    return { card: c, coins: 0, isNew: true };
  });
}

/** Sells an owned card (never a rental) for coins; it leaves the deck too. */
export function sellCard(save: MyTeamSave, id: string): number {
  const i = save.cards.findIndex((c) => c.id === id);
  if (i < 0) return 0;
  const [c] = save.cards.splice(i, 1);
  save.deck = save.deck.filter((r) => r !== id);
  return tier(c.tier).value;
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
  /** Limited levels beaten. */
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
export const GAME_COINS = { win: 150, loss: 50, ladderReplay: 100 };

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
  if (key === 'cards') return save.cards.length;
  if (key === 'packs') return save.packsOpened;
  if (key === 'cleared') return LEVELS.filter((l) => save.cleared.includes(l.id)).length;
  if (key === 'limited') return LIMITED.filter((l) => save.cleared.includes(l.id)).length;
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
  if (pack) drops.push(...addDrops(save, openPack(pack, save.period, rand)));
  const ofTier = (t: TierId) => cardCatalog().filter((c) => c.tier === t);
  if (reward.rental && ofTier(reward.rental).length) drops.push(...addDrops(save, [{ card: pick(ofTier(reward.rental), rand), rental: 3 }], false));
  if (reward.card && ofTier(reward.card).length) drops.push(...addDrops(save, [{ card: pick(ofTier(reward.card), rand) }], false));
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
}

/** Books a finished MyTeam game: counters, rentals, coins and ladder rewards. */
export function recordGame(save: MyTeamSave, g: GameResult, rand: () => number = Math.random): GameOutcome {
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
  const level = g.level ? [...LEVELS, ...DYNASTY, ...LIMITED].find((l) => l.id === g.level) : undefined;
  const theme = g.event ? eventTheme(g.event.week) : undefined;
  if (g.forfeit) coins = 0;
  else if (level) {
    if (won && !save.cleared.includes(level.id)) {
      firstClear = true;
      save.cleared.push(level.id);
      ({ coins, drops } = grantReward(save, level.reward, rand));
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
  return { coins, drops, firstClear, gone, unlocked: updatePeriod(save) };
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
  baseOnly?: boolean;
}

/** Limited levels (限定關卡): a lineup rule, 3v3 or 5v5 (against `team`), one reward each. */
export interface LimitedDef {
  id: string;
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

const MODES = myteamJson as unknown as { dynasty: DynastyDef[]; limited: LimitedDef[]; events: EventTheme[] };
export const DYNASTY: DynastyDef[] = MODES.dynasty;
export const LIMITED: LimitedDef[] = MODES.limited;
export const EVENT_THEMES: EventTheme[] = MODES.events;

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
  if (rule.maxOvr !== undefined && card.ovr > rule.maxOvr) return false;
  if (rule.noRentals && isRental(card)) return false;
  if (rule.tiers && !rule.tiers.includes(card.tier)) return false;
  if (rule.baseOnly && !card.base) return false;
  if (rule.sameTeam && picked.length && picked[0].team !== card.team) return false;
  return true;
}

/** Why a lineup cannot play this rule, or null when it can. */
export function lineupProblem(rule: LineupRule, cards: OwnedCard[], size: number): string | null {
  if (cards.length !== size) return `要選 ${size} 人`;
  if (new Set(cards.map((c) => c.name)).size !== cards.length) return '同一名球員只能上一張';
  if (cards.some((c, i) => !cardAllowed(rule, c, cards.slice(0, i)))) return '有卡不符合限定條件';
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
  if (rule.baseOnly) out.push('只能用基本卡（不能用強化卡）');
  return out;
}

/** Weeks since 1970 starting on Mondays: the event that is on. */
export const eventWeek = (now: number = Date.now()): number => Math.floor((Math.floor(now / 86_400_000) + 3) / 7);
export const eventTheme = (week: number): EventTheme => EVENT_THEMES[((week % EVENT_THEMES.length) + EVENT_THEMES.length) % EVENT_THEMES.length];
/** Event levels are rated from your period (its ladder's second level). */
export const eventBase = (save: MyTeamSave): number => periodLevels(save.period)[1]?.ovr ?? 75;
export const eventKey = (week: number, index: number): string => `${week}:${index}`;
/** When the week ends (local midnight going into Monday). */
export const eventEnds = (week: number): number => (week * 7 - 3 + 7) * 86_400_000;

/** An event level's opponent: the theme's best players, rescaled around its rating. */
export function eventTeam(theme: EventTheme, index: number, base: number): TeamInfo {
  const lv = theme.levels[index];
  const pk = lv.pick;
  const target = Math.min(99, base + lv.offset);
  const teams = pk.group
    ? TEAMS.filter((t) => t.group === pk.group)
    : NBA_TEAMS.filter((t) => (!pk.teams || pk.teams.includes(t.abbr)) && (!pk.conference || t.conference === pk.conference));
  const pool = teams.flatMap((t) => t.players).filter((p) => !pk.positions || pk.positions.includes(p.position));
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

/** Practice games (隨機比賽) pay by game time: 20 coins every 3 minutes, a win 1.5x, times the level. */
export const PRACTICE_COINS = { per3: 20, win: 1.5 };
export function practiceCoins(minutes: number, won: boolean, difficulty: Difficulty): number {
  return Math.round((minutes / 3) * PRACTICE_COINS.per3 * (won ? PRACTICE_COINS.win : 1) * DIFFICULTY_COINS[difficulty]);
}
