import { describe, expect, it } from 'vitest';
import { LEVELS, MISSIONS, claimMission, levelOpen, levelTeam, periodLevels, recordGame, statValue, streetOpponents, teamRating } from '../src';
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

describe('MyTeam play', () => {
  const totals = { points: 80, threes: 9, assists: 20, blocks: 4, steals: 6 };

  it('levels: 5 per period, opponents rescaled to the level rating', () => {
    for (let p = 1; p <= 6; p++) expect(periodLevels(p)).toHaveLength(5);
    for (const l of LEVELS) expect(Math.abs(teamRating(levelTeam(l)) - l.ovr)).toBeLessThanOrEqual(1);
  });

  it('beating the ladder in order pays once and opens the next period', () => {
    const save = newMyTeam(seeded(4));
    const list = periodLevels(1);
    expect(levelOpen(save, list[1])).toBe(false);
    let coins = 0;
    for (const l of list) {
      expect(levelOpen(save, l)).toBe(true);
      const out = recordGame(save, { kind: 'ladder', won: true, margin: 5, level: l.id, used: [], totals }, seeded(1));
      expect(out.firstClear).toBe(true);
      coins += out.coins;
      if (l.boss) expect(out.unlocked).toBe(2);
    }
    expect(coins).toBeGreaterThanOrEqual(1200);
    expect(save.period).toBe(2);
    const again = recordGame(save, { kind: 'ladder', won: true, margin: 5, level: list[0].id, used: [], totals });
    expect(again.firstClear).toBe(false);
    expect(again.coins).toBe(100);
  });

  it('game coins scale with the computer level, level rewards do not', () => {
    const save = newMyTeam(seeded(6));
    expect(recordGame(save, { kind: 'quick', won: true, margin: 3, used: [], totals, difficulty: 'legend' }).coins).toBe(240);
    expect(recordGame(save, { kind: 'quick', won: false, margin: -3, used: [], totals, difficulty: 'easy' }).coins).toBe(40);
    expect(recordGame(save, { kind: 'quick', won: true, margin: 3, used: [], totals }).coins).toBe(150);
    const first = periodLevels(1)[0];
    const out = recordGame(save, { kind: 'ladder', won: true, margin: 5, level: first.id, used: [], totals, difficulty: 'legend' }, seeded(1));
    expect(out.firstClear).toBe(true);
    expect(out.coins).toBe(first.reward.coins ?? 0);
  });

  it('rentals lose a game each time they play and then leave the deck', () => {
    const save = newMyTeam(seeded(5));
    const r = save.rentals[0];
    expect(save.deck).toContain(r.uid);
    for (let i = 0; i < 2; i++) recordGame(save, { kind: 'quick', won: false, margin: -3, used: [r.uid], totals });
    expect(save.rentals.find((x) => x.uid === r.uid)?.games).toBe(1);
    const out = recordGame(save, { kind: 'quick', won: true, margin: 3, used: [r.uid], totals });
    expect(out.gone).toEqual([r.name]);
    expect(out.coins).toBe(150);
    expect(save.deck).not.toContain(r.uid);
  });

  it('missions count up, pay once, and enough of them open a period', () => {
    const save = newMyTeam(seeded(6));
    expect(claimMission(save, 'g1')).toBeNull();
    for (let i = 0; i < 3; i++) recordGame(save, { kind: 'street', won: true, margin: 25, used: [], totals });
    for (const id of ['g1', 'w3', 's1']) expect(claimMission(save, id)!.coins).toBeGreaterThan(0);
    expect(claimMission(save, 'g1')).toBeNull();
    expect(save.period).toBe(2);
    expect(MISSIONS.length).toBeGreaterThanOrEqual(15);
  });

  it('the deck-rating missions ignore rentals', () => {
    const save = newMyTeam(seeded(6));
    expect(statValue(save, 'deckRating')).toBeLessThanOrEqual(75);
  });

  it('a forfeit is a loss with no coins', () => {
    const save = newMyTeam(seeded(8));
    const out = recordGame(save, { kind: 'quick', won: true, margin: 10, used: [], totals, forfeit: true });
    expect(out.coins).toBe(0);
    expect(save.stats.wins ?? 0).toBe(0);
  });

  it('street opponents are distinct and near the asked rating', () => {
    const ps = streetOpponents(3, 80, [], seeded(2));
    expect(new Set(ps.map((p) => p.name)).size).toBe(3);
    for (const p of ps) expect(Math.abs(playerRating(p) - 80)).toBeLessThanOrEqual(3);
  });
});
