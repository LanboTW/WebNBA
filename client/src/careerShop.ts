import {
  CAMP_PRICE,
  CAMP_XP,
  CAMPS_PER_SEASON,
  COIN_TRANSFER_MAX,
  GEAR,
  GEAR_SLOTS,
  GEAR_SLOT_NAME,
  GEAR_TIER_NAME,
  WAN_PER_COIN,
  XP_PER_COIN,
  campsLeft,
  canBuyGear,
  canSettle,
  canTransferCoins,
  cohesion,
  fansText,
  gamePay,
  money,
  moneyText,
  settlement,
  type CareerState,
} from '@webnba/shared';
import { RATING_LABEL } from './careerCreate';
import { coinsText } from './wallet';

/** The career's money pages: the shop, private camps and the coin bridge. */

/** Money, fans and cohesion for the overview. */
export function econHtml(c: CareerState): string {
  const coh = Math.round(cohesion(c));
  return (
    `<div class="econ">` +
    `<button type="button" data-tab="shop"><small>資金</small><b>${moneyText(money(c))}</b><span>每場薪水 ${moneyText(gamePay(c))} · 去商店 →</span></button>` +
    `<div><small>粉絲</small><b>${fansText(c.fans ?? 0)}</b><span>季末代言約 ${moneyText((c.fans ?? 0) / 1000)}</span></div>` +
    `<div><small>球隊凝聚力</small><b>${coh}</b><div class="cohbar"><i style="width:${coh}%"></i></div>` +
    `<span>${coh >= 75 ? '默契十足：教練更信任你' : '一起上場、贏球會提升'}</span></div>` +
    `</div>`
  );
}

/** Bring account coins in as money and XP (before the first season and once each offseason). */
export function coinBoxHtml(c: CareerState, coins: number): string {
  if (!canTransferCoins(c)) return '';
  const max = Math.min(coins, COIN_TRANSFER_MAX);
  return (
    `<div class="coinbox"><h3>轉入金幣<small>帳號有 ${coinsText(coins)} 金幣 · 這次最多 ${coinsText(max)}</small></h3>` +
    `<p class="sub tight">1 金幣 = ${WAN_PER_COIN} 萬美元資金，或 ${XP_PER_COIN} 經驗值。建立球員後和每個休賽季各能轉一次。</p>` +
    `<div class="coinform"><label>換資金<input type="number" min="0" max="${max}" step="10" value="0" data-coin="money" /></label>` +
    `<label>換經驗值<input type="number" min="0" max="${max}" step="10" value="0" data-coin="xp" /></label>` +
    `<button type="button" class="primary" data-act="coinsIn"${max <= 0 ? ' disabled' : ''}>轉入</button></div></div>`
  );
}

/** The shop tab: money, private camps, coins, and gear by slot. */
export function shopHtml(c: CareerState, coins: number): string {
  const cash = money(c);
  const left = campsLeft(c);
  const owned = c.gear?.owned ?? [];
  const equipped = c.gear?.equipped ?? {};
  const camp =
    `<div class="campcard"><div><b>私人訓練營</b><span>${moneyText(CAMP_PRICE)} → ${CAMP_XP} 經驗值 · 本季還能參加 ${left}/${CAMPS_PER_SEASON} 次</span></div>` +
    `<button type="button" data-act="camp"${left <= 0 || cash < CAMP_PRICE ? ' disabled' : ''}>參加</button></div>`;
  const slots = GEAR_SLOTS.map((slot) => {
    const items = GEAR.filter((g) => g.slot === slot)
      .map((g) => {
        const boosts = Object.entries(g.boosts)
          .map(([k, v]) => `${RATING_LABEL[k as keyof typeof RATING_LABEL]} +${v}`)
          .join(' · ');
        const has = owned.includes(g.id);
        const on = equipped[slot] === g.id;
        const check = canBuyGear(c, g.id);
        const btn = has
          ? `<button type="button" class="small${on ? ' on' : ''}" data-act="wear" data-arg="${g.id}">${on ? '已穿上（點擊脫下）' : '穿上'}</button>`
          : `<button type="button" class="small primary" data-act="buy" data-arg="${g.id}"${check === 'ok' ? '' : ' disabled'}>` +
            `${check === 'fans' ? `需要 ${fansText(g.fans)} 粉絲` : `購買 ${moneyText(g.price)}`}</button>`;
        const swatch = g.look.shoeColor ? `<i class="swatch" style="background:${g.look.shoeColor}"></i>` : '';
        return (
          `<div class="gear t${g.tier}${on ? ' on' : ''}"><div><small>${GEAR_TIER_NAME[g.tier]}</small><b>${swatch}${g.name}</b>` +
          `<span>${boosts}</span></div>${btn}</div>`
        );
      })
      .join('');
    return `<h3>${GEAR_SLOT_NAME[slot]}<small>每個部位只能穿一件</small></h3><div class="gearlist">${items}</div>`;
  }).join('');
  return (
    `<div class="xpline"><span>資金 <b>${moneyText(cash)}</b></span><span>粉絲 <b>${fansText(c.fans ?? 0)}</b></span></div>` +
    `<p class="sub tight">例行賽每場領一次薪水，季末依粉絲數拿代言收入。裝備的加成在比賽中生效（能力最高 99），頂級簽名款要 100 萬粉絲才買得到。</p>` +
    camp +
    coinBoxHtml(c, coins) +
    slots
  );
}

/** Retired: turn what is left into coins, once. */
export function settleHtml(c: CareerState): string {
  if (c.settled) return `<div class="coinbox"><h3>退休結算<small>已換成金幣</small></h3></div>`;
  if (!canSettle(c)) return '';
  return (
    `<div class="coinbox"><h3>退休結算<small>每個存檔一次</small></h3>` +
    `<p class="sub tight">剩下的 ${moneyText(money(c))} 資金和 ${c.player.xp ?? 0} 經驗值可以換成 <b>${coinsText(settlement(c))}</b> 金幣（10 萬美元或 10 經驗值換 1 金幣），金幣可以用在新的生涯。</p>` +
    `<div class="buttons"><button type="button" class="primary" data-act="settle">結算成金幣</button></div></div>`
  );
}
