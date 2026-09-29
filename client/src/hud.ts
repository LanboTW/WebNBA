import { GOOD_WINDOW, METER_MAX, PERFECT_WINDOW, SHOT_SWEET, type PlayerState, type TeamInfo } from '@webnba/shared';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Hud {
  private readonly homePts = $('#home .pts');
  private readonly statline = $('#statline');
  private readonly meter = $('#meter');
  private readonly meterFill = $('#meter .fill');
  private readonly toasts = $('#toasts');
  private readonly help = $('#help');

  constructor(home: TeamInfo) {
    $('#home .abbr').textContent = home.abbr;
    $('#home').style.setProperty('--team', home.secondary);
    // Meter zones, as a fraction of the bar (which spans 0..METER_MAX).
    const zone = (el: HTMLElement, half: number) => {
      el.style.bottom = `${((SHOT_SWEET - half) / METER_MAX) * 100}%`;
      el.style.height = `${((half * 2) / METER_MAX) * 100}%`;
    };
    zone($('#meter .zone.good'), GOOD_WINDOW);
    zone($('#meter .zone.perfect'), PERFECT_WINDOW);
  }

  setScore(pts: number): void {
    this.homePts.textContent = String(pts);
  }

  setStats(p: PlayerState): void {
    const s = p.stats;
    const pct = (m: number, a: number) => (a ? `${Math.round((m / a) * 100)}%` : '-');
    this.statline.textContent =
      `${p.info.name}  #${p.info.number}　` +
      `得分 ${s.pts}　投籃 ${s.fgm}/${s.fga} (${pct(s.fgm, s.fga)})　` +
      `三分 ${s.tpm}/${s.tpa} (${pct(s.tpm, s.tpa)})　籃板 ${s.reb}`;
  }

  /** screen: pixel position just above the shooter's head, or null to hide. */
  setMeter(value: number, screen: { x: number; y: number } | null): void {
    if (!screen || value < 0) {
      this.meter.style.display = 'none';
      return;
    }
    this.meter.style.display = 'block';
    this.meter.style.left = `${screen.x + 48}px`;
    this.meter.style.top = `${screen.y}px`;
    this.meterFill.style.height = `${Math.min(1, value / METER_MAX) * 100}%`;
  }

  toast(text: string, cls = '', small = false): void {
    const el = document.createElement('div');
    el.className = `toast ${cls} ${small ? 'small' : ''}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }
}
