import {
  DECK_MAX,
  DYNASTY,
  deckCohesion,
  noteDeckGame,
  LEVELS,
  LIMITED,
  PRACTICE_COINS,
  cardAllowed,
  dynastyCleared,
  dynastyCrew,
  dynastyLevels,
  dynastyOpen,
  eventBase,
  eventEnds,
  eventKey,
  eventTeam,
  eventTheme,
  eventWeek,
  limitedTeam,
  lineupProblem,
  practiceCoins,
  ruleText,
  type LimitedDef,
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
  refOf,
  sellCard,
  tier,
  CARD_SOURCES,
  COPY_MAX,
  FIRST_WIN_COINS,
  GAME_COINS,
  PLUS_MAX,
  cardWhere,
  catalogCard,
  copiesOf,
  firstWinBonus,
  limitedTheme,
  nextLimited,
  localDay,
  mergeCard,
  mergeFodder,
  ownCard,
  reissueSeason,
  seasonLabel,
  sellValue,
  specialTheme,
  HOLIDAYS,
  SPECIAL_GROUPS,
  activeHolidays,
  daysLeft,
  holidayKey,
  holidayOn,
  holidayOpen,
  legacyLevels,
  legacyTeam,
  teamRating,
  isHistory,
  limitedGroup,
  type HolidayDef,
  type LegacyDef,
  type SpecialGroup,
  type CardDef,
  type CardSource,
  type Difficulty,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  DIFFICULTY_COINS,
  type DropResult,
  type GameKind,
  type GameOutcome,
  type GameSettings,
  type GameState,
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
 * The MyTeam screen: games (ladder, street dynasty, special levels, weekly and
 * holiday events), missions, deck, collection, practice games and the pack
 * shop, plus the pack-opening reveal. Everything is saved through the myteam
 * store; coins come from the account wallet.
 */

type Tab = 'play' | 'missions' | 'deck' | 'cards' | 'practice' | 'shop';
const TABS: [Tab, string][] = [
  ['play', '比賽'],
  ['missions', '任務'],
  ['deck', '牌組'],
  ['cards', '收藏'],
  ['practice', '隨機比賽（練習）'],
  ['shop', '卡包商店'],
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

let tab: Tab = 'play';
/** The deck slot being filled (0-12). */
let slot: number | null = null;
let filterTier: TierId | 'all' | 'rental' = 'all';
let filterPos: Position | 'all' = 'all';
let filterSource: CardSource | 'all' = 'all';
let detail: string | null = null;
/** The copy waiting for the sell confirmation. */
let confirmSell: string | null = null;
let message = '';
/** Cards on screen that are not owned (the collection's locked ones): their portraits get drawn too. */
let lockedShown: OwnedCard[] = [];
/** The search box (collection, deck, special-level picker): kept across tabs, cleared on leaving MyTeam. */
let search = '';

/** A fresh visit to MyTeam: the search starts empty. */
export function resetMyTeamSearch(): void {
  search = '';
}

/** Whether a card matches the search: its player, team (abbreviation or name) or label. */
function matches(c: OwnedCard): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.team, findTeam(c.team).name, c.label].some((t) => t.toLowerCase().includes(q));
}

function searchBox(): string {
  return `<input type="search" id="mtSearch" class="mtsearch" placeholder="搜尋球員、球隊、標示（2016、MVP、聖誕）" value="${esc(search)}" autocomplete="off" />`;
}

const allCards = (): OwnedCard[] => {
  const s = myteam.save;
  return [...s.cards, ...s.rentals];
};

function tierChips(on: TierId | 'all' | 'rental', attr: string, withAll = true, rental = false): string {
  const all = withAll ? `<button type="button" class="chip${on === 'all' ? ' on' : ''}" ${attr}="all">全部</button>` : '';
  return (
    all +
    TIERS.map((t) => `<button type="button" class="chip tierchip${on === t.id ? ' on' : ''}" style="--tier:${t.color}" ${attr}="${t.id}">${t.name}</button>`).join('') +
    (rental ? `<button type="button" class="chip tierchip rentchip${on === 'rental' ? ' on' : ''}" ${attr}="rental">租借</button>` : '')
  );
}

function sourceChips(): string {
  return [['all', '全部'] as [string, string], ...CARD_SOURCES]
    .map(([k, l]) => `<button type="button" class="chip${filterSource === k ? ' on' : ''}" data-fs="${k}">${l}</button>`)
    .join('');
}

/** One copy per card (the most merged one): copies are picked as one. Rentals stay apart. */
function bestCopies(cards: OwnedCard[]): OwnedCard[] {
  const best = new Map<string, OwnedCard>();
  for (const c of cards) {
    const key = isRental(c) ? c.uid : c.id;
    const b = best.get(key);
    if (!b || (c.plus ?? 0) > (b.plus ?? 0)) best.set(key, c);
  }
  return [...best.values()];
}

function posChips(on: Position | 'all', attr: string): string {
  return (
    `<button type="button" class="chip${on === 'all' ? ' on' : ''}" ${attr}="all">全部</button>` +
    POSITIONS.map((p) => `<button type="button" class="chip${on === p ? ' on' : ''}" ${attr}="${p}">${p}</button>`).join('')
  );
}

function filtered(cards: OwnedCard[]): OwnedCard[] {
  return cards
    .filter(
      (c) =>
        (filterTier === 'all' || (filterTier === 'rental' ? isRental(c) : !isRental(c) && c.tier === filterTier)) &&
        (filterPos === 'all' || c.position === filterPos) &&
        (filterSource === 'all' || c.source === filterSource) &&
        matches(c),
    )
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------- tabs

/** Two columns on wide screens; `rightFirst` puts the right one on top when they stack. */
function cols(left: string, right: string, rightFirst = false): string {
  return `<div class="cols mtcols"><div class="col">${left}</div><div class="col">${rightFirst ? `<div class="q-top">${right}</div>` : right}</div></div>`;
}

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
  const picks = filtered(bestCopies(allCards().filter((c) => !inDeck.has(refOf(c)))));
  const rentals = s.rentals.length
    ? `<h3 class="mth">租借卡<small>${s.rentals.length} 張・打完場數就消失</small></h3><div class="chips">${s.rentals
        .map(
          (r) =>
            `<button type="button" class="chip rentchip${inDeck.has(r.uid) ? ' on' : ''}" data-ref="${esc(r.uid)}">${r.position} ${esc(r.name)} ${r.ovr}・剩 ${r.games} 場</button>`,
        )
        .join('')}</div>`
    : '';
  const sel = slot !== null && s.deck[slot] ? deckCard(s, s.deck[slot]) : null;
  return (
    `<div class="mtbar"><span>牌組評分 <b class="big">${deckRating(s)}</b></span><span>${s.deck.length}/${DECK_MAX} 張</span>` +
    `<button type="button" class="small" data-act="auto">自動組牌</button></div>` +
    cols(
      `<h3 class="mth">先發</h3><div class="mtslots five">${[0, 1, 2, 3, 4].map(cell).join('')}</div>` +
        `<h3 class="mth">板凳</h3><div class="mtslots">${Array.from({ length: DECK_MAX - 5 }, (_, i) => cell(i + 5)).join('')}</div>` +
        (sel ? `<div class="mtbar"><span>已選：${esc(sel.name)}</span><button type="button" class="small" data-act="unslot">移出牌組</button></div>` : '') +
        rentals,
      `<p class="fine left">${slot === null ? '先點一個位置，' : `把卡放進第 ${slot + 1} 格：`}再挑一張卡。同一名球員只能放一張（不同版本也一樣）；租借卡打完場數就會消失。</p>` +
        searchBox() +
        `<div class="chips">${tierChips(filterTier, 'data-ft', true, true)}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
        `<div class="chips">${sourceChips()}</div>` +
        `<div class="mtgrid mtscroll">${
          picks.map((c) => cardHtml(c, { cls: `small pick${names.has(c.name) ? ' dim' : ''}`, ref: refOf(c) })).join('') ||
          '<p class="fine">沒有符合的卡。</p>'
        }</div>`,
    )
  );
}

const ratingRows = (c: OwnedCard) => RATING_KEYS.map((k, i) => `<span>${RATING_LABEL[k]}<b>${c.ratings[i]}</b></span>`).join('');

function sellBox(c: OwnedCard, label: string): string {
  const value = sellValue(c);
  return confirmSell === c.uid
    ? `<div class="confirm">分解${c.plus ? ` +${c.plus} 的` : ''} ${esc(c.name)}，得到 ${value} 金幣？` +
        `<button type="button" class="small danger" data-act="sell">確定分解</button><button type="button" class="small" data-act="nosell">取消</button></div>`
    : `<button type="button" class="small" data-act="asksell" data-uid="${esc(c.uid)}">${label}（+${value} 金幣）</button>`;
}

function detailHtml(c: OwnedCard): string {
  const s = myteam.save;
  const copies = copiesOf(s, c.id);
  const plus = c.plus ?? 0;
  const fodder = mergeFodder(s, c.uid);
  const merge =
    plus >= PLUS_MAX
      ? `<p class="fine left">已強化到最高 +${PLUS_MAX}。</p>`
      : fodder
        ? `<button type="button" class="small go" data-act="merge">強化 +${plus} → +${plus + 1}（吃掉 1 張副本${fodder.plus ? `，它的 +${fodder.plus} 會消失` : ''}）</button>`
        : `<p class="fine left">再抽到同一張卡就能拿來強化：每吃 1 張總評 +1，最多 +${PLUS_MAX}。</p>`;
  const sell = fodder ? sellBox(fodder, '分解一張副本') : sellBox(c, '分解');
  return (
    `<div class="mtdetail">${cardHtml(c, { cls: 'big' })}<div class="mtinfo">` +
    `<h3>${esc(c.name)}</h3><p class="fine left">${tier(c.tier).name}卡 · ${esc(c.label)} · ${c.position} · ${c.heightM.toFixed(2)} m · 持有 ${copies.length}/${COPY_MAX} 張${
      plus ? ` · 已強化 +${plus}` : ''
    }${s.deck.includes(refOf(c)) ? ' · 在牌組中' : ''}</p>` +
    `<div class="mtratings">${ratingRows(c)}</div>${merge}${sell}<button type="button" class="small mtclose" data-act="close">關閉</button></div></div>`
  );
}

/** A card not owned yet: what it is and where it comes from. */
function lockedHtml(def: CardDef): string {
  const c = ownCard(def);
  return (
    `<div class="mtdetail">${cardHtml(c, { cls: 'big locked' })}<div class="mtinfo">` +
    `<h3>${esc(c.name)}</h3><p class="fine left">還沒擁有 · ${tier(c.tier).name}卡 · ${esc(c.label)} · ${c.position} · ${c.heightM.toFixed(2)} m</p>` +
    `<div class="mtratings">${ratingRows(c)}</div><p class="fine left">取得方式：${cardWhere(def).map(esc).join('、') || '目前沒有開放'}</p>` +
    `<button type="button" class="small mtclose" data-act="close">關閉</button></div></div>`
  );
}

function cardsTab(): string {
  const s = myteam.save;
  const showLocked = pref('unowned', '0') === '1';
  const owned = new Set(s.cards.map((c) => c.id));
  const counts = new Map<string, number>();
  for (const c of s.cards) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  // Not-owned cards that still drop (past seasons only once owned).
  const catalog = cardCatalog();
  lockedShown = showLocked ? catalog.filter((d) => !owned.has(d.id) && !d.retired).map((d) => ownCard(d, `def:${d.id}`)) : [];
  const shown = filtered([...bestCopies(s.cards), ...lockedShown]);
  const progress = CARD_SOURCES.map(([k, l]) => {
    const all = catalog.filter((d) => d.source === k && !d.retired).length;
    const have = new Set(s.cards.filter((c) => c.source === k).map((c) => c.id)).size;
    return `<span class="prog">${l} <b>${have}</b>/${all}</span>`;
  }).join('');
  let right = '<p class="fine mtnodetail">點一張卡，這裡會顯示大圖、全部能力值，重複的卡可以強化。</p>';
  if (detail?.startsWith('def:')) {
    const def = catalogCard(detail.slice(4));
    if (def) right = lockedHtml(def);
  } else if (detail) {
    const d = s.cards.find((c) => c.uid === detail);
    if (d) right = detailHtml(d);
  }
  return (
    `<div class="mtbar"><span>收藏 <b>${owned.size}</b> 種・${s.cards.length} 張</span>${progress}<span>已開 ${s.packsOpened} 包</span></div>` +
    cols(
      searchBox() +
        `<div class="chips">${sourceChips()}<button type="button" class="chip toggle${showLocked ? ' on' : ''}" data-act="unowned">${showLocked ? '☑' : '☐'} 顯示未擁有</button></div>` +
        `<div class="chips">${tierChips(filterTier as TierId | 'all', 'data-ft')}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
        `<div class="mtgrid mtscroll">${
          shown
            .map((c) =>
              cardHtml(c, {
                cls: `small pick${c.uid.startsWith('def:') ? ' locked' : ''}${refOf(c) === detail ? ' sel' : ''}`,
                ref: refOf(c),
                count: counts.get(c.id),
              }),
            )
            .join('') || '<p class="fine">沒有符合的卡。</p>'
        }</div>`,
      right,
      true,
    )
  );
}

function oddsBar(p: PackDef): string {
  const odds = packOdds(p);
  if (!odds.length) return '<p class="fine left">這個卡包目前沒有能開出的卡。</p>';
  const segs = odds.map((o) => `<i style="--tier:${tier(o.tier).color};flex:${o.chance}" title="${tier(o.tier).name} ${(o.chance * 100).toFixed(1)}%"></i>`).join('');
  const text = odds.map((o) => `${tier(o.tier).name} ${(o.chance * 100).toFixed(o.chance < 0.1 ? 1 : 0)}%`).join('・');
  return `<div class="oddsbar">${segs}</div><p class="odds">${text}</p>`;
}

function packDesc(p: PackDef): string {
  const bits = [`${p.count} 張`];
  if (p.positions?.length) bits.push(p.positions.join('/'));
  if (p.tiers?.length) bits.push(`${tier(p.tiers[0]).name}～${tier(p.tiers[p.tiers.length - 1]).name}`);
  else bits.push('白～黑');
  if (p.players?.length) bits.push(`${p.players.length} 名指定球員`);
  if (p.guarantee) bits.push(`保底 1 張${tier(p.guarantee).name}卡以上`);
  if (p.kind === 'limited') bits.push(`${themeWhen()}主題：${limitedTheme()?.name ?? '—'}（特殊卡機率較高）`);
  if (p.kind === 'reissue') {
    const season = reissueSeason();
    if (season) bits.push(`${seasonLabel(season)} 球季的現役卡`);
  }
  return bits.join(' · ');
}

/** When the limited pack's theme changes: with a holiday, when it ends; else on Monday. */
function themeWhen(): string {
  const theme = limitedTheme();
  const h = activeHolidays().find((x) => x.theme === theme?.id);
  const on = h ? holidayOn(h) : null;
  return h && on ? `${h.name}（剩 ${daysLeft(on.ends)} 天）` : '本週';
}

function shopTab(): string {
  const theme = limitedTheme();
  const season = reissueSeason();
  // No limited pack now: when the next one comes.
  const next = theme ? null : nextLimited();
  const nextDay = next ? new Date(next.starts) : null;
  return (
    `<div class="mtbar">${theme ? `<span>${themeWhen()}限定：<b style="color:${theme.color}">${esc(theme.name)}</b></span>` : ''}${
      next && nextDay ? `<span>下次限定卡包：<b>${esc(next.holiday.name)}</b> ${nextDay.getMonth() + 1}/${nextDay.getDate()} 開始</span>` : ''
    }${
      season ? `<span>本週復刻：<b>${seasonLabel(season)} 球季</b></span>` : ''
    }<span class="fine">卡包不會開出租借卡。同一張卡最多 ${COPY_MAX} 張，重複的可以在「收藏」強化。</span></div><div class="mtpacks">` +
    OFFICIAL_PACKS.filter((p) => !p.hidden && packPool(p).length > 0)
      .map((p) => {
        const can = wallet.coins >= p.price;
        const t = p.kind === 'limited' ? specialTheme(theme?.id) : undefined;
        return (
          `<div class="mtpack${t ? ' themed' : ''}"${t ? ` style="--tier:${t.color};--accent2:${t.accent}"` : ''}><div class="mtpack-h"><b>${esc(p.name)}</b></div>` +
          `<p class="fine left">${packDesc(p)}</p>${oddsBar(p)}` +
          `<button type="button" class="primary buy" data-buy="${esc(p.id)}"${can ? '' : ' disabled'}>購買　🪙 ${coinsText(p.price)}</button></div>`
        );
      })
      .join('') +
    '</div>'
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

type PlayMode = 'ladder' | 'dynasty' | 'limited' | 'event';
const PLAY_MODES: [PlayMode, string][] = [
  ['ladder', '挑戰之路'],
  ['dynasty', '街頭王朝'],
  ['limited', '特殊關卡'],
  ['event', '活動關卡'],
];

let host: MyTeamHost | null = null;
let ladderPeriod = 0;
/** Deck refs picked for 3v3 games (dynasty, events, practice), by slot ('' = empty). */
let streetPick: string[] = [];
/** The special rule level being set up and the cards picked for it (any owned card), by slot. */
let limitedSel: string | null = null;
let limitedPick: string[] = [];
/** The picker slot waiting for a card (the next card tapped goes there). */
let pickSlot: number | null = null;
const DIFF_LABEL = DIFFICULTY_LABEL;

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

const playMode = (): PlayMode => {
  const m = pref('mode', 'ladder') as PlayMode;
  return PLAY_MODES.some(([k]) => k === m) ? m : 'ladder';
};

function rewardText(r: Reward): string {
  const bits: string[] = [];
  if (r.coins) bits.push(`${r.coins} 金幣`);
  if (r.pack) bits.push(OFFICIAL_PACKS.find((p) => p.id === r.pack)?.name ?? '卡包');
  if (r.rental) bits.push(`${tier(r.rental).name}級租借卡（3 場）`);
  if (r.card) bits.push(`${tier(r.card).name}卡一張`);
  const named = (r.cards ?? []).map((id) => catalogCard(id)).filter((c): c is CardDef => !!c);
  if (named.length === 1) bits.push(`${named[0].label} ${named[0].name}`);
  else if (named.length) bits.push(`${named.every((c) => c.label === named[0].label) ? named[0].label : '指定'}卡隨機一張`);
  return bits.join('＋');
}

function nextPeriodText(s: MyTeamSave): string {
  if (s.period >= PERIODS) return '已開放全部 6 期';
  const need = MISSIONS_PER_PERIOD * s.period - s.claimed.length;
  return `下一期：打完第 ${s.period} 期挑戰之路，或再領 ${need} 個任務獎勵`;
}

const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

/** Slots on screen, left to right: 選1 in the middle, 2 and 3 either side, 4 and 5 outside. */
const SLOT_ORDER: Record<number, number[]> = { 3: [1, 0, 2], 5: [3, 1, 0, 2, 4] };

/** Picked refs by slot ('' empty), `size` long. */
const slots = (list: string[], size: number): string[] => Array.from({ length: size }, (_, i) => list[i] ?? '');
const picked = (list: string[]): string[] => list.filter(Boolean);

/**
 * The card picker: the pool scrolls along the top, the lineup's slots sit
 * under it. Tap a card to fill the next slot (or the lit one); tap a filled
 * slot to take its card back (and light it for the next card).
 */
function lineupPicker(pool: OwnedCard[], list: string[], size: number, key: 'sp' | 'lim'): string {
  const all = allCards();
  const at = slots(list, size);
  const top = pool
    .map((c) => {
      const i = at.indexOf(refOf(c));
      return `<button type="button" class="mtpk${i >= 0 ? ' picked' : ''}" data-pk="${key}:${esc(refOf(c))}">${cardHtml(c, { cls: 'small', note: i >= 0 ? `<b class="new">選 ${i + 1}</b>` : '' })}</button>`;
    })
    .join('');
  const row = (SLOT_ORDER[size] ?? SLOT_ORDER[3])
    .map((i) => {
      const c = at[i] ? all.find((x) => refOf(x) === at[i]) : undefined;
      return `<button type="button" class="mtps${pickSlot === i ? ' on' : ''}${c ? '' : ' empty'}" data-ps="${key}:${i}">${c ? cardHtml(c, { cls: 'small' }) : `<span>選 ${i + 1}</span>`}</button>`;
    })
    .join('');
  return (
    `<div class="mtpicker"><div class="mtpk-row">${top || '<p class="fine">沒有可選的卡。</p>'}</div>` +
    `<p class="fine mtpk-tip">${pickSlot !== null ? `點上面的卡放進「選 ${pickSlot + 1}」` : '左右滑看卡，點卡上場；點下面已選的卡可以換掉'}</p><div class="mtps-row s${size}">${row}</div></div>`
  );
}

/** A card tapped in the picker: into the lit slot (trading places if it was in another), off if picked, else the next empty slot. */
function placeCard(list: string[], size: number, ref: string): string[] {
  const out = slots(list, size);
  const nameOf = (r: string) => allCards().find((c) => refOf(c) === r)?.name;
  const at = out.indexOf(ref);
  // The same player in another version gives way.
  const twin = out.findIndex((r) => r && r !== ref && nameOf(r) === nameOf(ref));
  if (pickSlot !== null) {
    const target = pickSlot;
    pickSlot = null;
    if (twin >= 0 && twin !== target) out[twin] = '';
    if (at >= 0) out[at] = out[target];
    out[target] = ref;
    return out;
  }
  if (at >= 0) {
    out[at] = '';
    return out;
  }
  if (twin >= 0) {
    out[twin] = ref;
    return out;
  }
  const free = out.indexOf('');
  if (free >= 0) out[free] = ref;
  return out;
}

/** A slot tapped: a filled one gives its card back and waits for the next; an empty one lights (or unlights). */
function tapSlot(list: string[], size: number, i: number): string[] {
  const out = slots(list, size);
  if (out[i]) {
    out[i] = '';
    pickSlot = i;
  } else pickSlot = pickSlot === i ? null : i;
  return out;
}

function periodChips(done: (p: number) => boolean): string {
  const s = myteam.save;
  return Array.from({ length: PERIODS }, (_, i) => i + 1)
    .map((p) => {
      const open = p <= s.period;
      return `<button type="button" class="chip${p === ladderPeriod ? ' on' : ''}" data-lp="${p}"${open ? '' : ' disabled'}>第 ${p} 期${done(p) ? ' ✓' : open ? '' : ' 🔒'}</button>`;
    })
    .join('');
}

/** A level row: badge, title, a line of facts, and its button (or a lock). */
function levelRow(o: { cls?: string; badge: string; title: string; line: string; btn: string }): string {
  return `<div class="mtlevel${o.cls ?? ''}">${o.badge}<div class="lvinfo"><b>${o.title}</b><span>${o.line}</span></div>${o.btn}</div>`;
}

const sizeBadge = (size: 3 | 5) => `<span class="lvbadge s${size}">${size}v${size}</span>`;

/** The deck's cards in deck order (starters first). */
const deckCards = (): OwnedCard[] =>
  myteam.save.deck.map((r) => deckCard(myteam.save, r)).filter((c): c is OwnedCard => !!c);

/** The 3v3 lineup picker (from the 13-card deck) used by dynasty, event and practice games. */
function streetPicker(): string {
  const deck = deckCards();
  // First visit: the first three starters (emptied slots stay empty after that).
  if (!streetPick.length) streetPick = deck.slice(0, 3).map(refOf);
  return `<h3 class="mth">街頭陣容<small>${picked(streetPick).length}/3・從牌組挑</small></h3>` + lineupPicker(deck, streetPick, 3, 'sp');
}

function settingsBox(street: boolean, full: boolean): string {
  const quarter = pref('quarter', '180');
  const target = pref('target', '21');
  return (
    `<h3 class="mth">比賽設定</h3><div class="row">` +
    (full
      ? `<label>5 對 5 每節長度<select id="mtQuarter">${opt('60', '1 分鐘', quarter)}${opt('120', '2 分鐘', quarter)}${opt('180', '3 分鐘', quarter)}${opt(
          '300',
          '5 分鐘',
          quarter,
        )}${opt('720', '12 分鐘', quarter)}</select></label>`
      : '') +
    (street ? `<label>3 對 3 搶分<select id="mtTarget">${opt('11', '11 分', target)}${opt('21', '21 分', target)}</select></label>` : '') +
    `</div>`
  );
}

function ladderHtml(full: boolean): string {
  const s = myteam.save;
  const levels = periodLevels(ladderPeriod)
    .map((l, i) => {
      const team = findTeam(l.team);
      const done = s.cleared.includes(l.id);
      const open = levelOpen(s, l);
      return levelRow({
        cls: `${done ? ' done' : ''}${l.boss ? ' boss' : ''}`,
        badge: logoHtml(team, 'lvlogo'),
        title: `${l.boss ? '魔王關' : `第 ${i + 1} 關`}・${esc(team.name)}`,
        line: `對手評分 ${l.ovr}・${DIFF_LABEL[l.difficulty]}・${done ? `已過關（再贏 ${GAME_COINS.ladderReplay} 金幣）` : `首勝：${rewardText(l.reward)}`}`,
        btn: open ? `<button type="button" class="small${done ? '' : ' go'}" data-level="${l.id}"${full ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>` : '<span class="lock">🔒</span>',
      });
    })
    .join('');
  return cols(
    `<div class="chips">${periodChips((p) => periodCleared(s, p))}</div><div class="mtlevels">${levels}</div>`,
    `<p class="fine left">挑戰之路：真實 NBA 球隊，能力調到關卡評分。打完一期全部關卡就開放下一期。用你的牌組 5 對 5，難度由關卡決定。</p>` +
      settingsBox(false, true) +
      '<p class="fine left">比賽中離開算輸、沒有金幣，租借卡有上場就扣一場。</p>',
  );
}

function dynastyHtml(): string {
  const s = myteam.save;
  const ready = picked(streetPick).length === 3;
  const levels = dynastyLevels(ladderPeriod)
    .map((d, i) => {
      const done = s.cleared.includes(d.id);
      const open = dynastyOpen(s, d);
      const crew = dynastyCrew(d)
        .map((p) => esc(p.name))
        .join('、');
      return levelRow({
        cls: `${done ? ' done' : ''}${d.boss ? ' boss' : ''}`,
        badge: sizeBadge(3),
        title: `${d.boss ? '王者關' : `第 ${i + 1} 關`}・${esc(d.name)}`,
        line: `${crew}・評分 ${d.ovr}・${DIFF_LABEL[d.difficulty]}・${done ? `已過關（再贏 ${GAME_COINS.ladderReplay} 金幣）` : `首勝：${rewardText(d.reward)}`}`,
        btn: open ? `<button type="button" class="small${done ? '' : ' go'}" data-dynasty="${d.id}"${ready ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>` : '<span class="lock">🔒</span>',
      });
    })
    .join('');
  return cols(
    `<div class="chips">${periodChips((p) => dynastyCleared(s, p))}</div><div class="mtlevels">${levels}</div>`,
    `<p class="fine left">街頭王朝：一路打倒各地的街頭三人組，每期 5 關，依序解鎖；期數跟著挑戰之路開放。</p>` +
      streetPicker() +
      settingsBox(true, false) +
      (ready ? '' : '<p class="fine left">先挑好 3 名街頭陣容才能開打。</p>'),
    true,
  );
}

/** Cards a limited level can use: every owned card and rental, best first. */
const limitedCards = (): OwnedCard[] => bestCopies(allCards()).sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));

function limitedLineup(l: LimitedDef): { cards: OwnedCard[]; problem: string | null } {
  const all = limitedCards();
  const cards = picked(limitedPick)
    .map((r) => all.find((c) => refOf(c) === r))
    .filter((c): c is OwnedCard => !!c);
  return { cards, problem: lineupProblem(l.rule, cards, l.size) };
}

/** A rule level's first lineup: the best cards that fit, one player each (the current / history cards it asks for first). */
function autoLimited(l: LimitedDef): string[] {
  const out: OwnedCard[] = [];
  const take = (n: number, want: (c: OwnedCard) => boolean) => {
    for (const c of limitedCards()) {
      if (out.length >= l.size || n <= 0) break;
      if (want(c) && !out.includes(c) && !out.some((x) => x.name === c.name) && cardAllowed(l.rule, c, out)) {
        out.push(c);
        n--;
      }
    }
  };
  take(l.rule.minCurrent ?? 0, (c) => c.source === 'current');
  take(l.rule.minHistory ?? 0, isHistory);
  take(l.size, () => true);
  return out.map(refOf);
}

const specialGroup = (): SpecialGroup => {
  const g = pref('sgroup', 'c1') as SpecialGroup;
  return SPECIAL_GROUPS.some(([k]) => k === g) ? g : 'c1';
};

/** 特殊關卡: the group chips, then its levels. */
function specialHtml(full: boolean): string {
  const s = myteam.save;
  const group = specialGroup();
  const legacy = legacyLevels();
  const count = (g: SpecialGroup): [number, number] => {
    const ids = g === 'c1' || g === 'c2' ? LIMITED.filter((l) => limitedGroup(l) === g).map((l) => l.id) : legacy.filter((l) => l.group === g).map((l) => l.id);
    return [ids.filter((id) => s.cleared.includes(id)).length, ids.length];
  };
  const chips = SPECIAL_GROUPS.map(([k, label]) => {
    const [done, all] = count(k);
    return `<button type="button" class="chip${k === group ? ' on' : ''}" data-sg="${k}">${label} ${done}/${all}</button>`;
  }).join('');
  return group === 'c1' || group === 'c2' ? limitedHtml(group, chips) : legacyHtml(group, chips, full);
}

const LEGACY_TEXT: Record<string, string> = {
  champions: '2000 年以來每一年的總冠軍隊：當年的先發五人、第六人，再加兩名替補（評分取六人平均）。',
  hof: '名人堂球星分隊組成的傳奇隊，每隊五人，再加三名其他名人堂球員當替補。',
  olympic: '奧運拿金牌的美國隊，真實 12 人名單；每人用他最高的那張卡的評分。',
};

/** History teams (歷年總冠軍 / 名人堂 / 奧運美國隊): played with your deck, any order. */
function legacyHtml(group: SpecialGroup, chips: string, full: boolean): string {
  const s = myteam.save;
  const rows = legacyLevels()
    .filter((l) => l.group === group)
    .map((l) => {
      const done = s.cleared.includes(l.id);
      const t = legacyTeam(l);
      return levelRow({
        cls: done ? ' done' : '',
        badge: l.team ? logoHtml(findTeam(l.team), 'lvlogo') : sizeBadge(5),
        title: esc(l.name),
        line: `${t.players
          .slice(0, 5)
          .map((p) => esc(p.name))
          .join('、')}・評分 ${teamRating(t)}・${DIFF_LABEL[l.difficulty]}・${done ? `已過關（再贏 ${GAME_COINS.ladderReplay} 金幣）` : `首勝：${rewardText(l.reward)}`}`,
        btn: `<button type="button" class="small${done ? '' : ' go'}" data-legacy="${l.id}"${full ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>`,
      });
    })
    .join('');
  return cols(
    `<div class="chips">${chips}</div><div class="mtlevels mtscroll">${rows}</div>`,
    `<p class="fine left">${LEGACY_TEXT[group] ?? ''}用你的牌組 5 對 5，每關都可以任意挑戰，首勝拿獎勵。</p>` +
      settingsBox(false, true) +
      '<p class="fine left">比賽中離開算輸、沒有金幣，租借卡有上場就扣一場。</p>',
  );
}

/** The rule levels (挑戰（一）/（二）): pick one, then a lineup that fits. */
function limitedHtml(group: 'c1' | 'c2', chips: string): string {
  const s = myteam.save;
  const sel = LIMITED.find((l) => l.id === limitedSel && limitedGroup(l) === group) ?? null;
  const rows = LIMITED.filter((l) => limitedGroup(l) === group).map((l, i) => {
    const done = s.cleared.includes(l.id);
    return levelRow({
      cls: `${done ? ' done' : ''}${l.id === limitedSel ? ' sel' : ''}`,
      badge: sizeBadge(l.size),
      title: `${i + 1}. ${esc(l.name)}`,
      line: `${ruleText(l.rule).join('・')}・對手 ${l.ovr}${l.team ? `（${esc(findTeam(l.team).name)}）` : ''}・${DIFF_LABEL[l.difficulty]}・${
        done ? `已完成（再贏 ${GAME_COINS.ladderReplay} 金幣）` : rewardText(l.reward)
      }`,
      btn: `<button type="button" class="small${l.id === limitedSel ? ' go' : ''}" data-limsel="${l.id}">${l.id === limitedSel ? '設定中' : '選擇'}</button>`,
    });
  }).join('');
  let right = '<p class="fine mtnodetail">選一個關卡，這裡挑符合條件的陣容。</p>';
  if (sel) {
    const { cards, problem } = limitedLineup(sel);
    // The 13 best cards that fit next to the others picked (and match the search).
    const fits = limitedCards().filter((c) => {
      const others = cards.filter((x) => refOf(x) !== refOf(c));
      return picked(limitedPick).includes(refOf(c)) || (cardAllowed(sel.rule, c, others) && matches(c));
    });
    const pool = fits.filter(matches).slice(0, DECK_MAX);
    const avgH = cards.length ? Math.round((cards.reduce((t, c) => t + c.heightM, 0) / cards.length) * 100) : 0;
    right =
      `<h3 class="mth">${esc(sel.name)}<small>${sel.size} 對 ${sel.size}</small></h3><ul class="mtrules">${ruleText(sel.rule)
        .map((r) => `<li>${esc(r)}</li>`)
        .join('')}</ul>` +
      `<p class="fine left">已選 ${cards.length}/${sel.size}${cards.length ? `・平均身高 ${avgH} 公分` : ''}${
        sel.size === 5 ? '・板凳自動用其他符合條件的卡' : ''
      }・上排是符合條件的前 ${DECK_MAX} 張，可以搜尋</p>` +
      searchBox() +
      lineupPicker(pool, limitedPick, sel.size, 'lim') +
      `<div class="mtplay"><span class="fine left">${problem && cards.length === sel.size ? esc(problem) : fits.length ? '' : '收藏裡沒有符合條件的卡。'}</span>` +
      `<button type="button" class="small go" data-act="limitedgame"${problem ? ' disabled' : ''}>開始</button></div>` +
      settingsBox(sel.size === 3, sel.size === 5);
  }
  return cols(`<div class="chips">${chips}</div><div class="mtlevels mtscroll">${rows}</div>`, right, true);
}

/** The event shown: a running holiday (by id) or the weekly one. */
function eventSub(): HolidayDef | null {
  const on = activeHolidays();
  const want = pref('evsub', '');
  if (want === 'weekly') return null;
  return on.find((h) => h.id === want) ?? on[0] ?? null;
}

function eventChips(sub: HolidayDef | null): string {
  const week = eventWeek();
  const weekly = `<button type="button" class="chip${sub ? '' : ' on'}" data-evsub="weekly">${esc(eventTheme(week).name)}（剩 ${daysLeft(eventEnds(week))} 天）</button>`;
  return (
    activeHolidays()
      .map((h) => `<button type="button" class="chip holiday${sub?.id === h.id ? ' on' : ''}" data-evsub="${h.id}">${esc(h.name)}（剩 ${daysLeft(holidayOn(h)!.ends)} 天）</button>`)
      .join('') + weekly
  );
}

/** A holiday's five levels, in order, each paying once this year. */
function holidayHtml(h: HolidayDef, full: boolean): string {
  const s = myteam.save;
  const on = holidayOn(h);
  if (!on) return '';
  const base = eventBase(s);
  const ready = picked(streetPick).length === 3;
  const rows = h.levels
    .map((lv, i) => {
      const t = eventTeam(h, i, base);
      const done = s.holidays.includes(holidayKey(h.id, on.year, i));
      const open = holidayOpen(s, h, on.year, i);
      const can = lv.size === 3 ? ready : full;
      return levelRow({
        cls: `${done ? ' done' : ''}${i === h.levels.length - 1 ? ' boss' : ''}`,
        badge: sizeBadge(lv.size),
        title: `${i === h.levels.length - 1 ? '最終關' : `第 ${i + 1} 關`}・${t.players
          .slice(0, lv.size)
          .map((p) => esc(p.name))
          .join('、')}`,
        line: `評分 ${Math.min(99, base + lv.offset)}・${DIFF_LABEL[lv.difficulty]}・${done ? `今年已完成（再贏 ${GAME_COINS.ladderReplay} 金幣）` : `首勝：${rewardText(lv.reward)}`}`,
        btn: open
          ? `<button type="button" class="small${done ? '' : ' go'}" data-holiday="${h.id}:${i}"${can ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>`
          : '<span class="lock">🔒</span>',
      });
    })
    .join('');
  return cols(
    `<div class="chips">${eventChips(h)}</div><div class="mtevent holiday"><b>${esc(h.name)}</b><span>${esc(h.desc)}・還有 ${daysLeft(on.ends)} 天結束</span></div><div class="mtlevels">${rows}</div>`,
    `<p class="fine left">節日活動每年同一段時間開放，5 關依序挑戰，每關每年領一次獎勵。評分跟著你目前的期數（第 ${s.period} 期）。${
      h.theme ? '活動期間限定卡包賣這個主題的特殊卡。' : ''
    }</p>` +
      streetPicker() +
      settingsBox(true, true),
    true,
  );
}

function eventHtml(full: boolean): string {
  const sub = eventSub();
  if (sub) return holidayHtml(sub, full);
  const s = myteam.save;
  const week = eventWeek();
  const theme = eventTheme(week);
  const base = eventBase(s);
  const days = daysLeft(eventEnds(week));
  const ready = picked(streetPick).length === 3;
  const rows = theme.levels
    .map((lv, i) => {
      const t = eventTeam(theme, i, base);
      const done = s.events.includes(eventKey(week, i));
      const can = lv.size === 3 ? ready : full;
      return levelRow({
        cls: done ? ' done' : '',
        badge: sizeBadge(lv.size),
        title: `活動 ${i + 1}・${t.players
          .slice(0, lv.size)
          .map((p) => esc(p.name))
          .join('、')}`,
        line: `評分 ${Math.min(99, base + lv.offset)}・${DIFF_LABEL[lv.difficulty]}・${done ? `本週已完成（再贏 ${GAME_COINS.ladderReplay} 金幣）` : `本週首勝：${rewardText(lv.reward)}`}`,
        btn: `<button type="button" class="small${done ? '' : ' go'}" data-event="${i}"${can ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>`,
      });
    })
    .join('');
  return cols(
    `<div class="chips">${eventChips(null)}</div><div class="mtevent"><b>${esc(theme.name)}</b><span>${esc(theme.desc)}・還有 ${days} 天換下一個活動</span></div><div class="mtlevels">${rows}</div>`,
    `<p class="fine left">活動關卡每週一換主題，每關每週可以領一次獎勵。評分跟著你目前的期數（第 ${s.period} 期）。</p>` +
      streetPicker() +
      settingsBox(true, true),
    true,
  );
}

function playTab(): string {
  const s = myteam.save;
  if (!ladderPeriod || ladderPeriod > s.period) ladderPeriod = s.period;
  const full = deckLineup(s).length >= 5;
  const mode = playMode();
  const body = mode === 'dynasty' ? dynastyHtml() : mode === 'limited' ? specialHtml(full) : mode === 'event' ? eventHtml(full) : ladderHtml(full);
  return (
    `<div class="mtbar"><span>第 <b>${s.period}</b> 期</span><span>牌組評分 <b>${deckRating(s)}</b></span><span title="同一組先發連續比賽會越來越高">凝聚力 <b>${deckCohesion(s)}</b></span>${firstWinChip()}<span>${nextPeriodText(s)}</span></div>` +
    `<nav class="tabs mtmodes">${PLAY_MODES.map(([k, l]) => `<button type="button" data-mode="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</nav>` +
    (full ? '' : '<p class="msg">牌組至少要 5 張卡才能打 5 對 5，先到「牌組」分頁放卡。</p>') +
    body
  );
}

/** 隨機比賽（練習）: random opponents, no rentals used, coins by game time. */
function practiceTab(): string {
  const s = myteam.save;
  const size = pref('psize', '5');
  const full = deckLineup(s).length >= 5;
  const diff = pref('diff', 'normal');
  const quarter = Number(pref('quarter', '180'));
  const left =
    `<nav class="tabs mtsize">${[
      ['5', '5 對 5'],
      ['3', '3 對 3'],
    ]
      .map(([k, l]) => `<button type="button" data-psize="${k}" class="${k === size ? 'on' : ''}">${l}</button>`)
      .join('')}</nav>` +
    (size === '5'
      ? `<div class="mtplay"><span class="fine left">用你的牌組，對上和牌組同等級的隨機 NBA 球隊。這場約 ${(quarter * 4) / 60} 分鐘：輸 ${practiceCoins(
          (quarter * 4) / 60,
          false,
          diff as Difficulty,
        )}、贏 ${practiceCoins((quarter * 4) / 60, true, diff as Difficulty)} 金幣。</span>` +
        `<button type="button" class="small go" data-act="practice5"${full ? '' : ' disabled'}>開始</button></div>`
      : streetPicker() +
        `<div class="mtplay"><span class="fine left">對上 3 名同等級的隨機球員，金幣依實際比賽分鐘數。</span>` +
        `<button type="button" class="small go" data-act="practice3"${picked(streetPick).length === 3 ? '' : ' disabled'}>開始</button></div>`);
  const right =
    `<h3 class="mth">難度</h3><div class="row"><label>電腦難度<select id="mtDiff">${DIFFICULTIES.map((d) => opt(d, `${DIFF_LABEL[d]}（金幣 ×${DIFFICULTY_COINS[d]}）`, diff)).join(
      '',
    )}</select></label></div>` +
    settingsBox(size === '3', size === '5') +
    `<p class="fine left">隨機比賽是練習：不扣租借卡、不算任務。金幣依比賽時間給，每 3 分鐘 ${PRACTICE_COINS.per3} 金幣，贏球 ×${PRACTICE_COINS.win}，再乘難度倍率；中途離開沒有金幣。</p>`;
  return `<div class="mtbar"><span>牌組評分 <b>${deckRating(s)}</b></span><span>隨機比賽（練習）</span>${firstWinChip()}</div>` + cols(left, right);
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
    `<div class="mtbar"><span>已領 <b>${s.claimed.length}</b> / ${MISSIONS.length}</span><span>${nextPeriodText(s)}</span></div><div class="mtmissions">${rows}</div>`
  );
}

/** Whether today's first-win bonus is still there. */
function firstWinChip(): string {
  const taken = myteam.save.firstWin === localDay();
  return `<span class="fwin${taken ? ' taken' : ''}" title="每天第一場 MyTeam 勝利（隨機比賽也算）多給 ${FIRST_WIN_COINS} 金幣，午夜重置">今日首勝 +${FIRST_WIN_COINS}：<b>${
    taken ? '已領' : '可領'
  }</b></span>`;
}

function missionsReady(): number {
  const s = myteam.save;
  return MISSIONS.filter((m) => !s.claimed.includes(m.id) && missionDone(s, m)).length;
}

/** Results to show when back from a game (rewards that came as cards). */
let pending: { title: string; drops: DropResult[] } | null = null;

function finishText(out: GameOutcome, won: boolean, forfeit: boolean): string {
  const bits = [forfeit ? '中途離開，算輸' : won ? '勝利' : '落敗'];
  if (out.coins) bits.push(`+${out.coins} 金幣${out.firstWin ? `（含今日首勝 ${out.firstWin}）` : ''}`);
  if (out.firstClear) bits.push('首次過關');
  if (out.drops.length) bits.push(`獲得 ${out.drops.length} 張卡`);
  if (out.gone.length) bits.push(`租借到期：${out.gone.join('、')}`);
  if (out.unlocked) bits.push(`第 ${out.unlocked} 期開放！`);
  return bits.join('・');
}

interface GamePlan {
  /** Null for a practice game: nothing booked but coins. */
  kind: GameKind | null;
  /** Played with the deck's lineup (its cohesion counts, and grows). */
  deck?: boolean;
  size: 3 | 5;
  /** Your players in roster order (5v5: starters first). */
  cards: OwnedCard[];
  opponent: TeamInfo;
  difficulty: Difficulty;
  level?: string;
  event?: { week: number; index: number };
  holiday?: { id: string; year: number; index: number };
}

const streetCards = (): OwnedCard[] =>
  picked(streetPick)
    .map((r) => deckCard(myteam.save, r))
    .filter((c): c is OwnedCard => !!c)
    .sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));

const avgOvr = (cards: OwnedCard[]) => Math.round(cards.reduce((t, c) => t + c.ovr, 0) / Math.max(1, cards.length));

function startGame(plan: GamePlan): void {
  if (!host) return;
  const s = myteam.save;
  if (plan.cards.length < plan.size) return;
  const used = plan.cards.map(refOf);
  const settings: Partial<GameSettings> = {
    mode: 'game',
    humanTeams: [0],
    difficulty: plan.difficulty,
    quarterSeconds: Number(pref('quarter', '180')),
    seed: (Math.random() * 2 ** 31) | 0,
    cohesion: [plan.deck ? deckCohesion(s) : 60, 70],
  };
  if (plan.size === 3) settings.street = { target: Number(pref('target', '21')), makeItTakeIt: false };
  const teams: [TeamInfo, TeamInfo] = [{ ...MYTEAM_INFO, players: plan.cards.map(cardPlayer) }, plan.opponent];
  host.play(
    teams,
    settings,
    (state, forfeit) => {
      const [a, b] = state.score;
      if (plan.deck && !forfeit) {
        noteDeckGame(s);
        myteam.commit();
      }
      if (!plan.kind) {
        // Practice: game time (a street game's real clock) pays, nothing else counts.
        const minutes = plan.size === 3 ? state.tick / 30 / 60 : (state.settings.quarterSeconds * 4) / 60;
        const coins = forfeit ? 0 : practiceCoins(minutes, a > b, plan.difficulty);
        const bonus = forfeit ? 0 : firstWinBonus(s, a > b);
        if (bonus) myteam.commit();
        if (coins + bonus) void wallet.add(coins + bonus);
        message = `隨機比賽：${forfeit ? '中途離開，沒有金幣' : `${a > b ? '勝利' : '落敗'}・+${coins + bonus} 金幣${bonus ? `（含今日首勝 ${bonus}）` : ''}`}`;
        return message;
      }
      const rows = teamRows(state, 0);
      const sum = (f: (st: PlayerStats) => number) => rows.reduce((t, r) => t + f(r.stats), 0);
      // A full game's rentals count only if they got on the floor.
      const played = plan.size === 3 ? used : used.filter((_, i) => (rows.find((r) => r.rosterIdx === i)?.stats.secs ?? 0) > 0);
      const out = recordGame(s, {
        kind: plan.kind,
        won: a > b,
        margin: a - b,
        level: plan.level,
        event: plan.event,
        holiday: plan.holiday,
        street: plan.size === 3,
        used: played,
        forfeit,
        difficulty: plan.difficulty,
        totals: {
          points: sum((x) => x.pts),
          threes: sum((x) => x.tpm),
          assists: sum((x) => x.ast),
          blocks: sum((x) => x.blk),
          steals: sum((x) => x.stl),
        },
      });
      streetPick = streetPick.map((r) => (r && deckCard(s, r) ? r : ''));
      limitedPick = limitedPick.map((r) => (r && allCards().some((c) => refOf(c) === r) ? r : ''));
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

/** A street trio for a quick 3v3 at your level. */
const streetTeam = (cards: OwnedCard[]): TeamInfo => ({
  abbr: '對手',
  name: '街頭對手',
  primary: '#2a5db0',
  secondary: '#ffffff',
  players: streetOpponents(3, avgOvr(cards), cards.map((c) => c.name)),
});

function playLevel(kind: 'ladder' | 'dynasty' | 'limited' | 'legacy' | 'event' | 'holiday', id: string): void {
  const s = myteam.save;
  if (kind === 'ladder') {
    const level = LEVELS.find((l) => l.id === id);
    if (level && levelOpen(s, level)) startGame({ kind, size: 5, cards: deckLineup(s), opponent: levelTeam(level), difficulty: level.difficulty, level: id, deck: true });
  } else if (kind === 'dynasty') {
    const d = DYNASTY.find((x) => x.id === id);
    if (d && dynastyOpen(s, d)) {
      const crew: TeamInfo = { abbr: '王朝', name: d.name, primary: '#b0302a', secondary: '#ffffff', players: dynastyCrew(d) };
      startGame({ kind, size: 3, cards: streetCards(), opponent: crew, difficulty: d.difficulty, level: id });
    }
  } else if (kind === 'limited') {
    const l = LIMITED.find((x) => x.id === id);
    if (!l) return;
    const { cards, problem } = limitedLineup(l);
    if (problem) return;
    const starters = [...cards].sort((a, b) => POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
    let lineup = starters;
    if (l.size === 5) {
      // The bench: the best other cards that fit too.
      const bench: OwnedCard[] = [];
      for (const c of limitedCards()) {
        if (bench.length >= DECK_MAX - 5) break;
        const all = [...starters, ...bench];
        if (!all.some((x) => x.name === c.name) && cardAllowed(l.rule, c, all)) bench.push(c);
      }
      lineup = [...starters, ...bench];
    }
    startGame({ kind, size: l.size, cards: lineup, opponent: limitedTeam(l), difficulty: l.difficulty, level: id });
  } else if (kind === 'legacy') {
    const l: LegacyDef | undefined = legacyLevels().find((x) => x.id === id);
    if (l) startGame({ kind: 'limited', size: 5, cards: deckLineup(s), opponent: legacyTeam(l), difficulty: l.difficulty, level: id, deck: true });
  } else if (kind === 'holiday') {
    const [hid, at] = id.split(':');
    const h = HOLIDAYS.find((x) => x.id === hid);
    const on = h ? holidayOn(h) : null;
    const index = Number(at);
    const lv = h?.levels[index];
    if (!h || !on || !lv || !holidayOpen(s, h, on.year, index)) return;
    const cards = lv.size === 3 ? streetCards() : deckLineup(s);
    startGame({
      kind: 'event',
      size: lv.size,
      cards,
      opponent: eventTeam(h, index, eventBase(s)),
      difficulty: lv.difficulty,
      holiday: { id: h.id, year: on.year, index },
      deck: lv.size === 5,
    });
  } else {
    const week = eventWeek();
    const index = Number(id);
    const theme = eventTheme(week);
    const lv = theme.levels[index];
    if (!lv) return;
    const cards = lv.size === 3 ? streetCards() : deckLineup(s);
    startGame({ kind, size: lv.size, cards, opponent: eventTeam(theme, index, eventBase(s)), difficulty: lv.difficulty, event: { week, index }, deck: lv.size === 5 });
  }
}

// ----------------------------------------------------------------- render

export function renderMyTeam(): void {
  const root = $('#mtBody');
  if (!myteam.ready) {
    root.innerHTML = '<p class="fine">讀取收藏中…</p>';
    return;
  }
  const s = myteam.save;
  if (s.refund) {
    // The card update paid back retired boosted cards: once, into the wallet.
    const coins = s.refund;
    s.refund = 0;
    myteam.commit();
    void wallet.add(coins);
    message = `卡片改版：各期強化卡已停止發行，你的強化卡換成了 ${coins} 金幣。現役卡改成依球季發行，另有冠軍、獎項、名人堂和特殊卡。`;
  }
  $('#mtCoins').textContent = `🪙 ${coinsText(wallet.coins)}`;
  const ready = missionsReady();
  $('#mtTabs').innerHTML = TABS.map(
    ([id, label]) =>
      `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}${id === 'missions' && ready ? ` <i class="dot">${ready}</i>` : ''}</button>`,
  ).join('');
  streetPick = streetPick.map((r) => (r && s.deck.includes(r) ? r : ''));
  // The picker's card row stays where it was dragged to.
  const rowLeft = root.querySelector<HTMLElement>('.mtpk-row')?.scrollLeft ?? 0;
  root.innerHTML =
    (message ? `<p class="msg">${esc(message)}</p>` : '') +
    (tab === 'play'
      ? playTab()
      : tab === 'missions'
        ? missionsTab()
        : tab === 'deck'
          ? deckTab()
          : tab === 'cards'
            ? cardsTab()
            : tab === 'practice'
              ? practiceTab()
              : shopTab());
  hydrateCards(root, [...allCards(), ...(tab === 'cards' ? lockedShown : [])]);
  const row = root.querySelector<HTMLElement>('.mtpk-row');
  if (row) row.scrollLeft = rowLeft;
  if (searching) {
    // Typing in the search box: keep the cursor there across the redraw.
    const box = root.querySelector<HTMLInputElement>('#mtSearch');
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }
}

/** The search box is being typed in (its redraw keeps the focus). */
let searching = false;
let searchTimer = 0;

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
  const drops = openPack(pack);
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
      const note = isRental(r.card) ? '' : r.isNew ? '<b class="new">NEW</b>' : r.full ? `已滿 ${COPY_MAX} 張・+${r.coins} 金幣` : '重複・可強化';
      return (
        `<button type="button" class="flip t-${r.card.tier}${shiny(r.card) ? ' shiny' : ''}" data-i="${i}" style="--tier:${tier(r.card.tier).color};--delay:${i * 0.08}s">` +
        `<span class="back"><b>WebNBA</b><i>MyTeam</i></span><span class="front">${cardHtml(r.card, { note })}</span><span class="burst"></span></button>`
      );
    })
    .join('');
  hydrateCards($('#poCards'), results.map((r) => r.card));
  const coins = results.reduce((s, r) => s + r.coins, 0);
  $('#poSummary').textContent = '';
  const rentals = results.filter((r) => isRental(r.card)).length;
  const dups = results.filter((r) => !r.isNew && !r.full && !isRental(r.card)).length;
  $('#poSummary').dataset.text = `新卡 ${results.filter((r) => r.isNew && !isRental(r.card)).length} 張${dups ? `・重複 ${dups} 張（可到收藏強化）` : ''}${
    rentals ? `・租借 ${rentals} 張` : ''
  }${coins ? `・超過 ${COPY_MAX} 張換得 ${coins} 金幣` : ''}`;
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
    // The rental filter is the deck's alone.
    if (filterTier === 'rental') filterTier = 'all';
    pickSlot = null;
    message = '';
    detail = null;
    confirmSell = null;
    renderMyTeam();
  });
  $('#mtBody').addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const s = myteam.save;
    const data = (attr: string) => el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    const act = data('data-act');
    const ft = data('data-ft');
    const fp = data('data-fp');
    const fs = data('data-fs');
    if (ft) filterTier = ft as TierId | 'all' | 'rental';
    else if (fp) filterPos = fp as Position | 'all';
    else if (fs) filterSource = fs as CardSource | 'all';
    else if (act === 'unowned') setPref('unowned', pref('unowned', '0') === '1' ? '0' : '1');
    else if (act === 'merge' && detail) {
      if (mergeCard(s, detail)) {
        const c = s.cards.find((x) => x.uid === detail);
        message = c ? `強化完成：${c.name} +${c.plus}（總評 ${c.ovr}）` : '';
        confirmSell = null;
        myteam.commit();
      }
    }
    else if (data('data-slot') !== null) {
      const i = Number(data('data-slot'));
      slot = slot === i ? null : i;
    } else if (data('data-lp')) ladderPeriod = Number(data('data-lp'));
    else if (data('data-mode')) {
      setPref('mode', data('data-mode')!);
      message = '';
      pickSlot = null;
    } else if (data('data-sg')) {
      setPref('sgroup', data('data-sg')!);
      pickSlot = null;
    } else if (data('data-evsub')) {
      setPref('evsub', data('data-evsub')!);
      pickSlot = null;
    } else if (data('data-legacy')) {
      playLevel('legacy', data('data-legacy')!);
      return;
    } else if (data('data-holiday')) {
      playLevel('holiday', data('data-holiday')!);
      return;
    } else if (data('data-pk')) {
      const [key, ref] = data('data-pk')!.split(/:(.*)/s);
      if (key === 'sp') streetPick = placeCard(streetPick, 3, ref);
      else limitedPick = placeCard(limitedPick, LIMITED.find((l) => l.id === limitedSel)?.size ?? 5, ref);
    } else if (data('data-ps')) {
      const [key, at] = data('data-ps')!.split(':');
      if (key === 'sp') streetPick = tapSlot(streetPick, 3, Number(at));
      else limitedPick = tapSlot(limitedPick, LIMITED.find((l) => l.id === limitedSel)?.size ?? 5, Number(at));
    } else if (data('data-psize')) {
      setPref('psize', data('data-psize')!);
      pickSlot = null;
    }
    else if (data('data-level')) {
      playLevel('ladder', data('data-level')!);
      return;
    } else if (data('data-dynasty')) {
      playLevel('dynasty', data('data-dynasty')!);
      return;
    } else if (data('data-event') !== null) {
      playLevel('event', data('data-event')!);
      return;
    } else if (data('data-limsel')) {
      const id = data('data-limsel')!;
      const l = LIMITED.find((x) => x.id === id);
      if (limitedSel !== id && l) limitedPick = autoLimited(l);
      limitedSel = id;
      pickSlot = null;
      if (window.innerWidth < 1100) $('#myteam').scrollTo({ top: 0, behavior: 'smooth' });
    } else if (act === 'limitedgame' && limitedSel) {
      playLevel('limited', limitedSel);
      return;
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
    } else if (act === 'practice5') {
      startGame({ kind: null, size: 5, cards: deckLineup(s), opponent: quickOpponent(s), difficulty: pref('diff', 'normal') as Difficulty, deck: true });
      return;
    } else if (act === 'practice3') {
      const cards = streetCards();
      startGame({ kind: null, size: 3, cards, opponent: streetTeam(cards), difficulty: pref('diff', 'normal') as Difficulty });
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
        confirmSell = null;
        // Stacked (narrow) layout: the detail sits above the grid.
        if (window.innerWidth < 1100) $('#myteam').scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (act === 'auto') {
      s.deck = autoDeck(s);
      slot = null;
      myteam.commit();
    } else if (act === 'unslot' && slot !== null) {
      s.deck.splice(slot, 1);
      slot = null;
      myteam.commit();
    } else if (act === 'asksell') confirmSell = data('data-uid');
    else if (act === 'nosell') confirmSell = null;
    else if (act === 'sell' && confirmSell) {
      const coins = sellCard(s, confirmSell);
      if (coins) void wallet.add(coins);
      message = coins ? `分解完成，+${coins} 金幣` : '';
      if (confirmSell === detail) detail = null;
      confirmSell = null;
      myteam.commit();
    } else if (act === 'close') detail = null;
    else return;
    renderMyTeam();
  });
  // The picker's card row: drag it sideways with the mouse (touch scrolls by itself); a drag is not a tap.
  let drag: { row: HTMLElement; x: number; left: number; moved: boolean } | null = null;
  $('#mtBody').addEventListener('pointerdown', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.mtpk-row');
    if (!row || e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { row, x: e.clientX, left: row.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 5) {
      drag.moved = true;
      drag.row.classList.add('dragging');
    }
    if (drag.moved) drag.row.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag.row.classList.remove('dragging');
    // The click that ends a drag (if the browser sends one) picks nothing; later taps work as usual.
    const moved = drag.moved;
    drag = null;
    if (!moved) return;
    const eat = (e: Event) => e.stopPropagation();
    window.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
  });
  $('#mtBody').addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== 'mtSearch') return;
    search = el.value;
    // Redraw a moment after typing stops.
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searching = true;
      renderMyTeam();
      searching = false;
    }, 180);
  });
  $('#mtBody').addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.id === 'mtSearch') return;
    if (el.id === 'mtDiff') setPref('diff', el.value);
    if (el.id === 'mtQuarter') setPref('quarter', el.value);
    if (el.id === 'mtTarget') setPref('target', el.value);
    // The practice tab's coin line follows the settings.
    if (tab === 'practice') renderMyTeam();
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
