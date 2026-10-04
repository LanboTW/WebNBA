import {
  AGE_RANGE,
  ARCHETYPES,
  DEFAULT_CAREER_SETTINGS,
  HEIGHT_RANGE,
  POSITIONS,
  RATING_KEYS,
  archetype,
  playerRating,
  randomLook,
  startingRatings,
  type ArchetypeId,
  type CareerSettings,
  type Look,
  type PlayerInfo,
  type Position,
  type Ratings,
} from '@webnba/shared';
import { esc } from './boxscore';
import { skinColor } from './playerModel';

export const RATING_LABEL: Record<keyof Ratings, string> = {
  speed: '速度',
  jump: '彈跳',
  close: '禁區',
  mid: '中距離',
  three: '三分',
  ft: '罰球',
  handle: '運球',
  pass: '傳球',
  steal: '抄截',
  block: '阻攻',
  defense: '防守',
  rebound: '籃板',
  stamina: '體力',
};

export const POSITION_LABEL: Record<Position, string> = {
  PG: '控球後衛',
  SG: '得分後衛',
  SF: '小前鋒',
  PF: '大前鋒',
  C: '中鋒',
};

type LookKey = keyof Look;
export interface LookField {
  key: LookKey;
  label: string;
  options: [Look[LookKey], string][];
  swatch?: boolean;
}

export const HAIR_COLORS = ['#1d1612', '#4a2f1d', '#8a5a2b', '#d9b26a', '#b5482a', '#9a9a9a', '#ececec'];

export const LOOK_FIELDS: LookField[] = [
  { key: 'skin', label: '膚色', swatch: true, options: [1, 2, 3, 4, 5, 6].map((n) => [n, skinColor(n)]) },
  {
    key: 'hair',
    label: '髮型',
    options: [
      ['bald', '光頭'],
      ['buzz', '平頭'],
      ['short', '短髮'],
      ['afro', '爆炸頭'],
      ['twists', '扭轉辮'],
      ['dreads', '髒辮'],
      ['long', '長髮'],
      ['mohawk', '莫霍克'],
    ],
  },
  { key: 'hairColor', label: '髮色', swatch: true, options: HAIR_COLORS.map((c) => [c, c]) },
  {
    key: 'beard',
    label: '鬍子',
    options: [
      ['none', '無'],
      ['stubble', '鬍渣'],
      ['full', '落腮鬍'],
    ],
  },
  {
    key: 'headband',
    label: '頭帶',
    options: [
      [false, '無'],
      [true, '有'],
    ],
  },
  {
    key: 'sleeve',
    label: '袖套',
    options: [
      ['none', '無'],
      ['left', '左手'],
      ['right', '右手'],
      ['both', '雙手'],
    ],
  },
  {
    key: 'kneepad',
    label: '護膝',
    options: [
      [false, '無'],
      [true, '有'],
    ],
  },
  {
    key: 'shoe',
    label: '球鞋',
    options: [
      ['white', '白'],
      ['black', '黑'],
      ['team', '隊色'],
    ],
  },
  {
    key: 'socks',
    label: '襪子',
    options: [
      ['low', '短襪'],
      ['high', '長襪'],
    ],
  },
];

export interface CreateDraft {
  name: string;
  number: number;
  position: Position;
  heightM: number;
  archetype: ArchetypeId;
  age: number;
  look: Look;
  settings: CareerSettings;
}

const cm = (m: number) => Math.round(m * 100);
const feet = (m: number) => {
  const inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
};

function freshDraft(): CreateDraft {
  const position: Position = 'SF';
  const [lo, hi] = HEIGHT_RANGE[position];
  return {
    name: '',
    number: Math.floor(Math.random() * 100),
    position,
    heightM: Math.round(((lo + hi) / 2) * 100) / 100,
    archetype: 'allround',
    age: 20,
    look: { ...randomLook(), hairColor: HAIR_COLORS[0] },
    settings: { ...DEFAULT_CAREER_SETTINGS },
  };
}

/**
 * The create-a-player form. Every change re-renders the form and reports the
 * player as he would be, so the court behind it can show him.
 */
export class CreateForm {
  draft = freshDraft();

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (player: PlayerInfo) => void,
  ) {
    root.addEventListener('click', (e) => this.click(e));
    root.addEventListener('input', (e) => this.input(e));
    root.addEventListener('change', (e) => this.input(e));
  }

  reset(): void {
    this.draft = freshDraft();
    this.render();
    this.changed();
  }

  /** The player as the form stands (what the preview shows). */
  get player(): PlayerInfo {
    const d = this.draft;
    return {
      name: d.name.trim() || '新秀',
      number: d.number,
      heightM: d.heightM,
      position: d.position,
      ratings: startingRatings(d.position, d.archetype, d.heightM),
      look: { ...d.look },
    };
  }

  /** What's wrong with the form, or null when it's ready. */
  problem(): string | null {
    const name = this.draft.name.trim();
    if (!name) return '請輸入球員名字';
    if (!/^[A-Za-z][A-Za-z .'-]{0,23}$/.test(name)) return '名字請用英文字母（可含空白 . \' -），最多 24 個字';
    return null;
  }

  private changed(): void {
    this.onChange(this.player);
  }

  private click(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-set]');
    if (!b) return;
    const d = this.draft;
    const value = JSON.parse(b.dataset.value!);
    const [group, key] = b.dataset.set!.split('.');
    if (group === 'look') (d.look as unknown as Record<string, unknown>)[key] = value;
    else if (key === 'position') this.setPosition(value);
    else if (key === 'archetype') d.archetype = value;
    else if (key === 'age') d.age = value;
    else if (key === 'random') d.look = { ...randomLook(), hairColor: HAIR_COLORS[Math.floor(Math.random() * 3)] };
    this.render();
    this.changed();
  }

  private setPosition(pos: Position): void {
    const d = this.draft;
    const [lo, hi] = HEIGHT_RANGE[d.position];
    const share = (d.heightM - lo) / (hi - lo);
    d.position = pos;
    const [nlo, nhi] = HEIGHT_RANGE[pos];
    d.heightM = Math.round((nlo + share * (nhi - nlo)) * 100) / 100;
    if (!archetype(d.archetype).positions.includes(pos)) d.archetype = 'allround';
  }

  private input(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const d = this.draft;
    switch (el.name) {
      case 'name':
        d.name = el.value;
        // Keep focus while typing: only the parts that show the name change.
        this.changed();
        return;
      case 'number': {
        const n = Math.round(Number(el.value));
        if (Number.isFinite(n)) d.number = Math.max(0, Math.min(99, n));
        if (e.type === 'change') el.value = String(d.number);
        this.changed();
        return;
      }
      case 'height':
        d.heightM = Number(el.value) / 100;
        this.root.querySelector('#heightOut')!.textContent = `${cm(d.heightM)} cm（${feet(d.heightM)}）`;
        this.renderRatings();
        this.changed();
        return;
      case 'difficulty':
        d.settings.difficulty = el.value as CareerSettings['difficulty'];
        return;
      case 'quarter':
        d.settings.quarterSeconds = Number(el.value);
        return;
      case 'games':
        d.settings.seasonGames = Number(el.value);
        return;
      case 'playoffs':
        d.settings.playoffs = el.value as CareerSettings['playoffs'];
        return;
    }
  }

  private chips<T>(set: string, current: T, options: [T, string][], swatch = false, disabled?: (v: T) => boolean): string {
    return (
      `<div class="chips${swatch ? ' swatches' : ''}">` +
      options
        .map(([v, label]) => {
          const on = v === current ? ' on' : '';
          const off = disabled?.(v) ? ' disabled' : '';
          const body = swatch ? `<i style="background:${label}"></i>` : esc(label);
          return `<button type="button" class="chip${on}" data-set="${set}" data-value='${esc(JSON.stringify(v))}'${off} title="${swatch ? '' : esc(label)}">${body}</button>`;
        })
        .join('') +
      '</div>'
    );
  }

  render(): void {
    const d = this.draft;
    const [lo, hi] = HEIGHT_RANGE[d.position];
    const ages: [number, string][] = [];
    for (let a = AGE_RANGE[0]; a <= AGE_RANGE[1]; a++) ages.push([a, `${a} 歲`]);
    const sel = (name: string, value: string | number, options: [string | number, string][]) =>
      `<select name="${name}">${options.map(([v, l]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

    this.root.innerHTML =
      `<h3>基本資料</h3>` +
      `<div class="row"><label class="grow">名字（英文）<input name="name" maxlength="24" autocomplete="off" placeholder="例如 Jason Lin" value="${esc(d.name)}" /></label>` +
      `<label class="narrow">背號<input name="number" type="number" min="0" max="99" value="${d.number}" /></label></div>` +
      `<div class="field"><span>位置</span>${this.chips('p.position', d.position, POSITIONS.map((p) => [p, `${p} ${POSITION_LABEL[p]}`]))}</div>` +
      `<div class="field"><span>身高 <b id="heightOut">${cm(d.heightM)} cm（${feet(d.heightM)}）</b></span>` +
      `<input name="height" type="range" min="${cm(lo)}" max="${cm(hi)}" step="1" value="${cm(d.heightM)}" />` +
      `<small>越高籃板、阻攻越好，速度與運球稍差</small></div>` +
      `<div class="field"><span>年齡</span>${this.chips('p.age', d.age, ages)}<small>越年輕成長期越長；31 歲後開始退步</small></div>` +
      `<h3>球員類型</h3><div class="archetypes">` +
      ARCHETYPES.map((a) => {
        const ok = a.positions.includes(d.position);
        return (
          `<button type="button" class="arch${a.id === d.archetype ? ' on' : ''}" data-set="p.archetype" data-value='"${a.id}"'${ok ? '' : ' disabled'}>` +
          `<b>${a.name}</b><span>${esc(ok ? a.desc : `${a.desc}（這個位置不能選）`)}</span></button>`
        );
      }).join('') +
      `</div>` +
      `<h3>能力<small>起始總評約 60，訓練能提升到虛線的上限</small></h3><div id="ratingBars" class="ratingbars"></div>` +
      `<h3>外觀<button type="button" class="small" data-set="p.random" data-value="0">隨機外觀</button></h3>` +
      LOOK_FIELDS.map((f) => {
        const current = f.key === 'hairColor' ? (d.look.hairColor ?? HAIR_COLORS[0]) : d.look[f.key];
        return `<div class="field look"><span>${f.label}</span>${this.chips(`look.${f.key}`, current, f.options, f.swatch)}</div>`;
      }).join('') +
      `<h3>生涯設定<small>難度建立後不能更改</small></h3>` +
      `<div class="row">` +
      `<label>難度${sel('difficulty', d.settings.difficulty, [
        ['easy', '簡單（經驗值 ×0.8）'],
        ['normal', '普通'],
        ['hard', '困難（經驗值 ×1.25）'],
        ['expert', '專家（經驗值 ×1.5）'],
        ['legend', '名人堂（經驗值 ×1.8）'],
      ])}</label>` +
      `<label>每節長度${sel('quarter', d.settings.quarterSeconds, [
        [60, '1 分鐘'],
        [120, '2 分鐘'],
        [180, '3 分鐘'],
        [300, '5 分鐘'],
        [720, '12 分鐘'],
      ])}</label></div><div class="row">` +
      `<label>例行賽場數${sel('games', d.settings.seasonGames, [
        [14, '14 場'],
        [29, '29 場'],
        [58, '58 場'],
        [82, '82 場'],
      ])}</label>` +
      `<label>季後賽賽制${sel('playoffs', d.settings.playoffs, [
        ['short', '首輪三戰兩勝，之後五戰三勝'],
        ['single', '每輪一場定勝負'],
        ['long', '首輪五戰三勝，之後七戰四勝'],
        ['full', '每輪七戰四勝'],
      ])}</label></div>`;
    this.renderRatings();
  }

  private renderRatings(): void {
    const d = this.draft;
    const r = startingRatings(d.position, d.archetype, d.heightM);
    const caps = archetype(d.archetype).caps;
    const ovr = playerRating({ ...this.player, ratings: r });
    this.root.querySelector('#ratingBars')!.innerHTML =
      `<div class="ovrline">總評 <b>${ovr}</b></div>` +
      RATING_KEYS.map(
        (k) =>
          `<div class="rbar"><span>${RATING_LABEL[k]}</span><div class="track"><i style="width:${r[k]}%"></i><em style="left:${caps[k]}%"></em></div><b>${r[k]}</b></div>`,
      ).join('');
  }
}
