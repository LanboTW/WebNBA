import { logoHtml } from './logos';
import {
  GOOD_WINDOW,
  METER_MAX,
  PERFECT_WINDOW,
  SHOT_SWEET,
  inBonus,
  type GameState,
  type PlayerState,
  type TeamInfo,
} from '@webnba/shared';

type StatLine = Pick<PlayerState, 'info' | 'stats' | 'energy'>;

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
  private readonly teamInfo = [$('#ti0'), $('#ti1')];
  private readonly teamInfoRow = $('#teaminfo');
  private readonly banner = $('#banner');
  private readonly stamina = $('#stamina');
  private readonly staminaFill = $('#stamina i');
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
      this.teamEls[i].querySelector('.logo')?.remove();
      this.teamEls[i].insertAdjacentHTML(i === 0 ? 'afterbegin' : 'beforeend', logoHtml(t));
      this.teamEls[i].style.setProperty('--team', t.primary === '#000000' ? t.secondary : t.primary);
    });
    this.teamEls[1].classList.toggle('hidden', practice);
    this.shotClock.classList.toggle('hidden', practice);
    this.teamInfoRow.classList.toggle('hidden', practice);
    this.banner.classList.add('hidden');
    if (practice) {
      this.period.textContent = '';
      this.clock.textContent = '練習';
    }
    this.toasts.replaceChildren();
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.setMeter(-1, null);
    this.setStamina(-1, null);
  }

  /** me: the line shown under the scoreboard (your player, also while he sits); null = spectating. */
  update(state: GameState, me: StatLine | null): void {
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
    ([0, 1] as const).forEach((t) => {
      const fouls = state.settings.rules.fouls
        ? `犯規 ${state.teamFouls[t]}${inBonus(state, t) ? ' <b class="bonus">加罰</b>' : ''}　`
        : '';
      const dots = '●'.repeat(state.timeoutsLeft[t]) + '<i>' + '●'.repeat(Math.max(0, 5 - state.timeoutsLeft[t])) + '</i>';
      this.teamInfo[t].innerHTML = `${fouls}暫停 ${dots}`;
    });
    const ft = state.phase === 'freeThrow' ? state.freeThrow : null;
    const banner = ft
      ? `罰球 ${ft.index + 1}/${ft.total}　${state.players[ft.shooterId].info.name}${ft.after ? '（技術犯規）' : ''}`
      : state.phase === 'timeout' && state.timeout
        ? `暫停　${Math.max(0, Math.ceil(state.timeout.limit - state.timeout.timer))}`
        : '';
    this.banner.textContent = banner;
    this.banner.classList.toggle('hidden', !banner);
    if (me) this.setStats(me, state.settings.rules.fatigue);
    else this.statline.textContent = '觀戰模式';
  }

  private setStats(p: StatLine, fatigue = false): void {
    const s = p.stats;
    const pct = Math.round(p.energy * 100);
    const energy = fatigue
      ? `<span class="ebar ${p.energy < 0.6 ? 'low' : p.energy < 0.8 ? 'mid' : ''}"><i style="width:${pct}%"></i></span>`
      : '';
    this.statline.innerHTML =
      `<b>${p.info.name}</b> #${p.info.number} ${p.info.position} ${energy}　` +
      `${s.pts} 分 · ${s.fgm}/${s.fga} 投 · ${s.tpm}/${s.tpa} 三分 · ${s.ftm}/${s.fta} 罰 · ${s.oreb + s.dreb} 板 · ${s.ast} 助 · ${s.pf} 犯`;
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

  /** Energy bar under the controlled player's feet (screen: projected feet position). */
  setStamina(energy: number, screen: { x: number; y: number } | null): void {
    if (!screen || energy < 0) {
      this.stamina.style.display = 'none';
      return;
    }
    this.stamina.style.display = 'block';
    this.stamina.style.left = `${screen.x}px`;
    this.stamina.style.top = `${screen.y + 26}px`;
    this.stamina.className = energy < 0.6 ? 'low' : energy < 0.8 ? 'mid' : '';
    this.staminaFill.style.width = `${Math.round(energy * 100)}%`;
  }

  toast(text: string, cls = '', small = false): void {
    const el = document.createElement('div');
    el.className = `toast ${cls} ${small ? 'small' : ''}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
    setTimeout(() => el.remove(), 1600);
  }

  /** Career games show the one-player controls (call for the ball, pick, switch). */
  setHelpMode(solo: boolean): void {
    this.help.classList.toggle('solo', solo);
  }

  toggleHelp(): void {
    this.help.classList.toggle('hidden');
  }
}
