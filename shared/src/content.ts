import { ARCHETYPES, POSITIONS } from './career';
import {
  TIERS,
  catalogCard,
  knownPlayer,
  type EventLevelDef,
  type HolidayDef,
  type PackDef,
  type Reward,
  type SpecialFile,
} from './myteam';
import { NBA_TEAMS, RATING_KEYS, TEAMS } from './roster';
import { DIFFICULTIES } from './types';

/**
 * Content files written by the dev-only content editor (special cards and
 * themes, holidays, packs): a JSON layout that keeps short lists and objects
 * on one line, and the checks a save has to pass.
 */

/** JSON with two-space indents; arrays and objects that fit in `width` stay on one line. */
export function formatJson(value: unknown, width = 100, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = indent + '  ';
  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v) => formatJson(v, width, inner))
    : Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${JSON.stringify(k)}: ${formatJson(v, width, inner)}`);
  if (!entries.length) return isArray ? '[]' : '{}';
  const flat = isArray ? `[${entries.join(', ')}]` : `{ ${entries.join(', ')} }`;
  if (!flat.includes('\n') && indent.length + flat.length <= width) return flat;
  const [open, close] = isArray ? ['[', ']'] : ['{', '}'];
  return `${open}\n${entries.map((e) => inner + e).join(',\n')}\n${indent}${close}`;
}

/** Line widths the two files are written at. */
export const CONTENT_WIDTH = { special: 160, myteam: 100 };

/** myteam.json: the editor changes packs and holidays and keeps the rest. */
export interface ContentMyTeam {
  packs: PackDef[];
  holidays: HolidayDef[];
  [key: string]: unknown;
}

/** What is wrong (blocks a save) and what looks odd (saves anyway). */
export interface ContentCheck {
  errors: string[];
  warnings: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const TIER_IDS = new Set<string>(TIERS.map((t) => t.id));
const STYLES = new Set<string>(ARCHETYPES.map((a) => a.id));
const tierAt = (id: string) => TIERS.findIndex((t) => t.id === id);

/** A MM-DD that is a real day (29 Feb allowed). */
export function validMonthDay(text: string): boolean {
  const m = /^(\d\d)-(\d\d)$/.exec(text ?? '');
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(2024, month, 0).getDate();
}

/** Every reward in myteam.json outside the packs (levels, missions, holidays...). */
function rewardsIn(value: unknown, out: Reward[] = []): Reward[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) rewardsIn(v, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if (k === 'reward' && v && typeof v === 'object') out.push(v as Reward);
    else if (k !== 'packs') rewardsIn(v, out);
  }
  return out;
}

/**
 * Checks the editor's content before it is written (and the shipped files in
 * the tests): ids, colours, players, teams, days, tiers, rewards. `images`:
 * the files in client/public/cards/, when known.
 */
export function checkContent(special: SpecialFile, myteam: ContentMyTeam, images?: Set<string>, customGroups?: Set<string>): ContentCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dupes = (what: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`${what} id「${id}」重複`);
      seen.add(id);
    }
  };
  const badId = (id: string) => !ID.test(id ?? '');

  // Themes and special cards.
  dupes('主題', special.themes.map((t) => t.id));
  for (const t of special.themes) {
    const at = `主題「${t.name || t.id}」`;
    if (badId(t.id)) errors.push(`${at}：id 只能用小寫英文、數字和 -`);
    if (!t.name?.trim()) errors.push(`${at}：沒有名稱`);
    if (!COLOR.test(t.color) || !COLOR.test(t.accent)) errors.push(`${at}：顏色要是 #RRGGBB`);
    if (!special.cards.some((c) => c.theme === t.id)) warnings.push(`${at}還沒有卡片`);
  }
  dupes('特殊卡', special.cards.map((c) => c.id));
  const themeIds = new Set(special.themes.map((t) => t.id));
  for (const c of special.cards) {
    const at = `特殊卡「${c.id}」`;
    if (badId(c.id)) errors.push(`${at}：id 只能用小寫英文、數字和 -`);
    if (!c.player?.trim()) errors.push(`${at}：沒有球員名字`);
    else if (!knownPlayer(c.player)) {
      if (!c.position || !POSITIONS.includes(c.position)) errors.push(`${at}：「${c.player}」不在名單上，要選位置`);
      if (!c.heightM || c.heightM < 1.6 || c.heightM > 2.4) errors.push(`${at}：「${c.player}」不在名單上，要填身高（1.60–2.40 公尺）`);
      if (!c.style || !STYLES.has(c.style)) errors.push(`${at}：「${c.player}」不在名單上，要選球風`);
    }
    if (!Number.isInteger(c.ovr) || c.ovr < 66 || c.ovr > 99) errors.push(`${at}：總評要是 66–99 的整數`);
    if (!themeIds.has(c.theme)) errors.push(`${at}：主題「${c.theme}」不存在`);
    if (c.team && !NBA_TEAMS.some((t) => t.abbr === c.team)) errors.push(`${at}：球隊「${c.team}」不存在`);
    if (c.image && images && !images.has(c.image)) errors.push(`${at}：client/public/cards/ 裡沒有圖片「${c.image}」`);
  }

  // Packs.
  const packs = myteam.packs;
  dupes('卡包', packs.map((p) => p.id));
  for (const p of packs) {
    const at = `卡包「${p.name || p.id}」`;
    if (badId(p.id)) errors.push(`${at}：id 只能用小寫英文、數字和 -`);
    if (!p.name?.trim()) errors.push(`${at}：沒有名稱`);
    if (!Number.isInteger(p.price) || p.price <= 0) errors.push(`${at}：價格要是正整數`);
    if (!Number.isInteger(p.count) || p.count < 1 || p.count > 10) errors.push(`${at}：張數要是 1–10`);
    for (const t of p.tiers ?? []) if (!TIER_IDS.has(t)) errors.push(`${at}：沒有「${t}」這個等級`);
    for (const [t, w] of Object.entries(p.weights ?? {})) {
      if (!TIER_IDS.has(t)) errors.push(`${at}：權重的等級「${t}」不存在`);
      else if (!(Number(w) >= 0)) errors.push(`${at}：${t} 的權重要是 0 以上的數字`);
    }
    if (p.guarantee && !TIER_IDS.has(p.guarantee)) errors.push(`${at}：保底等級「${p.guarantee}」不存在`);
    else if (p.guarantee && p.tiers?.length && !p.tiers.some((t) => tierAt(t) >= tierAt(p.guarantee!))) errors.push(`${at}：保底等級比卡包能開出的等級還高`);
    for (const pos of p.positions ?? []) if (!POSITIONS.includes(pos)) errors.push(`${at}：沒有「${pos}」這個位置`);
    for (const name of p.players ?? []) if (!knownPlayer(name)) errors.push(`${at}：找不到球員「${name}」`);
    if (p.kind && p.kind !== 'limited' && p.kind !== 'reissue') errors.push(`${at}：種類只能是 limited 或 reissue`);
  }
  const packIds = new Set(packs.map((p) => p.id));
  for (const r of rewardsIn(myteam)) if (r.pack && !packIds.has(r.pack)) errors.push(`卡包「${r.pack}」被關卡、任務或活動的獎勵用到，不能刪除`);

  // Holidays.
  const specialIds = new Set(special.cards.map((c) => `x-${c.id}`));
  // Custom-team menu groups events pick from (the editor passes the ones it is about to save).
  const groups = customGroups ?? new Set(TEAMS.map((t) => t.group).filter(Boolean));
  const rewardProblems = (at: string, r: Reward) => {
    if (r.coins !== undefined && (!Number.isInteger(r.coins) || r.coins < 0)) errors.push(`${at}：金幣要是 0 以上的整數`);
    if (r.rental && !TIER_IDS.has(r.rental)) errors.push(`${at}：租借卡等級「${r.rental}」不存在`);
    if (r.card && !TIER_IDS.has(r.card)) errors.push(`${at}：卡片等級「${r.card}」不存在`);
    for (const id of r.cards ?? []) {
      const ok = id.startsWith('x-') ? specialIds.has(id) : !!catalogCard(id);
      if (!ok) errors.push(`${at}：獎勵卡「${id}」不存在`);
    }
    if (!r.coins && !r.pack && !r.rental && !r.card && !r.cards?.length) warnings.push(`${at}沒有獎勵`);
  };
  const levelProblems = (at: string, lv: EventLevelDef) => {
    if (lv.size !== 3 && lv.size !== 5) errors.push(`${at}：人數只能是 3 或 5`);
    if (!Number.isFinite(lv.offset)) errors.push(`${at}：評分加減要是數字`);
    if (!DIFFICULTIES.includes(lv.difficulty)) errors.push(`${at}：難度「${lv.difficulty}」不存在`);
    const pk = lv.pick ?? {};
    if (pk.sort && pk.sort !== 'height' && !RATING_KEYS.includes(pk.sort)) errors.push(`${at}：排序能力「${pk.sort}」不存在`);
    for (const t of pk.teams ?? []) if (!NBA_TEAMS.some((x) => x.abbr === t)) errors.push(`${at}：球隊「${t}」不存在`);
    for (const pos of pk.positions ?? []) if (!POSITIONS.includes(pos)) errors.push(`${at}：沒有「${pos}」這個位置`);
    // The game falls back to the whole league: worth a look, not a blocker.
    if (pk.group && !groups.has(pk.group)) warnings.push(`${at}：自訂分組「${pk.group}」沒有隊伍，會改用全聯盟球員`);
    if (pk.conference && pk.conference !== 'East' && pk.conference !== 'West') errors.push(`${at}：分區只能是 East 或 West`);
    rewardProblems(at, lv.reward ?? {});
  };
  dupes('節日活動', myteam.holidays.map((h) => h.id));
  for (const h of myteam.holidays) {
    const at = `節日活動「${h.name || h.id}」`;
    if (badId(h.id)) errors.push(`${at}：id 只能用小寫英文、數字和 -`);
    if (!h.name?.trim()) errors.push(`${at}：沒有名稱`);
    if (!validMonthDay(h.from) || !validMonthDay(h.to)) errors.push(`${at}：日期要是 MM-DD（例如 12-01）`);
    if (h.theme && !themeIds.has(h.theme)) errors.push(`${at}：主題「${h.theme}」不存在`);
    else if (h.theme && !special.cards.some((c) => c.theme === h.theme)) warnings.push(`${at}的主題還沒有卡片：活動期間限定卡包不會上架`);
    else if (h.theme && special.themes.find((t) => t.id === h.theme)?.levelOnly) warnings.push(`${at}的主題只能從關卡拿：限定卡包不會賣`);
    if (!h.levels?.length) errors.push(`${at}：至少要 1 關`);
    else if (h.levels.length !== 5) warnings.push(`${at}有 ${h.levels.length} 關（建議 5 關）`);
    h.levels?.forEach((lv, i) => levelProblems(`${at}第 ${i + 1} 關`, lv));
  }
  // The weekly events pick opponents the same way.
  for (const ev of (myteam.events as { name: string; levels: EventLevelDef[] }[] | undefined) ?? []) {
    ev.levels?.forEach((lv, i) => levelProblems(`每週活動「${ev.name}」第 ${i + 1} 關`, lv));
  }
  // The same problem found in several places says so once.
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
