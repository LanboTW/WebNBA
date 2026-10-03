import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_PACKS,
  PERIOD_TOP,
  TIERS,
  addDrops,
  autoDeck,
  cardCatalog,
  deckTeam,
  newMyTeam,
  openPack,
  ownCard,
  packOdds,
  playerRating,
  sellCard,
  tierIndex,
  tierOf,
  upgradeMyTeam,
  cardPlayer,
} from '../src';

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('MyTeam cards', () => {
  it('tiers cover 66-99 without gaps', () => {
    for (let o = 66; o <= 99; o++) {
      const t = TIERS.find((x) => x.id === tierOf(o))!;
      expect(o).toBeGreaterThanOrEqual(t.min);
      expect(o).toBeLessThanOrEqual(t.max);
    }
  });

  it('every card has a unique id, its tier, and a period that allows it', () => {
    const cards = cardCatalog();
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of cards) {
      expect(c.tier).toBe(tierOf(c.ovr));
      expect(tierIndex(c.tier)).toBeLessThanOrEqual(tierIndex(PERIOD_TOP[c.period - 1]));
    }
    // Later periods bring boosted cards.
    expect(cards.filter((c) => !c.base && c.period === 6 && c.tier === 'black').length).toBeGreaterThan(5);
  });

  it("a card's ratings give exactly its overall", () => {
    const cards = cardCatalog();
    const sample = cards;
    for (const c of sample) expect(playerRating(cardPlayer(ownCard(c)))).toBe(c.ovr);
  });
});

describe('MyTeam packs', () => {
  it('period 1 only gives up to blue; premium always has one of the top tier', () => {
    const rand = seeded(7);
    const std = OFFICIAL_PACKS.find((p) => p.id === 'standard')!;
    const premium = OFFICIAL_PACKS.find((p) => p.id === 'premium')!;
    for (let i = 0; i < 200; i++) {
      for (const d of openPack(std, 1, rand)) {
        if (!d.rental) expect(tierIndex(d.card.tier)).toBeLessThanOrEqual(tierIndex('blue'));
      }
      const p = openPack(premium, 3, rand);
      expect(p).toHaveLength(3);
      expect(p.some((d) => d.card.tier === 'gold')).toBe(true);
    }
    const odds = packOdds(std, 1);
    expect(odds.map((o) => o.tier)).toEqual(['white', 'green', 'blue']);
    expect(odds.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1);
  });

  it('position packs keep to their positions', () => {
    const guards = OFFICIAL_PACKS.find((p) => p.id === 'guards')!;
    const rand = seeded(3);
    for (let i = 0; i < 50; i++) for (const d of openPack(guards, 4, rand)) expect(['PG', 'SG']).toContain(d.card.position);
  });

  it('duplicates turn into coins, rentals stack, selling pays', () => {
    const save = newMyTeam(seeded(1));
    expect(save.cards).toHaveLength(10);
    expect(save.rentals).toHaveLength(5);
    expect(save.rentals.every((r) => r.games === 3 && ['gold', 'pink'].includes(r.tier))).toBe(true);
    expect(save.deck.length).toBe(13);
    const owned = save.cards[0];
    const res = addDrops(save, [{ card: owned }, { card: owned, rental: 2 }]);
    expect(res[0].isNew).toBe(false);
    expect(res[0].coins).toBe(TIERS.find((t) => t.id === owned.tier)!.value);
    expect(save.rentals).toHaveLength(6);
    expect(sellCard(save, owned.id)).toBeGreaterThan(0);
    expect(save.deck).not.toContain(owned.id);
  });

  it('auto deck starts one player per position and never repeats a player', () => {
    const save = newMyTeam(seeded(9));
    save.deck = autoDeck(save);
    const team = deckTeam(save, { abbr: 'MY', name: 'MY', primary: '#000', secondary: '#fff' });
    expect(team.players.slice(0, 5).map((p) => p.position)).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
    expect(new Set(team.players.map((p) => p.name)).size).toBe(team.players.length);
  });

  it('saves round-trip and spent rentals drop out', () => {
    const save = newMyTeam(seeded(2));
    save.rentals[0].games = 0;
    const back = upgradeMyTeam(JSON.parse(JSON.stringify(save)))!;
    expect(back.rentals).toHaveLength(4);
    expect(upgradeMyTeam({})).toBeNull();
  });
});
