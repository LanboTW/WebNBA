import { POSITIONS, RATING_KEYS, playerRating, type PlayerInfo, type Position, type StatLine, type TeamInfo } from '@webnba/shared';
import { esc } from './boxscore';
import { RATING_LABEL } from './careerCreate';
import { logoHtml } from './logos';

/**
 * The player database: every player of a team, a group of teams or the whole
 * league, with all ratings (or this season's numbers) and sortable columns.
 * Used from the main menu (real rosters) and inside a career (its league).
 */

export interface DbSource {
  /** Tabs of teams, e.g. 東區 / 西區 / 台灣. */
  groups: Map<string, TeamInfo[]>;
  age: (p: PlayerInfo, team: TeamInfo) => number | null;
  /** This season's per-game line, when there is a season. */
  line?: (p: PlayerInfo, team: TeamInfo) => StatLine | undefined;
  /** His name, highlighted. */
  me?: string;
}

type View = 'ratings' | 'stats';
type SortKey = 'name' | 'team' | 'pos' | 'height' | 'age' | 'ovr' | (typeof RATING_KEYS)[number] | StatCol;
type StatCol = 'gp' | 'min' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk';

const STAT_COLS: [StatCol, string][] = [
  ['gp', '場數'],
  ['min', '分鐘'],
  ['pts', '得分'],
  ['reb', '籃板'],
  ['ast', '助攻'],
  ['stl', '抄截'],
  ['blk', '阻攻'],
];

interface Row {
  p: PlayerInfo;
  t: TeamInfo;
  ovr: number;
  age: number | null;
  line?: StatLine;
}

/** The look of a rating: elite, good, average or weak. */
const tier = (v: number) => (v >= 90 ? 'r-elite' : v >= 80 ? 'r-good' : v >= 65 ? '' : 'r-weak');

export class PlayerDb {
  /** Where the view is; kept across re-mounts (the career hub redraws its page). */
  private scope = 'all';
  private pos: Position | 'all' = 'all';
  private query = '';
  private view: View = 'ratings';
  private sort: SortKey = 'ovr';
  private desc = true;
  private source: DbSource | null = null;
  private table: HTMLElement | null = null;

  /** Draws into `root` (replacing what is there) from `source`. */
  mount(root: HTMLElement, source: DbSource): void {
    this.source = source;
    if (!source.line) this.view = 'ratings';
    const scopes = this.scopes();
    if (!scopes.some(([k]) => k === this.scope)) this.scope = 'all';
    const opts = (list: [string, string][]) => list.map(([k, l]) => `<option value="${esc(k)}"${k === this.scope ? ' selected' : ''}>${esc(l)}</option>`).join('');
    const groups = [...source.groups.keys()];
    root.innerHTML =
      `<div class="dbbar">` +
      `<select data-db="scope"><optgroup label="範圍">${opts(scopes.filter(([k]) => !k.startsWith('team:')))}</optgroup>` +
      groups.map((g) => `<optgroup label="${esc(g)}">${opts(scopes.filter(([k]) => k.startsWith('team:') && this.groupOfTeam(k.slice(5)) === g))}</optgroup>`).join('') +
      `</select>` +
      `<input type="search" data-db="query" placeholder="搜尋球員" value="${esc(this.query)}" />` +
      `<nav class="chips">${(['all', ...POSITIONS] as const).map((p) => `<button type="button" data-pos="${p}" class="chip${p === this.pos ? ' on' : ''}">${p === 'all' ? '全部位置' : p}</button>`).join('')}</nav>` +
      (source.line
        ? `<nav class="chips">${(
            [
              ['ratings', '能力值'],
              ['stats', '本季數據'],
            ] as const
          )
            .map(([v, l]) => `<button type="button" data-view="${v}" class="chip${v === this.view ? ' on' : ''}">${l}</button>`)
            .join('')}</nav>`
        : '') +
      `</div><div class="tablewrap dbwrap"></div>`;
    this.table = root.querySelector('.dbwrap');
    root.querySelector<HTMLSelectElement>('[data-db="scope"]')!.addEventListener('change', (e) => {
      this.scope = (e.target as HTMLSelectElement).value;
      this.drawTable();
    });
    root.querySelector<HTMLInputElement>('[data-db="query"]')!.addEventListener('input', (e) => {
      this.query = (e.target as HTMLInputElement).value;
      this.drawTable();
    });
    root.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const pos = el.closest<HTMLElement>('[data-pos]')?.dataset.pos;
      const view = el.closest<HTMLElement>('[data-view]')?.dataset.view as View | undefined;
      const sort = el.closest<HTMLElement>('[data-sort]')?.dataset.sort as SortKey | undefined;
      if (pos) {
        this.pos = pos as Position | 'all';
        root.querySelectorAll<HTMLElement>('[data-pos]').forEach((b) => b.classList.toggle('on', b.dataset.pos === pos));
      } else if (view) {
        this.view = view;
        if (!this.columns().some(([k]) => k === this.sort)) this.sort = 'ovr';
        root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
      } else if (sort) {
        // Same column again flips the order; names and teams start A-Z, numbers high first.
        if (sort === this.sort) this.desc = !this.desc;
        else {
          this.sort = sort;
          this.desc = !['name', 'team', 'pos'].includes(sort);
        }
      } else return;
      this.drawTable();
    });
    this.drawTable();
  }

  private groupOfTeam(abbr: string): string | undefined {
    for (const [g, teams] of this.source!.groups) if (teams.some((t) => t.abbr === abbr)) return g;
    return undefined;
  }

  /** [value, label]: everyone, each group, then each team. */
  private scopes(): [string, string][] {
    const groups = [...this.source!.groups];
    return [
      ['all', '所有球員'],
      ...groups.map(([g]) => [`group:${g}`, `${g}全部`] as [string, string]),
      ...groups.flatMap(([, teams]) => teams.map((t) => [`team:${t.abbr}`, `${t.name}（${t.abbr}）`] as [string, string])),
    ];
  }

  private columns(): [SortKey, string][] {
    const base: [SortKey, string][] = [
      ['name', '球員'],
      ['team', '球隊'],
      ['pos', '位置'],
      ['height', '身高'],
      ['age', '年齡'],
      ['ovr', '總評'],
    ];
    return this.view === 'stats' ? [...base, ...STAT_COLS] : [...base, ...RATING_KEYS.map((k) => [k, RATING_LABEL[k]] as [SortKey, string])];
  }

  private rows(): Row[] {
    const src = this.source!;
    const [kind, key] = this.scope.includes(':') ? [this.scope.slice(0, this.scope.indexOf(':')), this.scope.slice(this.scope.indexOf(':') + 1)] : ['all', ''];
    const teams = [...src.groups]
      .filter(([g]) => kind !== 'group' || g === key)
      .flatMap(([, list]) => list)
      .filter((t) => kind !== 'team' || t.abbr === key);
    const q = this.query.trim().toLowerCase();
    return teams.flatMap((t) =>
      t.players
        .filter((p) => (this.pos === 'all' || p.position === this.pos) && (!q || p.name.toLowerCase().includes(q)))
        .map((p) => ({ p, t, ovr: playerRating(p), age: src.age(p, t), line: src.line?.(p, t) })),
    );
  }

  private value(r: Row, k: SortKey): number | string {
    switch (k) {
      case 'name':
        return r.p.name;
      case 'team':
        return r.t.abbr;
      case 'pos':
        return POSITIONS.indexOf(r.p.position);
      case 'height':
        return r.p.heightM;
      case 'age':
        return r.age ?? -1;
      case 'ovr':
        return r.ovr;
      case 'gp':
      case 'min':
      case 'pts':
      case 'reb':
      case 'ast':
      case 'stl':
      case 'blk':
        return r.line?.[k] ?? -1;
      default:
        return r.p.ratings[k];
    }
  }

  private drawTable(): void {
    if (!this.table) return;
    const cols = this.columns();
    const rows = this.rows().sort((a, b) => {
      const x = this.value(a, this.sort);
      const y = this.value(b, this.sort);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return (this.desc ? -c : c) || b.ovr - a.ovr || a.p.name.localeCompare(b.p.name);
    });
    const head = cols
      .map(([k, l]) => `<th data-sort="${k}" class="${k === this.sort ? `sorted ${this.desc ? 'desc' : 'asc'}` : ''}">${l}</th>`)
      .join('');
    const me = this.source!.me;
    const f1 = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(1));
    const body = rows
      .map((r) => {
        const cells =
          this.view === 'stats'
            ? STAT_COLS.map(([k]) => `<td>${r.line ? (k === 'gp' ? r.line.gp : f1(r.line[k])) : '—'}</td>`).join('')
            : RATING_KEYS.map((k) => `<td class="${tier(r.p.ratings[k])}">${r.p.ratings[k]}</td>`).join('');
        return (
          `<tr class="${r.p.name === me ? 'me' : ''}"><td class="dbname">${esc(r.p.name)}</td>` +
          `<td class="dbteam">${logoHtml(r.t, 'slogo')}${esc(r.t.abbr)}</td><td>${r.p.position}</td>` +
          `<td>${Math.round(r.p.heightM * 100)}</td><td>${r.age ?? '—'}</td><td class="dbovr ${tier(r.ovr)}">${r.ovr}</td>${cells}</tr>`
        );
      })
      .join('');
    this.table.innerHTML = rows.length
      ? `<table class="standings dbtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><p class="sub tight">${rows.length} 名球員 · 點欄位標題排序</p>`
      : `<p class="sub tight">沒有符合的球員。</p>`;
  }
}
