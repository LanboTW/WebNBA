import {
  ARCHETYPES,
  CONTENT_WIDTH,
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  NBA_TEAMS,
  PERIODS,
  POSITIONS,
  RATING_KEYS,
  TEAMS,
  TIERS,
  checkContent,
  eventTeam,
  formatCustomTeams,
  formatJson,
  overallOf,
  parseRoster,
  playerRating,
  startingRatings,
  teamRating,
  toOverall,
  validateCustomTeams,
  type ArchetypeId,
  type Position,
  type RawPlayer,
  type RawTeam,
  type Ratings,
  knownPlayers,
  packOdds,
  packPool,
  periodLevels,
  previewSpecial,
  tier,
  type ContentMyTeam,
  type HolidayDef,
  type PackDef,
  type SpecialFile,
  type SpecialRow,
  type SpecialTheme,
} from '@webnba/shared';
import customJson from '../../shared/data/custom-teams.json';
import myteamJson from '../../shared/data/myteam.json';
import specialJson from '../../shared/data/special-cards.json';
import { esc } from './boxscore';
import { cardHtml, hydrateCards } from './cards';
import { RATING_LABEL } from './careerCreate';

/**
 * The content editor (npm run dev only): special cards, their themes, holiday
 * events, packs and the shipped custom teams, with a live preview. A save
 * checks everything, then the dev server writes shared/data/*.json (and the
 * picture into client/public/cards/ or logos/custom/); commit and push to
 * ship it.
 */

type Kind = 'card' | 'theme' | 'holiday' | 'pack' | 'team';
const KINDS: [Kind, string][] = [
  ['card', '特殊卡'],
  ['theme', '主題'],
  ['holiday', '節日活動'],
  ['pack', '卡包'],
  ['team', '自訂隊伍'],
];

/** custom-teams.json. */
interface CustomFile {
  $comment?: string;
  ratingKeys: string[];
  teams: RawTeam[];
}

type Entry = Record<string, unknown>;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let special: SpecialFile = clone(specialJson as unknown as SpecialFile);
let myteam: ContentMyTeam = clone(myteamJson as unknown as ContentMyTeam);
let custom: CustomFile = clone(customJson as unknown as CustomFile);
let logos = new Set<string>();
/** A team logo waiting for the save (webp data URL). */
let logoPic: string | null = null;
/** The player whose ratings are open in the team form. */
let openPlayer: number | null = null;
let kind: Kind = 'card';
/** The entry open in the form (its id; '' = a new one). */
let current: string | null = null;
let form: Entry = {};
let message = '';
let problems: string[] = [];
let warnings: string[] = [];
let confirmDelete = false;
let period = 3;
let images = new Set<string>();
/** A cropped picture waiting for the save (webp data URL). */
let picture: string | null = null;
let crop: { img: HTMLImageElement; zoom: number; x: number; y: number } | null = null;
let wired = false;

const listIn = (k: Kind, s: SpecialFile, m: ContentMyTeam, c: CustomFile): Entry[] =>
  (k === 'card' ? s.cards : k === 'theme' ? s.themes : k === 'holiday' ? m.holidays : k === 'pack' ? m.packs : c.teams) as unknown as Entry[];
const listOf = (k: Kind = kind): Entry[] => listIn(k, special, myteam, custom);
/** An entry's key: teams go by abbreviation, the rest by id. */
const keyOf = (e: Entry, k: Kind = kind): string => String((k === 'team' ? e.abbr : e.id) ?? '');

function blank(k: Kind): Entry {
  if (k === 'team') {
    const groups = custom.teams.map((t) => t.group).filter(Boolean);
    const player = (name: string, number: number, h: number, pos: Position): RawPlayer => [name, number, h, pos, ratingsFor(pos, 'allround', h, 70)];
    return {
      group: groups[groups.length - 1] ?? '自訂隊伍',
      abbr: '',
      name: '',
      primary: '#1d428a',
      secondary: '#ffc72c',
      players: [player('控球後衛', 1, 1.88, 'PG'), player('得分後衛', 2, 1.96, 'SG'), player('小前鋒', 3, 2.01, 'SF'), player('大前鋒', 4, 2.06, 'PF'), player('中鋒', 5, 2.11, 'C')],
    };
  }
  if (k === 'card') return { id: '', player: '', team: 'LAL', ovr: 97, theme: special.themes[0]?.id ?? '' };
  if (k === 'theme') return { id: '', name: '', color: '#c8102e', accent: '#f5c518' };
  if (k === 'pack') return { id: '', name: '', price: 1000, count: 3 };
  const level = (size: number, offset: number, difficulty: string, coins: number) => ({ size, offset, difficulty, reward: { coins }, pick: {} });
  return {
    id: '',
    name: '',
    desc: '',
    from: '01-01',
    to: '01-14',
    levels: [level(3, 0, 'normal', 300), level(5, 1, 'normal', 400), level(3, 2, 'hard', 300), level(5, 3, 'hard', 500), { ...level(5, 6, 'expert', 800), reward: { coins: 800, pack: 'elite' } }],
  };
}

// ----------------------------------------------------------------- paths

function getPath(o: Entry, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Entry)[k] : undefined), o);
}

/** Sets a value by path; empty values drop the key (and empty objects above it) so the file stays clean. */
function setPath(o: Entry, path: string, value: unknown): void {
  const keys = path.split('.');
  let at: Entry = o;
  for (const k of keys.slice(0, -1)) {
    if (!at[k] || typeof at[k] !== 'object') at[k] = /^\d+$/.test(k) ? [] : {};
    at = at[k] as Entry;
  }
  const last = keys[keys.length - 1];
  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length) || (typeof value === 'number' && Number.isNaN(value));
  if (empty) delete at[last];
  else at[last] = value;
}

// ----------------------------------------------------------------- fields

const opt = (v: string, label: string, cur: unknown) => `<option value="${esc(v)}"${String(cur ?? '') === v ? ' selected' : ''}>${esc(label)}</option>`;

function field(label: string, path: string, type: 'text' | 'number' | 'color' | 'list' | 'day', extra = ''): string {
  const v = getPath(form, path);
  const shown = type === 'list' ? ((v as string[] | undefined) ?? []).join(', ') : String(v ?? '');
  const input = type === 'number' ? 'number' : type === 'color' ? 'color' : 'text';
  return `<label>${label}<input type="${input}" data-f="${path}" data-t="${type}" value="${esc(shown)}" ${extra} /></label>`;
}

function select(label: string, path: string, options: [string, string][], blankLabel?: string, numeric = false): string {
  const v = getPath(form, path);
  return (
    `<label>${label}<select data-f="${path}" data-t="${numeric ? 'number' : 'text'}">` +
    (blankLabel !== undefined ? opt('', blankLabel, v) : '') +
    options.map(([k, l]) => opt(k, l, v)).join('') +
    `</select></label>`
  );
}

function check(label: string, path: string): string {
  return `<label class="check"><input type="checkbox" data-f="${path}" data-t="bool"${getPath(form, path) ? ' checked' : ''} />${label}</label>`;
}

/** Chips for a list of choices (several at once). */
function chips(label: string, path: string, options: [string, string][]): string {
  const on = new Set((getPath(form, path) as string[] | undefined) ?? []);
  return (
    `<div class="ce-chips"><span>${label}</span>` +
    options.map(([k, l]) => `<button type="button" class="chip${on.has(k) ? ' on' : ''}" data-chip="${path}" data-v="${esc(k)}">${esc(l)}</button>`).join('') +
    `</div>`
  );
}

const idField = () => field('id（英文小寫、數字、-；建立後不能改）', 'id', 'text', current ? 'disabled' : '');
const teamOptions = (): [string, string][] => NBA_TEAMS.map((t) => [t.abbr, `${t.abbr} ${t.name}`]);
const themeOptions = (): [string, string][] => special.themes.map((t) => [t.id, `${t.name}（${t.id}）`]);
const packOptions = (): [string, string][] => myteam.packs.map((p) => [p.id, p.name]);

const CAPS = Object.fromEntries(RATING_KEYS.map((k) => [k, 99])) as unknown as Ratings;

/** Ratings (file order) for a position, style and height at an overall. */
function ratingsFor(pos: Position, style: ArchetypeId, heightM: number, ovr: number): number[] {
  const r = toOverall(startingRatings(pos, style, heightM), CAPS, ovr, (x) => overallOf(pos, x));
  return RATING_KEYS.map((k) => Math.max(1, Math.min(99, Math.round(r[k]))));
}

const playerOvr = (p: RawPlayer): number =>
  playerRating({ position: p[3] as Position, ratings: Object.fromEntries(RATING_KEYS.map((k, i) => [k, p[4][i] ?? 50])) as unknown as Ratings });

/** Players: one row each (the first five start), ratings open one player at a time. */
function teamForm(): string {
  const players = (form.players as RawPlayer[]) ?? [];
  const groups = [...new Set(custom.teams.map((t) => t.group).filter((g): g is string => !!g))];
  const logoSrc = logoPic ?? (form.logo ? `${import.meta.env.BASE_URL}logos/${String(form.logo)}` : '');
  const rows = players
    .map((p, i) => {
      const open = openPlayer === i;
      return (
        `<div class="ce-player${open ? ' open' : ''}"><span class="ce-tag">${i < 5 ? '先發' : '板凳'}</span>` +
        `<input type="text" data-p="${i}:0" value="${esc(p[0])}" placeholder="名字" />` +
        `<input type="number" data-p="${i}:1" value="${p[1]}" min="0" max="99" title="背號" />` +
        `<input type="number" data-p="${i}:2" value="${p[2]}" step="0.01" min="1.4" max="2.6" title="身高（公尺）" />` +
        `<select data-p="${i}:3">${POSITIONS.map((pos) => opt(pos, pos, p[3])).join('')}</select>` +
        `<b class="ce-ovr" title="總評">${playerOvr(p)}</b>` +
        `<button type="button" class="small" data-act="ratings" data-i="${i}">${open ? '收起' : '能力'}</button>` +
        `<button type="button" class="small" data-act="up" data-i="${i}"${i ? '' : ' disabled'}>↑</button>` +
        `<button type="button" class="small" data-act="down" data-i="${i}"${i < players.length - 1 ? '' : ' disabled'}>↓</button>` +
        `<button type="button" class="small" data-act="delplayer" data-i="${i}">刪除</button></div>` +
        (open
          ? `<div class="ce-ratings">${RATING_KEYS.map(
              (k, j) => `<label>${RATING_LABEL[k]}<input type="number" data-r="${i}:${j}" value="${p[4][j] ?? 50}" min="1" max="99" /></label>`,
            ).join('')}</div>` +
            `<div class="row ce-gen"><label>依球風產生<select id="ceGenStyle">${ARCHETYPES.map((a) => opt(a.id, a.name, 'allround')).join('')}</select></label>` +
            `<label>總評<input type="number" id="ceGenOvr" value="${playerOvr(p)}" min="40" max="99" /></label>` +
            `<button type="button" class="small" data-act="genratings" data-i="${i}">產生能力（會蓋掉上面的數字）</button></div>`
          : '')
      );
    })
    .join('');
  return (
    `<div class="row">${field('縮寫（2–5 個大寫英文或數字；建立後不能改）', 'abbr', 'text', current ? 'disabled' : 'maxlength="5"')}${field('隊名', 'name', 'text')}${field(
      '選單分組',
      'group',
      'text',
      'list="ceGroups"',
    )}</div>` +
    `<datalist id="ceGroups">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>` +
    `<div class="row">${field('主色', 'primary', 'color')}${field('副色', 'secondary', 'color')}</div>` +
    `<h3 class="mth">隊徽<small>${form.logo ? esc(String(form.logo)) : '沒有就用縮寫和隊色'}</small></h3>` +
    `<div class="row ce-logo">${logoSrc ? `<img src="${esc(logoSrc)}" alt="" />` : ''}<label>選圖片（會縮到 256×256、保留透明）<input type="file" id="ceLogo" accept="image/*" /></label>${
      form.logo || logoPic ? '<button type="button" class="small" data-act="nologo">不用隊徽</button>' : ''
    }</div>` +
    `<h3 class="mth">球員<small>${players.length} 人（5–10 人，前 5 個先發）</small></h3>${rows}` +
    (players.length < 10 ? '<button type="button" class="small" data-act="addplayer">＋ 加一名球員</button>' : '') +
    '<p class="fine left">名字可以用中文；能力 1–99（先點「能力」展開，或用球風加總評一鍵產生）。</p>'
  );
}

function formHtml(): string {
  if (kind === 'team') return teamForm();
  if (kind === 'card') {
    const known = new Set(knownPlayers());
    const unknown = !!form.player && !known.has(String(form.player));
    return (
      `<div class="row">${idField()}${field('球員（名單或歷史球員的英文名字；新人也可以）', 'player', 'text', 'list="cePlayers"')}</div>` +
      `<datalist id="cePlayers">${knownPlayers()
        .map((n) => `<option value="${esc(n)}"></option>`)
        .join('')}</datalist>` +
      `<div class="row">${field('總評（66–99，97 以上黑卡）', 'ovr', 'number', 'min="66" max="99"')}${select('球隊（隊徽）', 'team', teamOptions())}${select('主題', 'theme', themeOptions())}</div>` +
      `<div class="row">${field('卡面右下角的字（空白＝主題名）', 'label', 'text')}</div>` +
      (unknown
        ? `<p class="fine left">「${esc(String(form.player))}」不在名單上：補上位置、身高、背號和球風，能力由球風和身高推算。</p>` +
          `<div class="row">${select('位置', 'position', POSITIONS.map((p) => [p, p]), '—')}${field('身高（公尺）', 'heightM', 'number', 'step="0.01"')}${field('背號', 'number', 'number')}${select(
            '球風',
            'style',
            ARCHETYPES.map((a) => [a.id, a.name]),
            '—',
          )}</div>`
        : '') +
      `<h3 class="mth">圖片<small>${form.image ? esc(String(form.image)) : '沒有圖就用球員照片或 3D 頭像'}</small></h3>` +
      `<div class="row"><label>選圖片<input type="file" id="cePic" accept="image/*" /></label>${
        form.image || picture ? '<button type="button" class="small" data-act="nopic">不用圖片</button>' : ''
      }</div>` +
      (crop
        ? `<div class="ce-crop"><canvas id="ceCrop" width="200" height="280"></canvas><div><p class="fine left">拖拉圖片調整位置，用滑桿縮放。存檔時存成 400×560 的 webp。</p><label>縮放<input type="range" id="ceZoom" min="1" max="4" step="0.01" value="${crop.zoom}" /></label></div></div>`
        : '')
    );
  }
  if (kind === 'theme') {
    return (
      `<div class="row">${idField()}${field('名稱（卡面和限定卡包顯示）', 'name', 'text')}</div>` +
      `<div class="row">${field('主色', 'color', 'color')}${field('副色', 'accent', 'color')}</div>` +
      `<div class="row">${check('只能從關卡拿（不進任何卡包，例如奧運）', 'levelOnly')}</div>` +
      '<p class="fine left">主題被節日活動用到時，限定卡包只在那個節日期間賣它；沒被節日用到的主題每週輪流賣。</p>'
    );
  }
  if (kind === 'pack') {
    const kindOptions: [string, string][] = [
      ['limited', '限定（賣當期主題的特殊卡）'],
      ['reissue', '復刻（舊球季的現役卡）'],
    ];
    return (
      `<div class="row">${idField()}${field('名稱', 'name', 'text')}</div>` +
      `<div class="row">${field('價格（金幣）', 'price', 'number', 'min="1"')}${field('張數（1–10）', 'count', 'number', 'min="1" max="10"')}${select('種類', 'kind', kindOptions, '一般')}</div>` +
      `<div class="row">${check('在商店隱藏（不賣；關卡、任務獎勵還是會給）', 'hidden')}</div>` +
      chips(
        '只出這些等級（不選＝全部）',
        'tiers',
        TIERS.map((t) => [t.id, t.name]),
      ) +
      `<div class="row">${select(
        '保底（第一張至少）',
        'guarantee',
        TIERS.map((t) => [t.id, t.name]),
        '沒有',
      )}</div>` +
      chips('只出這些位置（不選＝全部）', 'positions', POSITIONS.map((p) => [p, p])) +
      `<h3 class="mth">各等級權重<small>空白＝預設值；只看比例</small></h3><div class="row ce-weights">${TIERS.map((t) => field(t.name, `weights.${t.id}`, 'number', 'min="0" step="0.1"')).join('')}</div>` +
      `<div class="row">${field('只出這些球員（英文名字，逗號分開；空白＝不限）', 'players', 'list')}</div>`
    );
  }
  // Holiday.
  const levels = (form.levels as unknown[] | undefined) ?? [];
  const sorts: [string, string][] = [...RATING_KEYS.map((k) => [k, RATING_LABEL[k]] as [string, string]), ['height', '身高']];
  const groups = [...new Set(TEAMS.map((t) => t.group).filter((g): g is string => !!g))];
  return (
    `<div class="row">${idField()}${field('名稱', 'name', 'text')}</div>` +
    `<div class="row">${field('說明', 'desc', 'text')}</div>` +
    `<div class="row">${field('開始（MM-DD）', 'from', 'day')}${field('結束（MM-DD，含當天）', 'to', 'day')}${select('主題（期間限定卡包賣它）', 'theme', themeOptions(), '沒有')}</div>` +
    levels
      .map(
        (_, i) =>
          `<fieldset class="ce-level"><legend>第 ${i + 1} 關${i === levels.length - 1 ? '（最終關）' : ''}<button type="button" class="small" data-act="dellevel" data-i="${i}">刪除</button></legend>` +
          `<div class="row">${select(
            '人數',
            `levels.${i}.size`,
            [
              ['3', '3 對 3'],
              ['5', '5 對 5'],
            ],
            undefined,
            true,
          )}${field('評分（期數基準 ±）', `levels.${i}.offset`, 'number')}${select(
            '難度',
            `levels.${i}.difficulty`,
            DIFFICULTIES.map((d) => [d, DIFFICULTY_LABEL[d]]),
          )}</div>` +
          `<div class="row">${field('獎勵金幣', `levels.${i}.reward.coins`, 'number', 'min="0"')}${select('獎勵卡包', `levels.${i}.reward.pack`, packOptions(), '沒有')}${field(
            '獎勵卡（卡片 id，逗號分開，隨機一張）',
            `levels.${i}.reward.cards`,
            'list',
          )}</div>` +
          `<div class="row">${select('對手：依能力挑最強的', `levels.${i}.pick.sort`, sorts, '總評')}${field('只從這些球隊（縮寫，逗號分開）', `levels.${i}.pick.teams`, 'list')}${select(
            '分區',
            `levels.${i}.pick.conference`,
            [
              ['East', '東區'],
              ['West', '西區'],
            ],
            '不限',
          )}${select(
            '自訂分組',
            `levels.${i}.pick.group`,
            groups.map((g) => [g, g]),
            '不用',
          )}</div>` +
          chips('只挑這些位置', `levels.${i}.pick.positions`, POSITIONS.map((p) => [p, p])) +
          `</fieldset>`,
      )
      .join('') +
    `<button type="button" class="small" data-act="addlevel">＋ 加一關</button>` +
    (form.theme ? `<button type="button" class="small" data-act="themecards">最終關送這個主題的特殊卡</button>` : '')
  );
}

// ----------------------------------------------------------------- previews

function themesWithForm(): SpecialTheme[] {
  if (kind !== 'theme') return special.themes;
  const others = special.themes.filter((t) => t.id !== current);
  return [...others, form as unknown as SpecialTheme];
}

function teamPreview(): string {
  let team;
  try {
    team = parseRoster({ season: '', ratingKeys: custom.ratingKeys, teams: [form as unknown as RawTeam] } as never)[0];
  } catch {
    return '<p class="fine">球員資料還不完整。</p>';
  }
  const logoSrc = logoPic ?? (form.logo ? `${import.meta.env.BASE_URL}logos/${String(form.logo)}` : '');
  const line = (p: { name: string; position: string; number: number }, i: number) =>
    `<li>${i < 5 ? '' : '<em>板凳</em> '}${esc(p.position)} #${p.number} ${esc(p.name)} <b>${playerRating(team.players[i])}</b></li>`;
  return (
    `<div class="ce-team" style="--c1:${esc(String(form.primary ?? '#333333'))};--c2:${esc(String(form.secondary ?? '#ffffff'))}">` +
    `<div class="ce-teamhead">${logoSrc ? `<img src="${esc(logoSrc)}" alt="" />` : `<span class="ce-abbr">${esc(String(form.abbr || '???'))}</span>`}<div><b>${esc(String(form.name || '（隊名）'))}</b><small>${esc(
      String(form.group ?? ''),
    )}・評分 ${teamRating(team)}</small></div></div>` +
    `<ol class="ce-roster">${team.players.map(line).join('')}</ol></div>` +
    '<p class="fine left">快速模式、街頭和自訂分組的活動會用到這支隊伍。</p>'
  );
}

function previewHtml(): string {
  if (kind === 'team') return teamPreview();
  if (kind === 'card') {
    if (!form.player) return '<p class="fine">填上球員名字就會出現卡面。</p>';
    const c = previewSpecial({ ...(form as unknown as SpecialRow), id: String(form.id || 'new') }, special.themes);
    return (
      `<div class="ce-cardview">${cardHtml(c, { cls: 'big' })}</div><p class="fine">${tier(c.tier).name}卡 · ${c.position} · ${c.heightM.toFixed(2)} m</p>` +
      `<div class="mtratings">${RATING_KEYS.map((k, i) => `<span>${RATING_LABEL[k]}<b>${c.ratings[i]}</b></span>`).join('')}</div>`
    );
  }
  if (kind === 'theme') {
    const id = String(form.id || 'preview');
    const rows = special.cards.filter((c) => c.theme === current);
    const sample: SpecialRow[] = rows.length ? rows.slice(0, 3) : [{ id: 'sample', player: 'LeBron James', team: 'LAL', ovr: 97, theme: id }];
    return `<div class="ce-cardrow">${sample
      .map((s) => cardHtml(previewSpecial({ ...s, theme: id, label: form.name ? String(form.name) : s.label }, themesWithForm()), { cls: 'small' }))
      .join('')}</div>${rows.length ? '' : '<p class="fine">這個主題還沒有卡（上面是示意）。</p>'}`;
  }
  if (kind === 'holiday') {
    const h = form as unknown as HolidayDef;
    const base = periodLevels(period)[1]?.ovr ?? 75;
    const rows = (h.levels ?? [])
      .map((lv, i) => {
        let names = '';
        try {
          names = eventTeam(h, i, base)
            .players.slice(0, lv.size)
            .map((p) => esc(p.name))
            .join('、');
        } catch {
          names = '（挑不到球員）';
        }
        const r = lv.reward ?? {};
        const reward = [r.coins ? `${r.coins} 金幣` : '', r.pack ? (myteam.packs.find((p) => p.id === r.pack)?.name ?? r.pack) : '', r.cards?.length ? `卡 ${r.cards.join('／')}` : '']
          .filter(Boolean)
          .join('＋');
        return `<li><b>第 ${i + 1} 關・${lv.size}v${lv.size}・評分 ${Math.min(99, base + Number(lv.offset || 0))}・${DIFFICULTY_LABEL[lv.difficulty] ?? lv.difficulty}</b><span>${names}</span><span>首勝：${esc(reward || '—')}</span></li>`;
      })
      .join('');
    return (
      `<div class="row"><label>用第幾期的評分看<select id="cePeriod">${Array.from({ length: PERIODS }, (_, i) => i + 1)
        .map((p) => opt(String(p), `第 ${p} 期`, String(period)))
        .join('')}</select></label></div>` +
      `<p class="fine left">每年 ${esc(String(h.from ?? ''))} 到 ${esc(String(h.to ?? ''))}，依序打，每關每年領一次獎勵。</p><ol class="ce-levels">${rows}</ol>`
    );
  }
  const p = form as unknown as PackDef;
  let odds: { tier: string; chance: number }[] = [];
  let pool: { name: string; ovr: number; tier: string; label: string }[] = [];
  try {
    odds = packOdds(p);
    pool = packPool(p);
  } catch {
    // A half-filled pack.
  }
  if (!pool.length) return '<p class="fine">這個卡包現在開不出任何卡（限定卡包沒有節日主題時、復刻沒有舊球季時都是這樣）。</p>';
  const best = [...pool].sort((a, b) => b.ovr - a.ovr).slice(0, 12);
  return (
    `<div class="oddsbar">${odds.map((o) => `<i style="--tier:${tier(o.tier as never).color};flex:${o.chance}"></i>`).join('')}</div>` +
    `<p class="odds">${odds.map((o) => `${tier(o.tier as never).name} ${(o.chance * 100).toFixed(o.chance < 0.1 ? 1 : 0)}%`).join('・')}</p>` +
    `<p class="fine left">現在能開出 ${pool.length} 張卡，最好的幾張：${best.map((c) => `${esc(c.name)} ${c.ovr}（${esc(c.label)}）`).join('、')}</p>`
  );
}

// ----------------------------------------------------------------- render

function listHtml(): string {
  const rows = listOf()
    .map((e) => {
      const id = keyOf(e);
      const label =
        kind === 'card'
          ? `${esc(String(e.player))} ${e.ovr}`
          : kind === 'theme'
            ? esc(String(e.name))
            : kind === 'holiday'
              ? `${esc(String(e.name))}（${e.from}～${e.to}）`
              : kind === 'team'
                ? `${esc(String(e.name))}<small> ${esc(String(e.group ?? ''))}</small>`
                : `${esc(String(e.name))} ${e.price}${e.hidden ? '<small> 隱藏</small>' : ''}`;
      return `<button type="button" class="ce-item${current === id ? ' on' : ''}" data-open="${esc(id)}"><b>${label}</b><small>${esc(id)}</small></button>`;
    })
    .join('');
  return `<div class="ce-list">${rows}<button type="button" class="ce-item new${current === '' ? ' on' : ''}" data-open="">＋ 新增${KINDS.find(([k]) => k === kind)![1]}</button></div>`;
}

function checksHtml(): string {
  return (
    (problems.length ? `<ul class="ce-errors">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '') +
    (warnings.length ? `<ul class="ce-warnings">${warnings.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '')
  );
}

export function renderEditor(): void {
  wire();
  const body = $('#ceBody');
  const editing = current !== null;
  body.innerHTML =
    `<nav class="tabs">${KINDS.map(([k, l]) => `<button type="button" data-kind="${k}" class="${k === kind ? 'on' : ''}">${l}</button>`).join('')}</nav>` +
    (message ? `<p class="msg">${esc(message)}</p>` : '') +
    `<p class="fine left">開發用：存檔會直接改 shared/data 裡的 JSON（圖片放進 client/public/cards/），頁面會重新整理。確認沒問題再 commit、push 上線。</p>` +
    `<div class="cols mtcols ce-cols"><div class="col">${listHtml()}</div><div class="col">${
      editing
        ? `<div class="ce-form">${formHtml()}</div><div id="ceChecks">${checksHtml()}</div>` +
          `<div class="mtplay ce-actions"><button type="button" class="small go" data-act="save">存檔</button>${
            current
              ? confirmDelete
                ? `<span class="confirm">確定刪除？${kind === 'card' ? `已擁有這張卡的玩家會留著它（變成「舊版」，之後抽不到）。${form.image === `${form.id}.webp` ? '圖片也會一起刪掉。' : ''}` : ''}<button type="button" class="small danger" data-act="delete">確定刪除</button><button type="button" class="small" data-act="nodelete">取消</button></span>`
                : '<button type="button" class="small" data-act="askdelete">刪除</button>'
              : ''
          }</div>` +
          `<h3 class="mth">預覽</h3><div id="cePreview">${previewHtml()}</div>`
        : '<p class="fine mtnodetail">左邊選一筆來改，或按「新增」。</p>'
    }</div></div>`;
  afterPreview();
  drawCrop();
}

/** Redraws only the preview and checks (typing keeps its focus). */
function refreshPreview(): void {
  const el = document.querySelector<HTMLElement>('#cePreview');
  if (!el) return;
  el.innerHTML = previewHtml();
  afterPreview();
}

function afterPreview(): void {
  const el = document.querySelector<HTMLElement>('#cePreview');
  if (!el) return;
  if (kind === 'theme') {
    // The card face reads the saved theme: show the colours being edited.
    el.querySelectorAll<HTMLElement>('.mtcard').forEach((card) => {
      card.classList.add('themed');
      card.style.setProperty('--tier', String(form.color ?? '#888888'));
      card.style.setProperty('--accent2', String(form.accent ?? '#ffffff'));
    });
    hydrateCards(el, special.cards.filter((c) => c.theme === current).slice(0, 3).map((c) => previewSpecial(c, special.themes)));
  }
  if (kind === 'card' && form.player) {
    const c = previewSpecial({ ...(form as unknown as SpecialRow), id: String(form.id || 'new') }, special.themes);
    if (picture) {
      // The cropped picture, not saved yet.
      el.querySelector('.mtc-photo')?.classList.add('art');
      const img = el.querySelector<HTMLImageElement>('img.mtc-img');
      if (img) img.src = picture;
    } else hydrateCards(el, [c]);
  }
}

// ----------------------------------------------------------------- picture

function drawCrop(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#ceCrop');
  if (!canvas || !crop) return;
  paint(canvas, 1);
}

/** Draws the picture cover-fitted to a 5:7 frame, zoomed and moved; `scale` = output size / 200 px. */
function paint(canvas: HTMLCanvasElement, scale: number): void {
  if (!crop) return;
  const ctx = canvas.getContext('2d')!;
  const w = 200 * scale;
  const h = 280 * scale;
  const fit = Math.max(w / crop.img.width, h / crop.img.height) * crop.zoom;
  const dw = crop.img.width * fit;
  const dh = crop.img.height * fit;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(crop.img, (w - dw) / 2 + crop.x * scale, (h - dh) / 2 + crop.y * scale, dw, dh);
}

function updatePicture(): void {
  if (!crop) return;
  const out = document.createElement('canvas');
  out.width = 400;
  out.height = 560;
  paint(out, 2);
  picture = out.toDataURL('image/webp', 0.9);
  if (form.id) form.image = `${form.id}.webp`;
  refreshPreview();
}

/** A team logo: fitted (not cropped) into 256x256, transparency kept, as webp. */
function loadLogo(file: File): void {
  const img = new Image();
  img.onload = () => {
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    const s = Math.min(256 / img.width, 256 / img.height);
    out.getContext('2d')!.drawImage(img, (256 - img.width * s) / 2, (256 - img.height * s) / 2, img.width * s, img.height * s);
    logoPic = out.toDataURL('image/webp', 0.92);
    form.logo = logoPath(String(form.abbr));
    renderEditor();
  };
  img.src = URL.createObjectURL(file);
}

function loadPicture(file: File): void {
  const img = new Image();
  img.onload = () => {
    crop = { img, zoom: 1, x: 0, y: 0 };
    renderEditor();
    updatePicture();
  };
  img.src = URL.createObjectURL(file);
}

// ----------------------------------------------------------------- saving

/** Each kind's keys in file order (the rest after them). */
const KEY_ORDER: Record<Kind, string[]> = {
  card: ['id', 'player', 'team', 'ovr', 'theme', 'label', 'position', 'heightM', 'number', 'style', 'look', 'image'],
  theme: ['id', 'name', 'color', 'accent', 'levelOnly'],
  holiday: ['id', 'name', 'desc', 'from', 'to', 'theme', 'levels'],
  pack: ['id', 'name', 'price', 'count', 'kind', 'hidden', 'tiers', 'positions', 'players', 'guarantee', 'weights'],
  team: ['group', 'abbr', 'name', 'primary', 'secondary', 'logo', 'players'],
};

function ordered(e: Entry): Entry {
  const keys = [...KEY_ORDER[kind].filter((k) => k in e), ...Object.keys(e).filter((k) => !KEY_ORDER[kind].includes(k))];
  return Object.fromEntries(keys.map((k) => [k, clone(e[k])]));
}

/** The files with the form put in (or the entry taken out). */
function withForm(remove = false): { special: SpecialFile; myteam: ContentMyTeam; custom: CustomFile } {
  const s = clone(special);
  const m = clone(myteam);
  const c = clone(custom);
  const list = listIn(kind, s, m, c);
  const at = current ? list.findIndex((e) => keyOf(e) === current) : -1;
  if (remove) {
    if (at >= 0) list.splice(at, 1);
  } else if (at >= 0) list[at] = ordered(form);
  else list.push(ordered(form));
  return { special: s, myteam: m, custom: c };
}

/** The logo the editor makes for a team: logos/custom/<abbr>.webp. */
const logoPath = (abbr: string) => `custom/${abbr.toLowerCase()}.webp`;

async function post(path: string, body: unknown): Promise<{ ok?: boolean; error?: string; images?: string[] }> {
  const res = await fetch(`/__content/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

async function save(remove = false): Promise<void> {
  if (!remove && kind === 'card' && picture && form.id) form.image = `${form.id}.webp`;
  if (!remove && kind === 'team' && logoPic && form.abbr) form.logo = logoPath(String(form.abbr));
  const next = withForm(remove);
  const known = new Set(images);
  if (!remove && picture && form.image) known.add(String(form.image));
  const knownLogos = new Set(logos);
  if (!remove && logoPic && form.logo) knownLogos.add(String(form.logo));
  // Events pick opponents from custom-team groups: check them against the teams about to be saved.
  const groups = new Set([...next.custom.teams.map((t) => t.group).filter((g): g is string => !!g)]);
  const result = checkContent(next.special, next.myteam, known, groups);
  problems = [...result.errors, ...(kind === 'team' ? validateCustomTeams(next.custom, NBA_TEAMS, knownLogos) : [])];
  warnings = result.warnings;
  if (problems.length) {
    message = remove ? '不能刪除：' : '還不能存檔，先修正下面的問題：';
    renderEditor();
    return;
  }
  try {
    if (!remove && picture && form.image) {
      const r = await post('image', { name: form.image, data: picture });
      if (!r.ok) throw new Error(r.error);
    }
    // A deleted card takes its picture along (one the editor made, named after it); before the save, whose reload would cut it off.
    if (remove && kind === 'card' && form.image === `${form.id}.webp`) await post('unimage', { name: form.image });
    if (!remove && kind === 'team' && logoPic && form.logo) {
      const r = await post('logo', { name: form.logo, data: logoPic });
      if (!r.ok) throw new Error(r.error);
    }
    if (remove && kind === 'team' && form.logo === logoPath(String(form.abbr))) await post('unlogo', { name: form.logo });
    const file = kind === 'card' || kind === 'theme' ? 'special' : kind === 'team' ? 'custom' : 'myteam';
    const text =
      file === 'special' ? formatJson(next.special, CONTENT_WIDTH.special) : file === 'custom' ? formatCustomTeams(next.custom).trimEnd() : formatJson(next.myteam, CONTENT_WIDTH.myteam);
    // Reopen here after the reload the saved file brings.
    sessionStorage.setItem('webnba.editor', JSON.stringify({ kind, id: remove ? null : keyOf(form) }));
    const r = await post('save', { file, text: `${text}\n` });
    if (!r.ok) throw new Error(r.error);
    special = next.special;
    myteam = next.myteam;
    custom = next.custom;
    picture = null;
    crop = null;
    logoPic = null;
    confirmDelete = false;
    current = remove ? null : keyOf(form);
    message = `${remove ? '已刪除' : '已存檔'}${warnings.length ? '（有提醒，見下方）' : ''}，頁面重新整理後生效。記得 commit、push。`;
    renderEditor();
  } catch (e) {
    message = `存檔失敗：${(e as Error).message}（要用 npm run dev 開，而且只能在這台電腦）`;
    renderEditor();
  }
}

// ----------------------------------------------------------------- events

function open(id: string | null): void {
  current = id;
  const found = id ? listOf().find((e) => keyOf(e) === id) : undefined;
  form = found ? clone(found) : blank(kind);
  if (id === '') current = '';
  picture = null;
  crop = null;
  logoPic = null;
  openPlayer = null;
  confirmDelete = false;
  problems = [];
  warnings = [];
}

function wire(): void {
  if (wired) return;
  wired = true;
  const body = $('#ceBody');
  body.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const data = (attr: string) => el.closest<HTMLElement>(`[${attr}]`)?.getAttribute(attr) ?? null;
    const act = data('data-act');
    if (data('data-kind')) {
      kind = data('data-kind') as Kind;
      current = null;
      message = '';
    } else if (data('data-open') !== null) {
      open(data('data-open'));
      message = '';
    } else if (data('data-chip')) {
      const path = data('data-chip')!;
      const v = data('data-v')!;
      const list = (getPath(form, path) as string[] | undefined) ?? [];
      setPath(form, path, list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    } else if (act === 'addlevel') {
      const levels = (form.levels as unknown[]) ?? [];
      form.levels = [...levels, { size: 5, offset: 3, difficulty: 'hard', reward: { coins: 500 }, pick: {} }];
    } else if (act === 'dellevel') {
      const levels = (form.levels as unknown[]) ?? [];
      levels.splice(Number(data('data-i')), 1);
    } else if (act === 'themecards') {
      const levels = (form.levels as Entry[]) ?? [];
      const last = levels[levels.length - 1];
      const ids = special.cards.filter((c) => c.theme === form.theme).map((c) => `x-${c.id}`);
      if (last && ids.length) setPath(last, 'reward.cards', ids);
      else message = '這個主題還沒有特殊卡。';
    } else if (act === 'nopic') {
      picture = null;
      crop = null;
      delete form.image;
    } else if (act && ['ratings', 'up', 'down', 'delplayer', 'addplayer', 'genratings', 'nologo'].includes(act) && kind === 'team') {
      const players = (form.players as RawPlayer[]) ?? [];
      const i = Number(data('data-i'));
      if (act === 'ratings') openPlayer = openPlayer === i ? null : i;
      else if (act === 'up' || act === 'down') {
        const j = act === 'up' ? i - 1 : i + 1;
        if (j >= 0 && j < players.length) {
          [players[i], players[j]] = [players[j], players[i]];
          if (openPlayer === i) openPlayer = j;
        }
      } else if (act === 'delplayer') {
        players.splice(i, 1);
        openPlayer = null;
      } else if (act === 'addplayer') {
        players.push([`新球員${players.length + 1}`, players.length + 1, 1.98, 'SF', ratingsFor('SF', 'allround', 1.98, 70)]);
        openPlayer = players.length - 1;
      } else if (act === 'genratings') {
        const p = players[i];
        const style = (document.querySelector<HTMLSelectElement>('#ceGenStyle')?.value ?? 'allround') as ArchetypeId;
        const ovr = Number(document.querySelector<HTMLInputElement>('#ceGenOvr')?.value) || 70;
        if (p) p[4] = ratingsFor(p[3] as Position, style, p[2], Math.max(40, Math.min(99, ovr)));
      } else if (act === 'nologo') {
        logoPic = null;
        delete form.logo;
      }
      form.players = players;
    } else if (act === 'askdelete') confirmDelete = true;
    else if (act === 'nodelete') confirmDelete = false;
    else if (act === 'save') {
      void save();
      return;
    } else if (act === 'delete') {
      void save(true);
      return;
    } else return;
    renderEditor();
  });
  const onInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    // A player's field or rating (team form).
    if (el.dataset.p || el.dataset.r) {
      const players = (form.players as RawPlayer[]) ?? [];
      const [i, j] = (el.dataset.p ?? el.dataset.r)!.split(':').map(Number);
      const p = players[i];
      if (!p) return;
      if (el.dataset.r) p[4][j] = Number(el.value);
      else if (j === 0 || j === 3) (p as unknown[])[j] = el.value;
      else (p as unknown[])[j] = Number(el.value);
      if (e.type === 'change') renderEditor();
      else {
        refreshPreview();
        const ovr = el.closest('.ce-player')?.querySelector('.ce-ovr') ?? el.closest('.ce-ratings')?.previousElementSibling?.querySelector('.ce-ovr');
        if (ovr) ovr.textContent = String(playerOvr(p));
      }
      return;
    }
    if (el.id === 'ceZoom' && crop) {
      crop.zoom = Number(el.value);
      drawCrop();
      updatePicture();
      return;
    }
    if (el.id === 'cePeriod') {
      period = Number(el.value);
      refreshPreview();
      return;
    }
    const path = el.dataset.f;
    if (!path) return;
    const t = el.dataset.t;
    const value =
      t === 'bool'
        ? el.checked || undefined
        : t === 'number'
          ? el.value === ''
            ? undefined
            : Number(el.value)
          : t === 'list'
            ? el.value
                .split(/[,，]/)
                .map((x) => x.trim())
                .filter(Boolean)
            : el.value;
    setPath(form, path, value);
    // A new player name may need the extra fields; a select changes what is shown.
    if (e.type === 'change' && (el.tagName === 'SELECT' || path === 'player' || t === 'bool')) renderEditor();
    else refreshPreview();
  };
  body.addEventListener('input', onInput);
  body.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id === 'ceLogo' && el.files?.[0]) {
      if (!form.abbr) {
        message = '先填縮寫再選隊徽（隊徽用縮寫命名）。';
        renderEditor();
        return;
      }
      loadLogo(el.files[0]);
      return;
    }
    if (el.id === 'cePic' && el.files?.[0]) {
      if (!form.id) {
        message = '先填 id 再選圖片（圖片用 id 命名）。';
        renderEditor();
        return;
      }
      loadPicture(el.files[0]);
      return;
    }
    onInput(e);
  });
  // Dragging the picture in the crop frame.
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  body.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).id !== 'ceCrop' || !crop) return;
    drag = { x: e.clientX, y: e.clientY, cx: crop.x, cy: crop.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag || !crop) return;
    crop.x = drag.cx + e.clientX - drag.x;
    crop.y = drag.cy + e.clientY - drag.y;
    drawCrop();
  });
  body.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    updatePicture();
  });
}

/** Opens the editor (after a save's reload: on the entry that was saved). */
export async function openEditor(): Promise<void> {
  try {
    const res = await fetch('/__content/images');
    if (res.ok) images = new Set((await res.json()) as string[]);
    const got = await fetch('/__content/logos');
    if (got.ok) logos = new Set((await got.json()) as string[]);
  } catch {
    // No dev server: saving will say so.
  }
  const back = sessionStorage.getItem('webnba.editor');
  if (back) {
    sessionStorage.removeItem('webnba.editor');
    const { kind: k, id } = JSON.parse(back) as { kind: Kind; id: string | null };
    kind = k;
    if (id) open(id);
    message = '已存檔並重新載入。記得 commit、push。';
  }
  renderEditor();
}
