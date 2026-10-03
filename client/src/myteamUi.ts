import {
  DECK_MAX,
  GAME_COINS,
  LEVELS,
  MISSIONS,
  MISSIONS_PER_PERIOD,
  MYTEAM_INFO,
  OFFICIAL_PACKS,
  PERIODS,
  POSITIONS,
  RATING_KEYS,
  TIERS,
  addDrops,
  autoDeck,
  cardCatalog,
  cardPlayer,
  claimMission,
  cleanDeck,
  deckCard,
  deckLineup,
  deckRating,
  findTeam,
  isRental,
  levelOpen,
  levelTeam,
  missionDone,
  periodCleared,
  periodLevels,
  quickOpponent,
  recordGame,
  statValue,
  streetOpponents,
  openPack,
  packOdds,
  packPool,
  periodTop,
  refOf,
  sellCard,
  tier,
  type Difficulty,
  type DropResult,
  type GameKind,
  type GameOutcome,
  type GameSettings,
  type GameState,
  type LevelDef,
  type MyTeamSave,
  type OwnedCard,
  type PackDef,
  type PlayerStats,
  type Position,
  type Reward,
  type TeamInfo,
  type TierId,
} from '@webnba/shared';
import { esc, teamRows } from './boxscore';
import { logoHtml } from './logos';
import { cardHtml, hydrateCards, shiny } from './cards';
import { RATING_LABEL } from './careerCreate';
import { myteam } from './myteamStore';
import { coinsText, wallet } from './wallet';

/**
 * The MyTeam screen: games (ladder, quick, street 3v3), missions, deck,
 * collection and pack shop, plus the pack-opening reveal. Everything is saved through the myteam store; coins
 * come from the account wallet.
 */

type Tab = 'play' | 'missions' | 'deck' | 'cards' | 'shop';
const TABS: [Tab, string][] = [
  ['play', '比賽'],
  ['missions', '任務'],
  ['deck', '牌組'],
  ['cards', '收藏'],
  ['shop', '卡包商店'],
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let tab: Tab = 'play';
/** The deck slot being filled (0-12). */
let slot: number | null = null;
let filterTier: TierId | 'all' = 'all';
let filterPos: Position | 'all' = 'all';
let detail: string | null = null;
let confirmSell = false;
let message = '';

const allCards = (): OwnedCard[] => {
  const s = myteam.save;
  return [...s.cards, ...s.rentals];
};

function tierChips(on: TierId | 'all', attr: string, withAll = true): string {
  const all = withAll ? `<button type="button" class="chip${on === 'all' ? ' on' : ''}" ${attr}="all">全部</button>` : '';
  return all + TIERS.map((t) => `<button type="button" class="chip tierchip${on === t.id ? ' on' : ''}" style="--tier:${t.color}" ${attr}="${t.id}">${t.name}</button>`).join('');
}

function posChips(on: Position | 'all', attr: string): string {
  return (
    `<button type="button" class="chip${on === 'all' ? ' on' : ''}" ${attr}="all">全部</button>` +
    POSITIONS.map((p) => `<button type="button" class="chip${on === p ? ' on' : ''}" ${attr}="${p}">${p}</button>`).join('')
  );
}

function filtered(cards: OwnedCard[]): OwnedCard[] {
  return cards
    .filter((c) => (filterTier === 'all' || c.tier === filterTier) && (filterPos === 'all' || c.position === filterPos))
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------- tabs

function deckTab(): string {
  const s = myteam.save;
  const cell = (i: number) => {
    const c = s.deck[i] ? deckCard(s, s.deck[i]) : null;
    const on = slot === i ? ' on' : '';
    return c
      ? `<button type="button" class="mtslot${on}" data-slot="${i}">${cardHtml(c, { cls: 'small' })}</button>`
      : `<button type="button" class="mtslot empty${on}" data-slot="${i}"><span>${i < 5 ? POSITIONS[i] : '板凳'}<br />＋</span></button>`;
  };
  const inDeck = new Set(s.deck);
  const names = new Set(s.deck.map((r) => deckCard(s, r)?.name));
  const picks = filtered(allCards().filter((c) => !inDeck.has(refOf(c))));
  const sel = slot !== null && s.deck[slot] ? deckCard(s, s.deck[slot]) : null;
  return (
    `<div class="mtbar"><span>牌組評分 <b class="big">${deckRating(s)}</b></span><span>${s.deck.length}/${DECK_MAX} 張</span>` +
    `<button type="button" class="small" data-act="auto">自動組牌</button></div>` +
    `<h3 class="mth">先發</h3><div class="mtslots">${[0, 1, 2, 3, 4].map(cell).join('')}</div>` +
    `<h3 class="mth">板凳</h3><div class="mtslots">${Array.from({ length: DECK_MAX - 5 }, (_, i) => cell(i + 5)).join('')}</div>` +
    (sel ? `<div class="mtbar"><span>已選：${esc(sel.name)}</span><button type="button" class="small" data-act="unslot">移出牌組</button></div>` : '') +
    `<p class="fine left">${slot === null ? '先點一個位置，' : `把卡放進第 ${slot + 1} 格：`}從下面挑一張卡。同一名球員只能放一張；租借卡打完場數就會消失。</p>` +
    `<div class="chips">${tierChips(filterTier, 'data-ft')}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
    `<div class="mtgrid">${
      picks.map((c) => cardHtml(c, { cls: `small pick${names.has(c.name) ? ' dim' : ''}`, ref: refOf(c) })).join('') ||
      '<p class="fine">沒有符合的卡。</p>'
    }</div>`
  );
}

function detailHtml(c: OwnedCard): string {
  const s = myteam.save;
  const rows = RATING_KEYS.map((k, i) => `<span>${RATING_LABEL[k]}<b>${c.ratings[i]}</b></span>`).join('');
  const sell = isRental(c)
    ? '<p class="fine left">租借卡不能分解，打完場數就會消失。</p>'
    : confirmSell
      ? `<div class="confirm">分解 ${esc(c.name)}，得到 ${tier(c.tier).value} 金幣？` +
        `<button type="button" class="small danger" data-act="sell">確定分解</button><button type="button" class="small" data-act="nosell">取消</button></div>`
      : `<button type="button" class="small" data-act="asksell">分解（+${tier(c.tier).value} 金幣）</button>`;
  return (
    `<div class="mtdetail">${cardHtml(c, { cls: 'big' })}<div class="mtinfo">` +
    `<h3>${esc(c.name)}</h3><p class="fine left">${tier(c.tier).name}卡${c.base ? '' : '（強化版）'} · ${c.position} · ${c.heightM.toFixed(2)} m${
      s.deck.includes(refOf(c)) ? ' · 在牌組中' : ''
    }</p>` +
    `<div class="mtratings">${rows}</div>${sell}<button type="button" class="small" data-act="close">關閉</button></div></div>`
  );
}

function cardsTab(): string {
  const cards = allCards();
  const d = detail ? cards.find((c) => refOf(c) === detail) : null;
  const shown = filtered(cards);
  const total = cardCatalog().length;
  return (
    (d ? detailHtml(d) : '') +
    `<div class="mtbar"><span>收藏 <b>${myteam.save.cards.length}</b> / ${total} 張</span><span>租借 ${myteam.save.rentals.length} 張</span><span>已開 ${myteam.save.packsOpened} 包</span></div>` +
    `<div class="chips">${tierChips(filterTier, 'data-ft')}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
    `<div class="mtgrid">${shown.map((c) => cardHtml(c, { cls: 'small pick', ref: refOf(c) })).join('') || '<p class="fine">沒有符合的卡。</p>'}</div>`
  );
}

function oddsBar(p: PackDef): string {
  const period = myteam.save.period;
  const odds = packOdds(p, period);
  if (!odds.length) return '<p class="fine left">這一期還沒有這個卡包能開出的卡。</p>';
  const segs = odds.map((o) => `<i style="--tier:${tier(o.tier).color};flex:${o.chance}" title="${tier(o.tier).name} ${(o.chance * 100).toFixed(1)}%"></i>`).join('');
  const text = odds.map((o) => `${tier(o.tier).name} ${(o.chance * 100).toFixed(o.chance < 0.1 ? 1 : 0)}%`).join('・');
  return `<div class="oddsbar">${segs}</div><p class="odds">${text}</p>`;
}

function packDesc(p: PackDef): string {
  const bits = [`${p.count} 張`];
  if (p.positions?.length) bits.push(p.positions.join('/'));
  if (p.tiers?.length) bits.push(`限 ${p.tiers.map((t) => tier(t).name).join('、')}`);
  if (p.players?.length) bits.push(`${p.players.length} 名指定球員`);
  if (p.guaranteeTop) bits.push(`保底 1 張${tier(periodTop(myteam.save.period)).name}卡`);
  if (p.rentalChance) bits.push(`租借機率 ${Math.round(p.rentalChance * 100)}%`);
  return bits.join(' · ');
}

function shopTab(): string {
  const s = myteam.save;
  const top = tier(periodTop(s.period));
  return (
    `<div class="mtbar"><span>第 <b>${s.period}</b> 期・最高 <b style="color:${top.color === '#1a1a1f' ? '#fff' : top.color}">${top.name}卡</b></span>` +
    `<span class="fine">${nextPeriodText(s)}</span></div>` +
    OFFICIAL_PACKS
      .map((p) => {
        const can = wallet.coins >= p.price && packPool(p, s.period).length > 0;
        return (
          `<div class="mtpack"><div class="mtpack-h"><b>${esc(p.name)}</b></div>` +
          `<p class="fine left">${packDesc(p)}</p>${oddsBar(p)}` +
          `<button type="button" class="primary buy" data-buy="${esc(p.id)}"${can ? '' : ' disabled'}>購買　🪙 ${coinsText(p.price)}</button></div>`
        );
      })
      .join('')
  );
}

// ----------------------------------------------------------------- play

/** What main.ts provides to start a game and hear how it went. */
export interface MyTeamHost {
  play(
    teams: [TeamInfo, TeamInfo],
    settings: Partial<GameSettings>,
    finish: (state: GameState, forfeit: boolean) => string,
    after: () => void,
  ): void;
}

let host: MyTeamHost | null = null;
let ladderPeriod = 0;
/** Deck refs picked for street games. */
let streetPick: string[] = [];
const DIFF_LABEL: Record<Difficulty, string> = { easy: '簡單', normal: '普通', hard: '困難' };

function pref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`webnba.mt.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
function setPref(key: string, value: string): void {
  try {
    localStorage.setItem(`webnba.mt.${key}`, value);
  } catch {
    // Not kept.
  }
}

function rewardText(r: Reward): string {
  const bits: string[] = [];
  if (r.coins) bits.push(`${r.coins} 金幣`);
  if (r.pack) bits.push(OFFICIAL_PACKS.find((p) => p.id === r.pack)?.name ?? '卡包');
  if (r.rental) bits.push(`${tier(r.rental).name}卡租借（3 場）`);
  if (r.card) bits.push(`${tier(r.card).name}卡一張`);
  return bits.join('＋');
}

function nextPeriodText(s: MyTeamSave): string {
  if (s.period >= PERIODS) return '已開放全部 6 期';
  const need = MISSIONS_PER_PERIOD * s.period - s.claimed.length;
  return `下一期：打完第 ${s.period} 期挑戰之路，或再領 ${need} 個任務獎勵`;
}

function playTab(): string {
  const s = myteam.save;
  if (!ladderPeriod || ladderPeriod > s.period) ladderPeriod = s.period;
  const lineup = deckLineup(s);
  const full = lineup.length >= 5;
  const periods = Array.from({ length: PERIODS }, (_, i) => i + 1)
    .map((p) => {
      const open = p <= s.period;
      return `<button type="button" class="chip${p === ladderPeriod ? ' on' : ''}" data-lp="${p}"${open ? '' : ' disabled'}>第 ${p} 期${
        periodCleared(s, p) ? ' ✓' : open ? '' : ' 🔒'
      }</button>`;
    })
    .join('');
  const levels = periodLevels(ladderPeriod)
    .map((l, i) => {
      const team = findTeam(l.team);
      const done = s.cleared.includes(l.id);
      const open = levelOpen(s, l);
      const btn = open
        ? `<button type="button" class="small${done ? '' : ' go'}" data-level="${l.id}"${full ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>`
        : '<span class="lock">🔒</span>';
      return (
        `<div class="mtlevel${done ? ' done' : ''}${l.boss ? ' boss' : ''}">` +
        `${logoHtml(team, 'lvlogo')}<div class="lvinfo"><b>${l.boss ? '魔王關' : `第 ${i + 1} 關`}・${esc(team.name)}</b>` +
        `<span>對手評分 ${l.ovr}・${DIFF_LABEL[l.difficulty]}・${done ? '已過關（再贏 100 金幣）' : `首勝：${rewardText(l.reward)}`}</span></div>${btn}</div>`
      );
    })
    .join('');
  const picks = lineup
    .map((c) => {
      const ref = refOf(c);
      const on = streetPick.includes(ref);
      return `<button type="button" class="chip${on ? ' on' : ''}" data-sp="${esc(ref)}"${!on && streetPick.length >= 3 ? ' disabled' : ''}>${c.position} ${esc(
        c.name,
      )} ${c.ovr}${isRental(c) ? '（租）' : ''}</button>`;
    })
    .join('');
  const diff = pref('diff', 'normal');
  const quarter = pref('quarter', '180');
  const target = pref('target', '21');
  const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  return (
    `<div class="mtbar"><span>第 <b>${s.period}</b> 期</span><span>牌組評分 <b>${deckRating(s)}</b></span><span>${nextPeriodText(s)}</span></div>` +
    (full ? '' : '<p class="msg">牌組至少要 5 張卡才能比賽，先到「牌組」分頁放卡。</p>') +
    `<h3 class="mth">挑戰之路</h3><div class="chips">${periods}</div><div class="mtlevels">${levels}</div>` +
    `<h3 class="mth">快速對戰</h3><div class="mtplay"><span class="fine left">對上和你牌組同等級的隨機 NBA 球隊。贏 ${GAME_COINS.win}、輸 ${GAME_COINS.loss} 金幣。</span>` +
    `<button type="button" class="small go" data-act="quickgame"${full ? '' : ' disabled'}>開始</button></div>` +
    `<h3 class="mth">街頭 3 對 3</h3><p class="fine left">從牌組挑 3 人（${streetPick.length}/3），對上 3 名同等級的隨機球員。</p><div class="chips">${picks}</div>` +
    `<div class="mtplay"><label class="fine">搶 <select id="mtTarget">${opt('11', '11 分', target)}${opt('21', '21 分', target)}</select></label>` +
    `<button type="button" class="small go" data-act="streetgame"${streetPick.length === 3 ? '' : ' disabled'}>開始</button></div>` +
    `<h3 class="mth">比賽設定</h3><div class="row"><label>快速對戰／街頭難度<select id="mtDiff">${opt('easy', '簡單', diff)}${opt('normal', '普通', diff)}${opt(
      'hard',
      '困難',
      diff,
    )}</select></label>` +
    `<label>每節長度<select id="mtQuarter">${opt('60', '1 分鐘', quarter)}${opt('120', '2 分鐘', quarter)}${opt('180', '3 分鐘', quarter)}${opt(
      '300',
      '5 分鐘',
      quarter,
    )}${opt('720', '12 分鐘', quarter)}</select></label></div>` +
    '<p class="fine left">比賽中離開算輸、沒有金幣，租借卡一樣扣一場。挑戰之路的難度由關卡決定。</p>'
  );
}

function missionsTab(): string {
  const s = myteam.save;
  const rows = MISSIONS.map((m) => {
    const v = Math.min(m.target, statValue(s, m.stat));
    const claimed = s.claimed.includes(m.id);
    const done = v >= m.target;
    const btn = claimed
      ? '<span class="lock">✓ 已領取</span>'
      : `<button type="button" class="small${done ? ' go' : ''}" data-claim="${m.id}"${done ? '' : ' disabled'}>領取</button>`;
    return (
      `<div class="mtmission${claimed ? ' done' : ''}"><div class="lvinfo"><b>${esc(m.text)}</b><span>獎勵：${rewardText(m.reward)}</span>` +
      `<div class="mbar"><i style="width:${(v / m.target) * 100}%"></i></div><span>${v} / ${m.target}</span></div>${btn}</div>`
    );
  }).join('');
  return (
    `<div class="mtbar"><span>已領 <b>${s.claimed.length}</b> / ${MISSIONS.length}</span><span>${nextPeriodText(s)}</span></div>` + rows
  );
}

function missionsReady(): number {
  const s = myteam.save;
  return MISSIONS.filter((m) => !s.claimed.includes(m.id) && missionDone(s, m)).length;
}

/** Results to show when back from a game (rewards that came as cards). */
let pending: { title: string; drops: DropResult[] } | null = null;

function finishText(out: GameOutcome, won: boolean, forfeit: boolean): string {
  const bits = [forfeit ? '中途離開，算輸' : won ? '勝利' : '落敗'];
  if (out.coins) bits.push(`+${out.coins} 金幣`);
  if (out.firstClear) bits.push('首次過關');
  if (out.drops.length) bits.push(`獲得 ${out.drops.length} 張卡`);
  if (out.gone.length) bits.push(`租借到期：${out.gone.join('、')}`);
  if (out.unlocked) bits.push(`第 ${out.unlocked} 期開放！`);
  return bits.join('・');
}

function startGame(kind: GameKind, opts: { level?: LevelDef } = {}): void {
  if (!host) return;
  const s = myteam.save;
  const diff = (opts.level?.difficulty ?? pref('diff', 'normal')) as Difficulty;
  let teams: [TeamInfo, TeamInfo];
  let used: string[];
  const settings: Partial<GameSettings> = {
    mode: 'game',
    humanTeams: [0],
    difficulty: diff,
    quarterSeconds: Number(pref('quarter', '180')),
    seed: (Math.random() * 2 ** 31) | 0,
  };
  if (kind === 'street') {
    const cards = streetPick.map((r) => deckCard(s, r)).filter((c): c is OwnedCard => !!c);
    if (cards.length !== 3) return;
    cards.sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
    used = cards.map(refOf);
    const avg = Math.round(cards.reduce((t, c) => t + c.ovr, 0) / cards.length);
    teams = [
      { ...MYTEAM_INFO, players: cards.map(cardPlayer) },
      { abbr: '對手', name: '街頭對手', primary: '#2a5db0', secondary: '#ffffff', players: streetOpponents(3, avg, cards.map((c) => c.name)) },
    ];
    settings.street = { target: Number(pref('target', '21')), makeItTakeIt: false };
  } else {
    const lineup = deckLineup(s);
    if (lineup.length < 5) return;
    used = lineup.map(refOf);
    teams = [{ ...MYTEAM_INFO, players: lineup.map(cardPlayer) }, opts.level ? levelTeam(opts.level) : quickOpponent(s)];
  }
  host.play(
    teams,
    settings,
    (state, forfeit) => {
      const rows = teamRows(state, 0);
      const sum = (f: (st: PlayerStats) => number) => rows.reduce((t, r) => t + f(r.stats), 0);
      // A full game's rentals count only if they got on the floor.
      const played = kind === 'street' ? used : used.filter((_, i) => (rows.find((r) => r.rosterIdx === i)?.stats.secs ?? 0) > 0);
      const [a, b] = state.score;
      const out = recordGame(s, {
        kind,
        won: a > b,
        margin: a - b,
        level: opts.level?.id,
        used: played,
        forfeit,
        totals: {
          points: sum((x) => x.pts),
          threes: sum((x) => x.tpm),
          assists: sum((x) => x.ast),
          blocks: sum((x) => x.blk),
          steals: sum((x) => x.stl),
        },
      });
      streetPick = streetPick.filter((r) => deckCard(s, r));
      myteam.commit();
      if (out.coins) void wallet.add(out.coins);
      if (out.drops.length) pending = { title: out.firstClear ? '過關獎勵' : '獎勵', drops: out.drops };
      message = finishText(out, a > b, forfeit);
      return message;
    },
    () => {
      renderMyTeam();
      if (pending) {
        reveal(pending.title, pending.drops);
        pending = null;
      }
    },
  );
}

// ----------------------------------------------------------------- render

export function renderMyTeam(): void {
  const root = $('#mtBody');
  if (!myteam.ready) {
    root.innerHTML = '<p class="fine">讀取收藏中…</p>';
    return;
  }
  const s = myteam.save;
  $('#mtCoins').textContent = `🪙 ${coinsText(wallet.coins)}`;
  const ready = missionsReady();
  $('#mtTabs').innerHTML = TABS.map(
    ([id, label]) =>
      `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}${id === 'missions' && ready ? ` <i class="dot">${ready}</i>` : ''}</button>`,
  ).join('');
  streetPick = streetPick.filter((r) => s.deck.includes(r));
  root.innerHTML =
    (message ? `<p class="msg">${esc(message)}</p>` : '') +
    (tab === 'play' ? playTab() : tab === 'missions' ? missionsTab() : tab === 'deck' ? deckTab() : tab === 'cards' ? cardsTab() : shopTab());
  hydrateCards(root, allCards());
}

// ----------------------------------------------------------------- packs

async function buy(id: string): Promise<void> {
  const s = myteam.save;
  const pack = OFFICIAL_PACKS.find((p) => p.id === id);
  if (!pack) return;
  if (!(await wallet.add(-pack.price))) {
    message = '金幣不夠。快速對戰、生涯退休結算都能賺金幣。';
    renderMyTeam();
    return;
  }
  message = '';
  const drops = openPack(pack, s.period);
  const results = addDrops(s, drops);
  cleanDeck(s);
  // A first deck fills itself.
  if (s.deck.length < 5) s.deck = autoDeck(s);
  myteam.commit();
  const coins = results.reduce((sum, r) => sum + r.coins, 0);
  if (coins) void wallet.add(coins);
  reveal(pack.name, results);
}

/** The pack opening: face-down cards, flipped one by one, the best last. */
function reveal(title: string, results: DropResult[]): void {
  const el = $('#packOpen');
  const best = results.reduce((b, r) => Math.max(b, TIERS.findIndex((t) => t.id === r.card.tier)), 0);
  el.style.setProperty('--best', TIERS[best].color);
  $('#poTitle').textContent = title;
  $('#poCards').innerHTML = results
    .map((r, i) => {
      const note = isRental(r.card) ? '' : r.isNew ? '<b class="new">NEW</b>' : `重複・+${r.coins} 金幣`;
      return (
        `<button type="button" class="flip t-${r.card.tier}${shiny(r.card) ? ' shiny' : ''}" data-i="${i}" style="--tier:${tier(r.card.tier).color};--delay:${i * 0.08}s">` +
        `<span class="back"><b>WebNBA</b><i>MyTeam</i></span><span class="front">${cardHtml(r.card, { note })}</span><span class="burst"></span></button>`
      );
    })
    .join('');
  hydrateCards($('#poCards'), results.map((r) => r.card));
  const coins = results.reduce((s, r) => s + r.coins, 0);
  $('#poSummary').textContent = '';
  $('#poSummary').dataset.text = `新卡 ${results.filter((r) => r.isNew && !isRental(r.card)).length} 張・租借 ${
    results.filter((r) => isRental(r.card)).length
  } 張${coins ? `・重複換得 ${coins} 金幣` : ''}`;
  $('#poAll').classList.remove('hidden');
  el.classList.remove('hidden', 'flash', 'shake', 'done');
}

function flip(btn: HTMLElement): void {
  if (btn.classList.contains('open')) return;
  btn.classList.add('open');
  const t = [...btn.classList].find((c) => c.startsWith('t-'))?.slice(2) as TierId | undefined;
  const el = $('#packOpen');
  if (t && TIERS.findIndex((x) => x.id === t) >= TIERS.findIndex((x) => x.id === 'pink')) {
    el.classList.remove('flash', 'shake');
    void el.offsetWidth;
    el.classList.add('flash');
    if (t === 'black') el.classList.add('shake');
  }
  const left = $('#poCards').querySelectorAll('.flip:not(.open)').length;
  if (!left) {
    $('#poSummary').textContent = $('#poSummary').dataset.text ?? '';
    $('#poAll').classList.add('hidden');
    el.classList.add('done');
  }
}

// ----------------------------------------------------------------- events

export function initMyTeam(h: MyTeamHost): void {
  host = h;
  myteam.onChange(() => {
    if (!$('#myteam').classList.contains('hidden')) renderMyTeam();
  });
  wallet.watch(() => {
    if (!$('#myteam').classList.contains('hidden')) {
      $('#mtCoins').textContent = `🪙 ${coinsText(wallet.coins)}`;
      if (tab === 'shop') renderMyTeam();
    }
  });
  $('#mtTabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as Tab;
    message = '';
    detail = null;
    confirmSell = false;
    renderMyTeam();
  });
  $('#mtBody').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const s = myteam.save;
    const data = (attr: string) => el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    const act = data('data-act');
    const ft = data('data-ft');
    const fp = data('data-fp');
    if (ft) filterTier = ft as TierId | 'all';
    else if (fp) filterPos = fp as Position | 'all';
    else if (data('data-slot') !== null) {
      const i = Number(data('data-slot'));
      slot = slot === i ? null : i;
    } else if (data('data-lp')) ladderPeriod = Number(data('data-lp'));
    else if (data('data-level')) {
      const level = LEVELS.find((l) => l.id === data('data-level'));
      if (level && levelOpen(s, level)) startGame('ladder', { level });
      return;
    } else if (data('data-sp')) {
      const ref = data('data-sp')!;
      streetPick = streetPick.includes(ref) ? streetPick.filter((r) => r !== ref) : [...streetPick, ref].slice(0, 3);
    } else if (data('data-claim')) {
      const got = claimMission(s, data('data-claim')!);
      if (got) {
        myteam.commit();
        if (got.coins) void wallet.add(got.coins);
        message = `任務完成：+${got.coins} 金幣${got.unlocked ? `・第 ${got.unlocked} 期開放！` : ''}`;
        if (got.drops.length) {
          renderMyTeam();
          reveal('任務獎勵', got.drops);
          return;
        }
      }
    } else if (act === 'quickgame') {
      startGame('quick');
      return;
    } else if (act === 'streetgame') {
      startGame('street');
      return;
    } else if (data('data-buy')) {
      void buy(data('data-buy')!);
      return;
    } else if (data('data-ref') && !act) {
      const ref = data('data-ref')!;
      if (tab === 'deck') {
        const c = allCards().find((x) => refOf(x) === ref);
        if (c) {
          const at = Math.min(slot ?? s.deck.length, s.deck.length);
          const twin = s.deck.findIndex((r) => deckCard(s, r)?.name === c.name);
          if (at < s.deck.length) s.deck[at] = ref;
          else if (s.deck.length < DECK_MAX) s.deck.push(ref);
          // The same player elsewhere in the deck makes way.
          if (twin >= 0 && twin !== at) s.deck.splice(twin, 1);
          slot = null;
          cleanDeck(s);
          myteam.commit();
        }
      } else {
        detail = ref;
        confirmSell = false;
        $('#myteam').scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (act === 'auto') {
      s.deck = autoDeck(s);
      slot = null;
      myteam.commit();
    } else if (act === 'unslot' && slot !== null) {
      s.deck.splice(slot, 1);
      slot = null;
      myteam.commit();
    } else if (act === 'asksell') confirmSell = true;
    else if (act === 'nosell') confirmSell = false;
    else if (act === 'sell' && detail) {
      const coins = sellCard(s, detail);
      if (coins) void wallet.add(coins);
      message = coins ? `分解完成，+${coins} 金幣` : '';
      detail = null;
      confirmSell = false;
      myteam.commit();
    } else if (act === 'close') detail = null;
    else return;
    renderMyTeam();
  });
  $('#mtBody').addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.id === 'mtDiff') setPref('diff', el.value);
    if (el.id === 'mtQuarter') setPref('quarter', el.value);
    if (el.id === 'mtTarget') setPref('target', el.value);
  });
  $('#poCards').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.flip');
    if (b) flip(b);
  });
  $('#poAll').addEventListener('click', () => {
    $('#poCards').querySelectorAll<HTMLElement>('.flip:not(.open)').forEach((b, i) => setTimeout(() => flip(b), i * 260));
  });
  $('#poDone').addEventListener('click', () => {
    $('#packOpen').classList.add('hidden');
    renderMyTeam();
  });
}
