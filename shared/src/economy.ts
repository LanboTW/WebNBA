import type { AwardId } from './awards';
import type { CareerGame, CareerState } from './career';
import { RATING_KEYS } from './roster';
import type { Look, PlayerInfo, Ratings, TeamInfo } from './types';

/**
 * The career's economy: money (in 萬 = 10,000 US dollars; contracts are in
 * millions), gear from the shop, private camps, fans and endorsements,
 * cohesion with his team, and the bridge to the account's coins.
 *
 * Imports only types from career.ts (career.ts calls in here).
 */

/** Contracts are in millions of dollars; money is kept in 萬. */
export const WAN_PER_MILLION = 100;

export const money = (c: CareerState) => c.money ?? 0;

/** "1,234 萬" or "1.2 億" for big sums. */
export function moneyText(wan: number): string {
  const v = Math.round(wan);
  return v >= 10000 ? `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)} 億美元` : `${v.toLocaleString('en-US')} 萬美元`;
}

/** Fans as "12.3 萬" / "1,234 萬". */
export function fansText(n: number): string {
  return n >= 1e7 ? `${Math.round(n / 1e4).toLocaleString('en-US')} 萬` : `${(n / 1e4).toFixed(1)} 萬`;
}

// ----------------------------------------------------------------- pay

/** His regular-season game pay: salary spread over the schedule. */
export function gamePay(c: CareerState): number {
  if (!c.contract) return 0;
  return (c.contract.salary * WAN_PER_MILLION) / c.settings.seasonGames;
}

// ----------------------------------------------------------------- gear

export type GearSlot = 'shoes' | 'apparel' | 'accessory';
export const GEAR_SLOTS: GearSlot[] = ['shoes', 'apparel', 'accessory'];
export const GEAR_SLOT_NAME: Record<GearSlot, string> = { shoes: '球鞋', apparel: '服裝', accessory: '配件' };

export interface GearItem {
  id: string;
  slot: GearSlot;
  name: string;
  tier: 1 | 2 | 3;
  /** 萬美元. */
  price: number;
  /** Fans needed before the shop sells it. */
  fans: number;
  boosts: Partial<Ratings>;
  /** How it shows on the 3D player. */
  look: Partial<Look>;
}

export const GEAR_TIER_NAME = ['', '入門', '進階', '頂級'] as const;
const TIER_PRICE = [0, 50, 300, 1500];
/** The top tier (signature gear) needs a following. */
const TIER_FANS = [0, 0, 0, 1_000_000];

interface GearLine {
  slot: GearSlot;
  key: string;
  names: [string, string, string];
  keys: [keyof Ratings, keyof Ratings];
  look: (tier: number) => Partial<Look>;
}

const LINES: GearLine[] = [
  {
    slot: 'shoes',
    key: 'quick',
    names: ['疾速訓練鞋', '疾速戰靴', '疾速簽名鞋'],
    keys: ['speed', 'jump'],
    look: (t) => ({ shoeColor: ['', '#3a7bd5', '#e63946', '#f2c14e'][t] }),
  },
  {
    slot: 'shoes',
    key: 'lock',
    names: ['鎖防訓練鞋', '鎖防戰靴', '鎖防簽名鞋'],
    keys: ['defense', 'steal'],
    look: (t) => ({ shoeColor: ['', '#3d405b', '#06a77d', '#f2c14e'][t] }),
  },
  {
    slot: 'apparel',
    key: 'shooter',
    names: ['射手護臂', '射手壓縮衣', '射手簽名戰袍'],
    keys: ['three', 'mid'],
    look: (t) => ({ sleeve: t === 1 ? 'right' : 'both' }),
  },
  {
    slot: 'apparel',
    key: 'post',
    names: ['內線護臂', '內線壓縮衣', '內線簽名戰袍'],
    keys: ['close', 'rebound'],
    look: (t) => ({ sleeve: t === 1 ? 'left' : 'both' }),
  },
  {
    slot: 'accessory',
    key: 'band',
    names: ['控球頭帶', '專業控球頭帶', '簽名款頭帶'],
    keys: ['handle', 'pass'],
    look: () => ({ headband: true }),
  },
  {
    slot: 'accessory',
    key: 'knee',
    names: ['護膝', '專業護膝', '簽名款護膝'],
    keys: ['block', 'stamina'],
    look: () => ({ kneepad: true }),
  },
];

export const GEAR: GearItem[] = LINES.flatMap((l) =>
  ([1, 2, 3] as const).map((tier) => ({
    id: `${l.key}${tier}`,
    slot: l.slot,
    name: l.names[tier - 1],
    tier,
    price: TIER_PRICE[tier],
    fans: TIER_FANS[tier],
    boosts: { [l.keys[0]]: tier, [l.keys[1]]: tier },
    look: l.look(tier),
  })),
);

export const gearItem = (id: string | undefined) => GEAR.find((g) => g.id === id);

function gearOf(c: CareerState) {
  c.gear = c.gear ?? { owned: [], equipped: {} };
  return c.gear;
}

/** What his equipped gear adds to each rating. */
export function gearBoosts(c: CareerState): Partial<Ratings> {
  const out: Partial<Ratings> = {};
  for (const id of Object.values(c.gear?.equipped ?? {})) {
    for (const [k, v] of Object.entries(gearItem(id)?.boosts ?? {})) out[k as keyof Ratings] = (out[k as keyof Ratings] ?? 0) + v;
  }
  return out;
}

/** Him as he takes the floor: trained ratings plus gear (up to 99), wearing it. */
export function careerInfo(c: CareerState): PlayerInfo {
  const p = c.player.info;
  const equipped = Object.values(c.gear?.equipped ?? {}).map(gearItem);
  if (!equipped.length) return p;
  const boosts = gearBoosts(c);
  const ratings = { ...p.ratings };
  for (const k of RATING_KEYS) ratings[k] = Math.min(99, ratings[k] + (boosts[k] ?? 0));
  let look = p.look;
  for (const g of equipped) if (g && look) look = { ...look, ...g.look };
  return { ...p, ratings, look };
}

export type GearCheck = 'ok' | 'owned' | 'money' | 'fans';
export function canBuyGear(c: CareerState, id: string): GearCheck {
  const g = gearItem(id);
  if (!g || c.gear?.owned.includes(id)) return 'owned';
  if ((c.fans ?? 0) < g.fans) return 'fans';
  return money(c) >= g.price ? 'ok' : 'money';
}

/** Buys it and puts it on. */
export function buyGear(c: CareerState, id: string): boolean {
  if (canBuyGear(c, id) !== 'ok') return false;
  const g = gearItem(id)!;
  const gear = gearOf(c);
  c.money = money(c) - g.price;
  gear.owned.push(id);
  gear.equipped[g.slot] = id;
  return true;
}

/** Puts on something he owns, or (same item again) takes it off. */
export function toggleGear(c: CareerState, id: string): void {
  const g = gearItem(id);
  const gear = gearOf(c);
  if (!g || !gear.owned.includes(id)) return;
  if (gear.equipped[g.slot] === id) delete gear.equipped[g.slot];
  else gear.equipped[g.slot] = id;
}

// ----------------------------------------------------------------- private camps

export const CAMP_PRICE = 150;
export const CAMP_XP = 250;
export const CAMPS_PER_SEASON = 3;

/** The season camps count against: the current one, or the one coming after an offseason. */
const campYear = (c: CareerState) => (c.offseason ? (c.season?.year ?? c.year) + 1 : (c.season?.year ?? c.year));

export function campsLeft(c: CareerState): number {
  const used = c.camps?.year === campYear(c) ? c.camps.used : 0;
  return CAMPS_PER_SEASON - used;
}

export function buyCamp(c: CareerState): boolean {
  if (campsLeft(c) <= 0 || money(c) < CAMP_PRICE || c.stage === 'retired') return false;
  const year = campYear(c);
  c.camps = { year, used: (c.camps?.year === year ? c.camps.used : 0) + 1 };
  c.money = money(c) - CAMP_PRICE;
  c.player.xp = (c.player.xp ?? 0) + CAMP_XP;
  return true;
}

// ----------------------------------------------------------------- fans

/** Draft night: a following that grows with the pick. */
export function startingFans(pick: number): number {
  return 50_000 + Math.max(0, 31 - pick) * 2_000;
}

const MIN_FANS = 5_000;

/** A game moves his following: big nights and wins add, duds cost a little. Playoffs count double. */
export function fansAfterGame(c: CareerState, game: CareerGame, playoff: number): number {
  const fans = c.fans ?? startingFans(c.draft?.pick ?? 30);
  if (game.grade === 'DNP') return fans;
  const won = game.score[0] > game.score[1];
  let delta = (game.rating - 8) * (300 + fans * 0.0004) + (won ? 200 + fans * 0.0005 : 0);
  if (playoff) delta *= 2;
  return Math.max(MIN_FANS, Math.round(fans + delta));
}

/** Awards bring new fans: [times, plus]. */
const AWARD_FANS: Partial<Record<AwardId, [number, number]>> = {
  mvp: [1.5, 200_000],
  champ: [1.15, 100_000],
  fmvp: [1.1, 100_000],
  allstar: [1.15, 50_000],
  roy: [1, 100_000],
  pts: [1, 30_000],
  reb: [1, 30_000],
  ast: [1, 30_000],
  stl: [1, 30_000],
  blk: [1, 30_000],
};

export function fansAfterAwards(fans: number, mine: AwardId[]): number {
  for (const id of mine) {
    const [k, add] = AWARD_FANS[id] ?? [1, 0];
    fans = fans * k + add;
  }
  return Math.round(fans);
}

/** Endorsements at the end of a season: about 100 萬 dollars per 10 萬 fans. */
export const endorsement = (fans: number) => Math.round(fans / 1000);

/** All-Star voting: fans add up to 15% to his case (full at 200 萬 fans). */
export const fanVote = (fans: number) => 1 + 0.15 * Math.min(1, fans / 2_000_000);

// ----------------------------------------------------------------- cohesion

export const START_COHESION = 30;
export const cohesion = (c: CareerState) => c.cohesion ?? START_COHESION;

/** Playing, winning and playing well together build it; about +30 to +40 a season. */
export function cohesionAfterGame(c: CareerState, game: CareerGame): number {
  let v = cohesion(c);
  if (game.grade !== 'DNP') {
    v += 0.5;
    if (game.score[0] > game.score[1]) v += 0.5;
    if (game.grade[0] === 'A' || game.grade[0] === 'B') v += 0.5;
  }
  return Math.min(100, Math.round(v * 10) / 10);
}

/** His teammates, playing with him: up to 2% better at full cohesion. */
export function withCohesion(team: TeamInfo, me: string, value: number): TeamInfo {
  const k = 1 + 0.02 * (value / 100);
  if (k === 1) return team;
  return {
    ...team,
    players: team.players.map((p) => {
      if (p.name === me) return p;
      const ratings = { ...p.ratings };
      for (const key of RATING_KEYS) ratings[key] = Math.min(99, Math.round(ratings[key] * k));
      return { ...p, ratings };
    }),
  };
}

// ----------------------------------------------------------------- account coins

/** Retirement: leftover money and XP become coins, once per career. */
export const COINS_PER_WAN = 1 / 10;
export const COINS_PER_XP = 1 / 10;
/** Coins brought into a career: 1 coin = 5 萬 or 5 XP (half what it took to earn it). */
export const WAN_PER_COIN = 5;
export const XP_PER_COIN = 5;
export const COIN_TRANSFER_MAX = 2000;

export function settlement(c: CareerState): number {
  return Math.floor(money(c) * COINS_PER_WAN) + Math.floor((c.player.xp ?? 0) * COINS_PER_XP);
}

export function canSettle(c: CareerState): boolean {
  return c.stage === 'retired' && !c.settled;
}

/** Empties his money and XP into coins; returns how many. */
export function settle(c: CareerState): number {
  if (!canSettle(c)) return 0;
  const coins = settlement(c);
  c.settled = true;
  c.money = 0;
  c.player.xp = 0;
  return coins;
}

/** Coins may come in once before his first season and once each offseason. */
function transferWindow(c: CareerState): string | null {
  if (c.stage === 'combine' || c.stage === 'drafted') return 'start';
  if (c.stage === 'offseason' && c.offseason) return `off${c.season?.year ?? c.year}`;
  return null;
}

export function canTransferCoins(c: CareerState): boolean {
  const w = transferWindow(c);
  return !!w && !(c.coinsIn ?? []).includes(w);
}

/** Brings coins in as money and XP. Returns false when the window is closed. */
export function transferCoins(c: CareerState, forMoney: number, forXp: number): boolean {
  const w = transferWindow(c);
  const total = forMoney + forXp;
  if (!w || !canTransferCoins(c) || forMoney < 0 || forXp < 0 || total <= 0 || total > COIN_TRANSFER_MAX) return false;
  c.money = money(c) + Math.floor(forMoney) * WAN_PER_COIN;
  c.player.xp = (c.player.xp ?? 0) + Math.floor(forXp) * XP_PER_COIN;
  c.coinsIn = [...(c.coinsIn ?? []), w];
  return true;
}
