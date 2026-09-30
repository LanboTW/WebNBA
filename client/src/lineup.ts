import { FOUL_OUT, cancelSub, requestSub, type GameState } from '@webnba/shared';
import { energyBar, esc, teamRows } from './boxscore';

/**
 * Substitution board: pick a player on the floor, then someone from the bench.
 * The swap is queued and happens at the next dead ball.
 */
export class LineupPanel {
  private selected = -1;
  private state: GameState | null = null;
  private team: 0 | 1 = 0;

  constructor(private readonly root: HTMLElement) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot],[data-roster]');
      if (!el || !this.state) return;
      const s = this.state;
      if (el.dataset.slot !== undefined) {
        const slot = Number(el.dataset.slot);
        if (s.subQueue.some((q) => q.team === this.team && q.slotId === slot)) {
          cancelSub(s, this.team, slot);
          this.selected = -1;
        } else {
          this.selected = this.selected === slot ? -1 : slot;
        }
      } else if (this.selected >= 0) {
        requestSub(s, this.team, this.selected, Number(el.dataset.roster));
        this.selected = -1;
      }
      this.render(s, this.team);
    });
  }

  render(state: GameState, team: 0 | 1): void {
    this.state = state;
    this.team = team;
    const rows = teamRows(state, team);
    const queued = (slot: number) => state.subQueue.find((q) => q.team === team && q.slotId === slot);
    const pendingIn = new Set(state.subQueue.filter((q) => q.team === team).map((q) => q.rosterIdx));
    const card = (r: (typeof rows)[number], attrs: string, extra = '', cls = '') =>
      `<button class="pcard ${cls}" ${attrs}><b>${esc(r.info.name)}</b><small>#${r.info.number} ${r.info.position} · 犯規 ${r.stats.pf}</small>${energyBar(r.energy)}${extra}</button>`;

    const court = state.players
      .filter((p) => p.team === team)
      .map((p) => {
        const r = rows.find((x) => x.slotId === p.id)!;
        const q = queued(p.id);
        const incoming = q ? rows.find((x) => x.rosterIdx === q.rosterIdx) : undefined;
        const extra = incoming ? `<span class="queued">⇄ ${esc(incoming.info.name)}（點一下取消）</span>` : '';
        return card(r, `data-slot="${p.id}"`, extra, `${this.selected === p.id ? 'sel' : ''} ${q ? 'q' : ''}`);
      })
      .join('');
    const bench = rows
      .filter((r) => r.slotId < 0)
      .map((r) => {
        const out = state.settings.rules.fouls && r.stats.pf >= FOUL_OUT;
        const attrs = out || this.selected < 0 ? 'disabled' : `data-roster="${r.rosterIdx}"`;
        return card(r, attrs, out ? '<span class="queued">犯滿離場</span>' : '', pendingIn.has(r.rosterIdx) ? 'q' : '');
      })
      .join('');
    const hint = this.selected >= 0 ? '選擇要換上的替補' : '點場上球員，再點替補球員；下一次死球時換人';
    this.root.innerHTML = `<div class="lineup"><h4>場上</h4><div class="cards">${court}</div><h4>替補</h4><div class="cards">${bench}</div><p class="fine">${hint}</p></div>`;
  }
}
