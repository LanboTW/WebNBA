import {
  DECK_MAX,
  DYNASTY,
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
  periodTop,
  refOf,
  sellCard,
  tier,
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
 * The MyTeam screen: games (ladder, street dynasty, limited and weekly event
 * levels), missions, deck, collection, practice games and the pack shop, plus the pack-opening reveal. Everything is saved through the myteam store; coins
 * come from the account wallet.
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
  const picks = filtered(allCards().filter((c) => !inDeck.has(refOf(c))));
  const sel = slot !== null && s.deck[slot] ? deckCard(s, s.deck[slot]) : null;
  return (
    `<div class="mtbar"><span>牌組評分 <b class="big">${deckRating(s)}</b></span><span>${s.deck.length}/${DECK_MAX} 張</span>` +
    `<button type="button" class="small" data-act="auto">自動組牌</button></div>` +
    cols(
      `<h3 class="mth">先發</h3><div class="mtslots five">${[0, 1, 2, 3, 4].map(cell).join('')}</div>` +
        `<h3 class="mth">板凳</h3><div class="mtslots">${Array.from({ length: DECK_MAX - 5 }, (_, i) => cell(i + 5)).join('')}</div>` +
        (sel ? `<div class="mtbar"><span>已選：${esc(sel.name)}</span><button type="button" class="small" data-act="unslot">移出牌組</button></div>` : ''),
      `<p class="fine left">${slot === null ? '先點一個位置，' : `把卡放進第 ${slot + 1} 格：`}再挑一張卡。同一名球員只能放一張；租借卡打完場數就會消失。</p>` +
        `<div class="chips">${tierChips(filterTier, 'data-ft')}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
        `<div class="mtgrid mtscroll">${
          picks.map((c) => cardHtml(c, { cls: `small pick${names.has(c.name) ? ' dim' : ''}`, ref: refOf(c) })).join('') ||
          '<p class="fine">沒有符合的卡。</p>'
        }</div>`,
    )
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
    `<div class="mtratings">${rows}</div>${sell}<button type="button" class="small mtclose" data-act="close">關閉</button></div></div>`
  );
}

function cardsTab(): string {
  const cards = allCards();
  const d = detail ? cards.find((c) => refOf(c) === detail) : null;
  const shown = filtered(cards);
  const total = cardCatalog().length;
  return (
    `<div class="mtbar"><span>收藏 <b>${myteam.save.cards.length}</b> / ${total} 張</span><span>租借 ${myteam.save.rentals.length} 張</span><span>已開 ${myteam.save.packsOpened} 包</span></div>` +
    cols(
      `<div class="chips">${tierChips(filterTier, 'data-ft')}</div><div class="chips">${posChips(filterPos, 'data-fp')}</div>` +
        `<div class="mtgrid mtscroll">${shown.map((c) => cardHtml(c, { cls: `small pick${refOf(c) === detail ? ' sel' : ''}`, ref: refOf(c) })).join('') || '<p class="fine">沒有符合的卡。</p>'}</div>`,
      d ? detailHtml(d) : '<p class="fine mtnodetail">點一張卡，這裡會顯示大圖和全部能力值。</p>',
      true,
    )
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
    `<span class="fine">${nextPeriodText(s)}</span></div><div class="mtpacks">` +
    OFFICIAL_PACKS
      .map((p) => {
        const can = wallet.coins >= p.price && packPool(p, s.period).length > 0;
        return (
          `<div class="mtpack"><div class="mtpack-h"><b>${esc(p.name)}</b></div>` +
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
  ['limited', '限定關卡'],
  ['event', '活動關卡'],
];

let host: MyTeamHost | null = null;
let ladderPeriod = 0;
/** Deck refs picked for 3v3 games (dynasty, events, practice). */
let streetPick: string[] = [];
/** The limited level being set up and the cards picked for it (any owned card). */
let limitedSel: string | null = null;
let limitedPick: string[] = [];
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
  if (r.rental) bits.push(`${tier(r.rental).name}卡租借（3 場）`);
  if (r.card) bits.push(`${tier(r.card).name}卡一張`);
  return bits.join('＋');
}

function nextPeriodText(s: MyTeamSave): string {
  if (s.period >= PERIODS) return '已開放全部 6 期';
  const need = MISSIONS_PER_PERIOD * s.period - s.claimed.length;
  return `下一期：打完第 ${s.period} 期挑戰之路，或再領 ${need} 個任務獎勵`;
}

const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;

/** Chips to pick cards: `on` refs are picked, the rest open while there is room and `allowed` says so. */
function pickChips(cards: OwnedCard[], on: string[], max: number, attr: string, allowed: (c: OwnedCard) => boolean = () => true): string {
  return cards
    .map((c) => {
      const ref = refOf(c);
      const sel = on.includes(ref);
      const open = sel || (on.length < max && allowed(c));
      return `<button type="button" class="chip${sel ? ' on' : ''}" ${attr}="${esc(ref)}"${open ? '' : ' disabled'}>${c.position} ${esc(c.name)} ${c.ovr}${
        isRental(c) ? '（租）' : ''
      }</button>`;
    })
    .join('');
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

/** The 3v3 lineup picker (from the deck) used by dynasty and event games. */
function streetPicker(): string {
  const lineup = deckLineup(myteam.save);
  return (
    `<h3 class="mth">街頭陣容<small>${streetPick.length}/3</small></h3><p class="fine left">3 對 3 的比賽用這 3 人，從牌組挑。</p>` +
    `<div class="chips">${pickChips(lineup, streetPick, 3, 'data-sp')}</div>`
  );
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
        line: `對手評分 ${l.ovr}・${DIFF_LABEL[l.difficulty]}・${done ? '已過關（再贏 100 金幣）' : `首勝：${rewardText(l.reward)}`}`,
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
  const ready = streetPick.length === 3;
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
        line: `${crew}・評分 ${d.ovr}・${DIFF_LABEL[d.difficulty]}・${done ? '已過關（再贏 100 金幣）' : `首勝：${rewardText(d.reward)}`}`,
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
const limitedCards = (): OwnedCard[] => [...allCards()].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));

function limitedLineup(l: LimitedDef): { cards: OwnedCard[]; problem: string | null } {
  const all = limitedCards();
  const cards = limitedPick.map((r) => all.find((c) => refOf(c) === r)).filter((c): c is OwnedCard => !!c);
  return { cards, problem: lineupProblem(l.rule, cards, l.size) };
}

function limitedHtml(): string {
  const s = myteam.save;
  const sel = LIMITED.find((l) => l.id === limitedSel) ?? null;
  const rows = LIMITED.map((l, i) => {
    const done = s.cleared.includes(l.id);
    return levelRow({
      cls: `${done ? ' done' : ''}${l.id === limitedSel ? ' sel' : ''}`,
      badge: sizeBadge(l.size),
      title: `${i + 1}. ${esc(l.name)}`,
      line: `${ruleText(l.rule).join('・')}・對手 ${l.ovr}${l.team ? `（${esc(findTeam(l.team).name)}）` : ''}・${DIFF_LABEL[l.difficulty]}・${
        done ? '已完成（再贏 100 金幣）' : rewardText(l.reward)
      }`,
      btn: `<button type="button" class="small${l.id === limitedSel ? ' go' : ''}" data-limsel="${l.id}">${l.id === limitedSel ? '設定中' : '選擇'}</button>`,
    });
  }).join('');
  let right = '<p class="fine mtnodetail">選一個限定關卡，這裡挑符合條件的陣容。</p>';
  if (sel) {
    const { cards, problem } = limitedLineup(sel);
    const all = limitedCards();
    const fits = all.filter((c) => limitedPick.includes(refOf(c)) || (cardAllowed(sel.rule, c, cards) && !cards.some((x) => x.name === c.name)));
    const shown = fits.slice(0, 60);
    const avgH = cards.length ? Math.round((cards.reduce((t, c) => t + c.heightM, 0) / cards.length) * 100) : 0;
    right =
      `<h3 class="mth">${esc(sel.name)}<small>${sel.size} 對 ${sel.size}</small></h3><ul class="mtrules">${ruleText(sel.rule)
        .map((r) => `<li>${esc(r)}</li>`)
        .join('')}</ul>` +
      `<p class="fine left">已選 ${cards.length}/${sel.size}${cards.length ? `・平均身高 ${avgH} 公分` : ''}${
        sel.size === 5 ? '・板凳自動用其他符合條件的卡' : ''
      }</p>` +
      `<div class="chips mtscroll">${pickChips(shown, limitedPick, sel.size, 'data-lim')}${
        fits.length > shown.length ? `<span class="fine">…還有 ${fits.length - shown.length} 張</span>` : ''
      }${fits.length ? '' : '<span class="fine">收藏裡沒有符合條件的卡。</span>'}</div>` +
      `<div class="mtplay"><span class="fine left">${problem && cards.length === sel.size ? esc(problem) : ''}</span>` +
      `<button type="button" class="small go" data-act="limitedgame"${problem ? ' disabled' : ''}>開始</button></div>` +
      settingsBox(sel.size === 3, sel.size === 5);
  }
  return cols(`<div class="mtlevels mtscroll">${rows}</div>`, right, true);
}

function eventHtml(full: boolean): string {
  const s = myteam.save;
  const week = eventWeek();
  const theme = eventTheme(week);
  const base = eventBase(s);
  const days = Math.max(1, Math.ceil((eventEnds(week) - Date.now()) / 86_400_000));
  const ready = streetPick.length === 3;
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
        line: `評分 ${Math.min(99, base + lv.offset)}・${DIFF_LABEL[lv.difficulty]}・${done ? '本週已完成（再贏 100 金幣）' : `本週首勝：${rewardText(lv.reward)}`}`,
        btn: `<button type="button" class="small${done ? '' : ' go'}" data-event="${i}"${can ? '' : ' disabled'}>${done ? '再打一次' : '挑戰'}</button>`,
      });
    })
    .join('');
  return cols(
    `<div class="mtevent"><b>${esc(theme.name)}</b><span>${esc(theme.desc)}・還有 ${days} 天換下一個活動</span></div><div class="mtlevels">${rows}</div>`,
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
  const body = mode === 'dynasty' ? dynastyHtml() : mode === 'limited' ? limitedHtml() : mode === 'event' ? eventHtml(full) : ladderHtml(full);
  return (
    `<div class="mtbar"><span>第 <b>${s.period}</b> 期</span><span>牌組評分 <b>${deckRating(s)}</b></span><span>${nextPeriodText(s)}</span></div>` +
    `<nav class="tabs mtmodes">${PLAY_MODES.map(([k, l]) => `<button type="button" data-mode="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</nav>` +
    (full || mode === 'limited' ? '' : '<p class="msg">牌組至少要 5 張卡才能打 5 對 5，先到「牌組」分頁放卡。</p>') +
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
        `<button type="button" class="small go" data-act="practice3"${streetPick.length === 3 ? '' : ' disabled'}>開始</button></div>`);
  const right =
    `<h3 class="mth">難度</h3><div class="row"><label>電腦難度<select id="mtDiff">${DIFFICULTIES.map((d) => opt(d, `${DIFF_LABEL[d]}（金幣 ×${DIFFICULTY_COINS[d]}）`, diff)).join(
      '',
    )}</select></label></div>` +
    settingsBox(size === '3', size === '5') +
    `<p class="fine left">隨機比賽是練習：不扣租借卡、不算任務。金幣依比賽時間給，每 3 分鐘 ${PRACTICE_COINS.per3} 金幣，贏球 ×${PRACTICE_COINS.win}，再乘難度倍率；中途離開沒有金幣。</p>`;
  return `<div class="mtbar"><span>牌組評分 <b>${deckRating(s)}</b></span><span>隨機比賽（練習）</span></div>` + cols(left, right);
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

interface GamePlan {
  /** Null for a practice game: nothing booked but coins. */
  kind: GameKind | null;
  size: 3 | 5;
  /** Your players in roster order (5v5: starters first). */
  cards: OwnedCard[];
  opponent: TeamInfo;
  difficulty: Difficulty;
  level?: string;
  event?: { week: number; index: number };
}

const streetCards = (): OwnedCard[] =>
  streetPick
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
  };
  if (plan.size === 3) settings.street = { target: Number(pref('target', '21')), makeItTakeIt: false };
  const teams: [TeamInfo, TeamInfo] = [{ ...MYTEAM_INFO, players: plan.cards.map(cardPlayer) }, plan.opponent];
  host.play(
    teams,
    settings,
    (state, forfeit) => {
      const [a, b] = state.score;
      if (!plan.kind) {
        // Practice: game time (a street game's real clock) pays, nothing else counts.
        const minutes = plan.size === 3 ? state.tick / 30 / 60 : (state.settings.quarterSeconds * 4) / 60;
        const coins = forfeit ? 0 : practiceCoins(minutes, a > b, plan.difficulty);
        if (coins) void wallet.add(coins);
        message = `隨機比賽：${forfeit ? '中途離開，沒有金幣' : `${a > b ? '勝利' : '落敗'}・+${coins} 金幣`}`;
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
      streetPick = streetPick.filter((r) => deckCard(s, r));
      limitedPick = limitedPick.filter((r) => allCards().some((c) => refOf(c) === r));
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

function playLevel(kind: 'ladder' | 'dynasty' | 'limited' | 'event', id: string): void {
  const s = myteam.save;
  if (kind === 'ladder') {
    const level = LEVELS.find((l) => l.id === id);
    if (level && levelOpen(s, level)) startGame({ kind, size: 5, cards: deckLineup(s), opponent: levelTeam(level), difficulty: level.difficulty, level: id });
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
  } else {
    const week = eventWeek();
    const index = Number(id);
    const theme = eventTheme(week);
    const lv = theme.levels[index];
    if (!lv) return;
    const cards = lv.size === 3 ? streetCards() : deckLineup(s);
    startGame({ kind, size: lv.size, cards, opponent: eventTeam(theme, index, eventBase(s)), difficulty: lv.difficulty, event: { week, index } });
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
  $('#mtCoins').textContent = `🪙 ${coinsText(wallet.coins)}`;
  const ready = missionsReady();
  $('#mtTabs').innerHTML = TABS.map(
    ([id, label]) =>
      `<button type="button" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}${id === 'missions' && ready ? ` <i class="dot">${ready}</i>` : ''}</button>`,
  ).join('');
  streetPick = streetPick.filter((r) => s.deck.includes(r));
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
    else if (data('data-mode')) {
      setPref('mode', data('data-mode')!);
      message = '';
    } else if (data('data-psize')) setPref('psize', data('data-psize')!);
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
      if (limitedSel !== id) limitedPick = [];
      limitedSel = id;
      if (window.innerWidth < 1100) $('#myteam').scrollTo({ top: 0, behavior: 'smooth' });
    } else if (data('data-lim')) {
      const ref = data('data-lim')!;
      const size = LIMITED.find((l) => l.id === limitedSel)?.size ?? 5;
      limitedPick = limitedPick.includes(ref) ? limitedPick.filter((r) => r !== ref) : [...limitedPick, ref].slice(0, size);
    } else if (act === 'limitedgame' && limitedSel) {
      playLevel('limited', limitedSel);
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
    } else if (act === 'practice5') {
      startGame({ kind: null, size: 5, cards: deckLineup(s), opponent: quickOpponent(s), difficulty: pref('diff', 'normal') as Difficulty });
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
        confirmSell = false;
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
