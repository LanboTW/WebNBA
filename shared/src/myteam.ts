import headshotsJson from '../data/headshots.json';
import myteamJson from '../data/myteam.json';
import { POSITIONS, toOverall } from './career';
import { NBA_TEAMS, RATING_KEYS, findTeam, overallOf, playerRating } from './roster';
import type { Look, PlayerInfo, Position, Ratings, TeamInfo } from './types';

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
  /** Made in the game's pack editor. */
  custom?: boolean;
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
  customPacks: PackDef[];
}

export function emptyMyTeam(): MyTeamSave {
  return { v: 1, period: 1, cards: [], rentals: [], deck: [], next: 1, packsOpened: 0, customPacks: [] };
}

/** Accepts anything that looks like a save, filling what is missing. */
export function upgradeMyTeam(raw: unknown): MyTeamSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<MyTeamSave>;
  if (!Array.isArray(s.cards)) return null;
  return {
    ...emptyMyTeam(),
    ...s,
    v: 1,
    period: Math.min(PERIODS, Math.max(1, Number(s.period) || 1)),
    rentals: Array.isArray(s.rentals) ? s.rentals.filter((r) => r.games > 0) : [],
    deck: Array.isArray(s.deck) ? s.deck : [],
    customPacks: Array.isArray(s.customPacks) ? s.customPacks : [],
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
export function addDrops(save: MyTeamSave, drops: Drop[]): DropResult[] {
  save.packsOpened++;
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
  const cards = save.deck.map((r) => deckCard(save, r)).filter((c): c is OwnedCard => !!c);
  const starters = cards.slice(0, 5).sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
  return { ...info, players: [...starters, ...cards.slice(5)].map(cardPlayer) };
}

/** The deck's rating: its starters' average overall. */
export function deckRating(save: MyTeamSave): number {
  const starters = save.deck.slice(0, 5).map((r) => deckCard(save, r)?.ovr ?? 0);
  return starters.length ? Math.round(starters.reduce((a, b) => a + b, 0) / starters.length) : 0;
}
