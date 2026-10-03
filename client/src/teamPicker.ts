import { teamRating, type TeamInfo } from '@webnba/shared';
import { esc } from './boxscore';
import { logoHtml } from './logos';

/**
 * Tabs per team group (NBA, Taiwan, ...) over a grid of logo tiles. It edits a
 * <select>, which stays the single source of truth, so a pick fires the same
 * "change" event a dropdown would.
 */
export class TeamPicker {
  private readonly tabs = document.createElement('div');
  private readonly grid = document.createElement('div');
  private target: HTMLSelectElement;
  private group: string;
  disabled = false;

  constructor(
    root: HTMLElement,
    private readonly groups: Map<string, TeamInfo[]>,
    target: HTMLSelectElement,
    /** The select's value for a team (its abbr unless told otherwise). */
    private readonly keyOf: (t: TeamInfo) => string = (t) => t.abbr,
    /** The tile's caption. */
    private readonly labelOf: (t: TeamInfo) => string = (t) => t.abbr,
  ) {
    this.target = target;
    this.group = this.groupOf(target.value);
    this.tabs.className = 'ptabs';
    this.grid.className = 'pgrid';
    root.classList.add('picker');
    root.replaceChildren(this.tabs, this.grid);
    this.tabs.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>('[data-group]');
      if (!tab) return;
      this.group = tab.dataset.group!;
      this.render();
    });
    this.grid.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-abbr]');
      if (!tile || this.disabled || tile.dataset.abbr === this.target.value) return;
      this.target.value = tile.dataset.abbr!;
      this.target.dispatchEvent(new Event('change'));
      this.render();
    });
    this.render();
  }

  /** Points the picker at another select (home or away), showing that team's group. */
  bind(target: HTMLSelectElement): void {
    this.target = target;
    this.group = this.groupOf(target.value);
    this.render();
  }

  /** Call after setting the select's value from code. */
  sync(): void {
    this.group = this.groupOf(this.target.value);
    this.render();
  }

  render(): void {
    this.tabs.innerHTML = [...this.groups.keys()]
      .map((g) => `<button type="button" class="ptab${g === this.group ? ' on' : ''}" data-group="${esc(g)}">${esc(g)}</button>`)
      .join('');
    this.grid.classList.toggle('off', this.disabled);
    this.grid.innerHTML = (this.groups.get(this.group) ?? [])
      .map((t) => {
        const color = t.primary === '#000000' ? t.secondary : t.primary;
        const mark = logoHtml(t, 'plogo') || `<span class="pabbr" style="background:${color}">${esc(t.abbr)}</span>`;
        const on = this.keyOf(t) === this.target.value ? ' on' : '';
        return `<button type="button" class="ptile${on}" data-abbr="${esc(this.keyOf(t))}" title="${esc(t.name)}" style="--team:${color}">${mark}<span class="pname">${esc(this.labelOf(t))}</span><span class="prate">${teamRating(t)}</span></button>`;
      })
      .join('');
  }

  private groupOf(key: string): string {
    for (const [g, teams] of this.groups) if (teams.some((t) => this.keyOf(t) === key)) return g;
    return this.groups.keys().next().value!;
  }
}
