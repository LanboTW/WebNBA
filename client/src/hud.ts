import {
  GOOD_WINDOW,
  METER_MAX,
  PERFECT_WINDOW,
  SHOT_SWEET,
  type GameState,
  type PlayerState,
  type TeamInfo,
} from '@webnba/shared';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function formatClock(secs: number): string {
  if (secs < 60) return secs.toFixed(1);
  const s = Math.ceil(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function periodLabel(period: number): string {
  return period <= 4 ? `第 ${period} 節` : period === 5 ? '延長賽' : `延長 ${period - 4}`;
}

export class Hud {
  private readonly root = $('#hud');
  private readonly teamEls = [$('#t0'), $('#t1')];
  private readonly pts = [$('#t0 .pts'), $('#t1 .pts')];
  private readonly period = $('#scoreboard .period');
  private readonly clock = $('#scoreboard .clock');
  private readonly shotClock = $('#scoreboard .shotclock');
  private readonly statline = $('#statline');
  private readonly meter = $('#meter');
  private readonly meterFill = $('#meter .fill');
  private readonly toasts = $('#toasts');
  private readonly help = $('#help');

  constructor() {
    // Meter zones, as a fraction of the bar (which spans 0..METER_MAX).
    const zone = (el: HTMLElement, half: number) => {
      el.style.bottom = `${((SHOT_SWEET - half) / METER_MAX) * 100}%`;
      el.style.height = `${((half * 2) / METER_MAX) * 100}%`;
    };
    zone($('#meter .zone.good'), GOOD_WINDOW);
    zone($('#meter .zone.perfect'), PERFECT_WINDOW);
  }

  show(teams: [TeamInfo, TeamInfo], practice: boolean): void {
    this.root.classList.remove('hidden');
    teams.forEach((t, i) => {
      this.teamEls[i].querySelector('.abbr')!.textContent = t.abbr;
      this.teamEls[i].style.setProperty('--team', t.primary === '#000000' ? t.secondary : t.primary);
    });
    this.teamEls[1].classList.toggle('hidden', practice);
    this.shotClock.classList.toggle('hidden', practice);
    if (practice) {
      this.period.textContent = '';
      this.clock.textContent = '練習';
    }
    this.toasts.replaceChildren();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.setMeter(-1, null);
  }

  update(state: GameState, me: PlayerState | null): void {
    this.pts[0].textContent = String(state.score[0]);
    this.pts[1].textContent = String(state.score[1]);
    if (state.settings.mode === 'practice') {
      if (me) this.setStats(me);
      return;
    }
    this.period.textContent = periodLabel(state.period);
    this.clock.textContent = formatClock(Math.max(0, state.gameClock));
    const sc = Math.max(0, state.shotClock);
    this.shotClock.textContent = sc < 5 ? sc.toFixed(1) : String(Math.ceil(sc));
    this.shotClock.classList.toggle('off', !state.shotClockOn);
    this.shotClock.classList.toggle('low', state.shotClockOn && sc < 5);
    this.teamEls.forEach((el, i) => el.classList.toggle('poss', state.possession === i && state.phase !== 'final'));
    if (me) this.setStats(me);
    else this.statline.textContent = '觀戰模式';
  }

  private setStats(p: PlayerState): void {
    const s = p.stats;
    this.statline.innerHTML =
      `<b>${p.info.name}</b> #${p.info.number} ${p.info.position}　` +
      `${s.pts} 分 · ${s.fgm}/${s.fga} 投 · ${s.tpm}/${s.tpa} 三分 · ${s.oreb + s.dreb} 板 · ${s.ast} 助`;
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
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => el.remove(), 1600);
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }
}
