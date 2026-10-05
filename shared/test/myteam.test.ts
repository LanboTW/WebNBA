import { describe, expect, it } from 'vitest';
import { LEVELS, MISSIONS, claimMission, levelOpen, levelTeam, periodLevels, recordGame, statValue, streetOpponents, teamRating } from '../src';
import {
  OFFICIAL_PACKS,
  ROSTER_SEASON,
  TIERS,
  copiesOf,
  limitedTheme,
  mergeCard,
  packPool,
  seasonLabel,
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
  DYNASTY,
  EVENT_THEMES,
  LIMITED,
  cardAllowed,
  dynastyCrew,
  dynastyLevels,
  dynastyOpen,
  eventBase,
  eventKey,
  eventTeam,
  eventTheme,
  eventWeek,
  limitedTeam,
  lineupProblem,
  practiceCoins,
  ruleText,
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

  it('every card has a unique id and its tier; current players stay white to pink', () => {
    const cards = cardCatalog();
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    for (const c of cards) expect(c.tier).toBe(tierOf(c.ovr));
    const current = cards.filter((c) => c.source === 'current');
    expect(Math.max(...current.map((c) => c.ovr))).toBe(93);
    expect(current.every((c) => c.label === seasonLabel(ROSTER_SEASON) && c.id.startsWith('s'))).toBe(true);
    // The history: champions and awards pink, MVPs orange, five peak MVPs black.
    expect(cards.filter((c) => c.source === 'champion').length).toBe(26 * 6);
    expect(cards.filter((c) => c.source === 'champion' || c.source === 'hof').every((c) => c.tier === 'pink')).toBe(true);
    const mvps = cards.filter((c) => c.source === 'award' && / (MVP|巔峰MVP)$/.test(c.label));
    expect(mvps.filter((c) => c.tier === 'orange').length).toBe(21);
    expect(mvps.filter((c) => c.tier === 'black').map((c) => c.label)).toEqual(['2000 巔峰MVP', '2009 巔峰MVP', '2013 巔峰MVP', '2016 巔峰MVP', '2024 巔峰MVP']);
    expect(cards.filter((c) => c.source === 'hof')).toHaveLength(40);
    expect(cards.filter((c) => c.source === 'special').every((c) => c.tier === 'black' && c.theme)).toBe(true);
  });

  it("a card's ratings give exactly its overall, +N included", () => {
    const cards = cardCatalog();
    for (const c of cards) expect(playerRating(cardPlayer(ownCard(c)))).toBe(c.ovr);
    const c = cards.find((x) => x.ovr === 90)!;
    expect(playerRating(cardPlayer(ownCard(c, 'c1', 3)))).toBe(93);
    expect(ownCard(c, 'c1', 3).tier).toBe(c.tier);
  });
});

describe('MyTeam packs', () => {
  const pack = (id: string) => OFFICIAL_PACKS.find((p) => p.id === id)!;

  it('the premium and elite packs keep their range and guarantee', () => {
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const p = openPack(pack('premium'), rand);
      expect(p).toHaveLength(3);
      expect(p.every((d) => tierIndex(d.card.tier) >= tierIndex('gold'))).toBe(true);
      expect(p.some((d) => tierIndex(d.card.tier) >= tierIndex('pink'))).toBe(true);
      expect(new Set(p.map((d) => d.card.id)).size).toBe(3);
      const e = openPack(pack('elite'), rand);
      expect(e.some((d) => tierIndex(d.card.tier) >= tierIndex('orange'))).toBe(true);
      for (const d of [...p, ...e]) expect(d.rental).toBeUndefined();
    }
    const odds = packOdds(pack('standard'));
    expect(odds.map((o) => o.tier)).toEqual(TIERS.map((t) => t.id));
    expect(odds.reduce((s, o) => s + o.chance, 0)).toBeCloseTo(1);
  });

  it('special cards only come from the limited pack, in their theme week; no 復刻 without old seasons', () => {
    for (const p of OFFICIAL_PACKS.filter((x) => x.kind !== 'limited')) expect(packPool(p).some((c) => c.source === 'special')).toBe(false);
    const theme = limitedTheme(100)!;
    expect(packPool(pack('limited'), 100).filter((c) => c.source === 'special').every((c) => c.theme === theme.id)).toBe(true);
    expect(packPool(pack('limited'), 100).some((c) => c.source === 'special')).toBe(true);
    expect(packPool(pack('reissue'))).toHaveLength(0);
  });

  it('position packs keep to their positions', () => {
    const rand = seeded(3);
    for (let i = 0; i < 50; i++) for (const d of openPack(pack('guards'), rand)) expect(['PG', 'SG']).toContain(d.card.position);
  });

  it('copies stack up to five (a sixth pays), merge to +5, and sell with their merges', () => {
    const save = newMyTeam(seeded(1));
    expect(save.cards).toHaveLength(10);
    expect(save.rentals).toHaveLength(5);
    expect(save.rentals.every((r) => r.games === 3 && ['gold', 'pink'].includes(r.tier))).toBe(true);
    expect(save.deck.length).toBe(13);
    const def = cardCatalog().find((c) => c.id === save.cards[0].id)!;
    const res = addDrops(save, [{ card: def }, { card: def }, { card: def }, { card: def }, { card: def }]);
    expect(res.slice(0, 4).every((r) => !r.isNew && !r.full && r.coins === 0)).toBe(true);
    expect(res[4].full).toBe(true);
    expect(res[4].coins).toBe(TIERS.find((t) => t.id === def.tier)!.value);
    expect(copiesOf(save, def.id)).toHaveLength(5);
    const keep = save.cards[0].uid;
    for (let i = 0; i < 4; i++) expect(mergeCard(save, keep)).toBe(true);
    expect(mergeCard(save, keep)).toBe(false);
    const merged = save.cards.find((c) => c.uid === keep)!;
    expect(merged.plus).toBe(4);
    expect(merged.ovr).toBe(Math.min(99, def.ovr + 4));
    addDrops(save, [{ card: def }]);
    expect(mergeCard(save, keep)).toBe(true);
    addDrops(save, [{ card: def }]);
    expect(mergeCard(save, keep)).toBe(false);
    expect(save.cards.find((c) => c.uid === keep)!.plus).toBe(5);
    expect(sellCard(save, keep)).toBe(TIERS.find((t) => t.id === def.tier)!.value * 6);
    expect(save.deck).not.toContain(keep);
    expect(statValue(save, 'cards')).toBe(10);
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
    expect(back.cards).toEqual(save.cards);
    expect(upgradeMyTeam({})).toBeNull();
  });

  it('old saves: base cards become this season, boosted cards are paid back, the deck follows', () => {
    const slugOf = (id: string) => id.replace(/^s\d+-/, '');
    const cur = cardCatalog().filter((c) => c.source === 'current').slice(0, 2);
    const v1 = {
      v: 1,
      period: 3,
      cards: [
        { ...ownCard(cur[0]), id: `b-${slugOf(cur[0].id)}`, ovr: 98, tier: 'black', base: true, period: 6, uid: undefined },
        { ...ownCard(cur[1]), id: `p4-${slugOf(cur[1].id)}`, tier: 'pink', base: false, period: 4, uid: undefined },
      ],
      rentals: [],
      deck: [`b-${slugOf(cur[0].id)}`],
      next: 7,
      packsOpened: 2,
      cleared: [],
      claimed: [],
      stats: {},
      events: [],
    };
    const s = upgradeMyTeam(JSON.parse(JSON.stringify(v1)))!;
    expect(s.v).toBe(2);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].id).toBe(cur[0].id);
    expect(s.cards[0].ovr).toBe(cur[0].ovr);
    expect(s.cards[0]).not.toHaveProperty('period');
    expect(s.deck).toEqual([s.cards[0].uid]);
    expect(s.refund).toBe(600);
    // Loaded again: no second refund.
    expect(upgradeMyTeam(JSON.parse(JSON.stringify(s)))!.refund).toBe(600);
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
    expect(again.coins).toBe(150);
  });

  it('game coins scale with the computer level, level rewards do not', () => {
    const save = newMyTeam(seeded(6));
    // The day's first win brings 300 more, once.
    const first = recordGame(save, { kind: 'quick', won: true, margin: 3, used: [], totals, difficulty: 'legend' }, Math.random, '2026-10-05');
    expect(first.coins).toBe(360 + 300);
    expect(first.firstWin).toBe(300);
    expect(recordGame(save, { kind: 'quick', won: false, margin: -3, used: [], totals, difficulty: 'easy' }, Math.random, '2026-10-05').coins).toBe(60);
    expect(recordGame(save, { kind: 'quick', won: true, margin: 3, used: [], totals }, Math.random, '2026-10-05').coins).toBe(225);
    expect(recordGame(save, { kind: 'quick', won: true, margin: 3, used: [], totals }, Math.random, '2026-10-06').coins).toBe(525);
    const lv = periodLevels(1)[0];
    const out = recordGame(save, { kind: 'ladder', won: true, margin: 5, level: lv.id, used: [], totals, difficulty: 'legend' }, seeded(1), '2026-10-06');
    expect(out.firstClear).toBe(true);
    expect(out.coins).toBe(lv.reward.coins ?? 0);
  });

  it('rentals lose a game each time they play and then leave the deck', () => {
    const save = newMyTeam(seeded(5));
    const r = save.rentals[0];
    expect(save.deck).toContain(r.uid);
    for (let i = 0; i < 2; i++) recordGame(save, { kind: 'quick', won: false, margin: -3, used: [r.uid], totals });
    expect(save.rentals.find((x) => x.uid === r.uid)?.games).toBe(1);
    const out = recordGame(save, { kind: 'quick', won: true, margin: 3, used: [r.uid], totals });
    expect(out.gone).toEqual([r.name]);
    expect(out.coins).toBe(225 + 300);
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

describe('MyTeam modes: dynasty, limited, events, practice', () => {
  const totals = { points: 0, threes: 0, assists: 0, blocks: 0, steals: 0 };

  it('ships 30 dynasty crews, 20 limited levels and full event themes', () => {
    expect(DYNASTY).toHaveLength(30);
    expect(LIMITED).toHaveLength(20);
    expect(EVENT_THEMES.length).toBeGreaterThanOrEqual(7);
    for (const t of EVENT_THEMES) expect(t.levels).toHaveLength(3);
    for (const l of LIMITED) {
      if (l.size === 5) expect(l.team).toBeTruthy();
      expect(ruleText(l.rule).length).toBeGreaterThan(0);
    }
    const ids = [...LEVELS, ...DYNASTY, ...LIMITED].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MISSIONS) expect(() => statValue(newMyTeam(seeded(1)), m.stat)).not.toThrow();
  });

  it('dynasty crews are fixed, rated to their level and beaten in order', () => {
    const d = DYNASTY[0];
    const crew = dynastyCrew(d);
    expect(crew).toHaveLength(3);
    expect(dynastyCrew(d).map((p) => p.name)).toEqual(crew.map((p) => p.name));
    const avg = crew.reduce((s, p) => s + playerRating(p), 0) / 3;
    expect(Math.abs(avg - d.ovr)).toBeLessThanOrEqual(3);
    const save = newMyTeam(seeded(2));
    const list = dynastyLevels(1);
    expect(dynastyOpen(save, list[1])).toBe(false);
    for (const l of list) recordGame(save, { kind: 'dynasty', won: true, margin: 3, level: l.id, used: [], totals, street: true }, seeded(1));
    expect(statValue(save, 'dynasty')).toBe(1);
    expect(statValue(save, 'cleared')).toBe(0);
    expect(statValue(save, 'streetWins')).toBe(5);
  });

  it('limited rules check each card and the lineup', () => {
    const cards = cardCatalog();
    const guards = cards.filter((c) => c.position === 'PG').slice(0, 3).map((c) => ownCard(c));
    expect(lineupProblem({ positions: ['PG', 'SG'] }, guards, 3)).toBeNull();
    const big = ownCard(cards.find((c) => c.position === 'C')!);
    expect(cardAllowed({ positions: ['PG', 'SG'] }, big)).toBe(false);
    expect(lineupProblem({ positions: ['PG', 'SG'] }, [...guards.slice(0, 2), big], 3)).not.toBeNull();
    expect(lineupProblem({}, guards.slice(0, 2), 3)).toBe('要選 3 人');
    expect(lineupProblem({ maxHeight: 1.5 }, guards, 3)).toContain('平均身高');
    const a = ownCard(cards[0]);
    const other = ownCard(cards.find((c) => c.team !== a.team)!);
    expect(cardAllowed({ sameTeam: true }, other, [a])).toBe(false);
    for (const l of LIMITED) {
      const t = limitedTeam(l);
      expect(t.players.length).toBeGreaterThanOrEqual(l.size);
    }
    const save = newMyTeam(seeded(3));
    recordGame(save, { kind: 'limited', won: true, margin: 2, level: LIMITED[0].id, used: [], totals }, seeded(1));
    expect(statValue(save, 'limited')).toBe(1);
  });

  it('event levels pay once a week and the week rolls over', () => {
    const save = newMyTeam(seeded(4));
    const week = eventWeek(Date.UTC(2026, 9, 5, 12));
    expect(eventWeek(Date.UTC(2026, 9, 11, 12))).toBe(week);
    expect(eventWeek(Date.UTC(2026, 9, 12, 12))).toBe(week + 1);
    const theme = eventTheme(week);
    for (let i = 0; i < 3; i++) {
      const t = eventTeam(theme, i, eventBase(save));
      expect(t.players.length).toBeGreaterThanOrEqual(theme.levels[i].size);
    }
    const first = recordGame(save, { kind: 'event', won: true, margin: 2, event: { week, index: 0 }, used: [], totals }, seeded(1));
    expect(first.firstClear).toBe(true);
    const again = recordGame(save, { kind: 'event', won: true, margin: 2, event: { week, index: 0 }, used: [], totals });
    expect(again.firstClear).toBe(false);
    const next = recordGame(save, { kind: 'event', won: true, margin: 2, event: { week: week + 1, index: 0 }, used: [], totals }, seeded(1));
    expect(next.firstClear).toBe(true);
    expect(save.events).toEqual([eventKey(week + 1, 0)]);
    expect(statValue(save, 'events')).toBe(2);
  });

  it('practice pays by game time and level', () => {
    expect(practiceCoins(12, false, 'normal')).toBe(120);
    expect(practiceCoins(12, true, 'normal')).toBe(180);
    expect(practiceCoins(20, true, 'legend')).toBe(480);
    expect(practiceCoins(3, false, 'easy')).toBe(24);
  });
});
