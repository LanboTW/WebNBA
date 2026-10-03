import {
  DECK_MAX,
  OFFICIAL_PACKS,
  POSITIONS,
  RATING_KEYS,
  TIERS,
  addDrops,
  autoDeck,
  cardCatalog,
  cleanDeck,
  deckCard,
  deckRating,
  isRental,
  openPack,
  packOdds,
  packPool,
  periodTop,
  refOf,
  sellCard,
  tier,
  type DropResult,
  type OwnedCard,
  type PackDef,
  type Position,
  type TierId,
} from '@webnba/shared';
import { esc } from './boxscore';
import { cardHtml, hydrateCards, shiny } from './cards';
import { RATING_LABEL } from './careerCreate';
import { myteam } from './myteamStore';
import { coinsText, wallet } from './wallet';

/**
 * The MyTeam screen: deck, collection and pack shop, plus the
 * pack-opening reveal. Everything is saved through the myteam store; coins
 * come from the account wallet.
 */

type Tab = 'deck' | 'cards' | 'shop';
const TABS: [Tab, string][] = [
  ['deck', '牌組'],
  ['cards', '收藏'],
  ['shop', '卡包商店'],
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let tab: Tab = 'deck';
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
    `<span class="fine">挑戰之路與任務即將推出，用來解鎖下一期</span></div>` +
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

// ----------------------------------------------------------------- render

export function renderMyTeam(): void {
  const root = $('#mtBody');
  if (!myteam.ready) {
    root.innerHTML = '<p class="fine">讀取收藏中…</p>';
    return;
  }
  const s = myteam.save;
  $('#mtCoins').textContent = `🪙 ${coinsText(wallet.coins)}`;
  $('#mtTabs').innerHTML = TABS.map(([id, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('');
  root.innerHTML =
    (message ? `<p class="msg">${esc(message)}</p>` : '') +
    (tab === 'deck' ? deckTab() : tab === 'cards' ? cardsTab() : shopTab());
  hydrateCards(root, allCards());
  void s;
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
  reveal(pack, results);
}

/** The pack opening: face-down cards, flipped one by one, the best last. */
function reveal(pack: PackDef, results: DropResult[]): void {
  const el = $('#packOpen');
  const best = results.reduce((b, r) => Math.max(b, TIERS.findIndex((t) => t.id === r.card.tier)), 0);
  el.style.setProperty('--best', TIERS[best].color);
  $('#poTitle').textContent = pack.name;
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

export function initMyTeam(): void {
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
