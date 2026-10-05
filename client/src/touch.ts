import { PLAY_KINDS, PLAY_NAME, type PlayerInput } from '@webnba/shared';

/** Stick radius in CSS pixels; pushing past SPRINT_AT of it also sprints. */
const RADIUS = 60;
const SPRINT_AT = 0.92;

type ButtonId = 'shoot' | 'pass' | 'jump' | 'act' | 'timeout' | 'menu' | 'camera';

/** What the player is doing right now, so the big buttons can say what they do. */
export type TouchMode = 'offense' | 'offball' | 'defense' | 'none';

const LABELS: Record<TouchMode, Record<'shoot' | 'pass' | 'jump', string>> = {
  offense: { shoot: '投籃', pass: '傳球', jump: '跳' },
  // Career games: a teammate has the ball.
  offball: { shoot: '投籃', pass: '要球', jump: '跳' },
  defense: { shoot: '緊迫防守', pass: '抄截', jump: '蓋帽' },
  none: { shoot: '投籃', pass: '傳球', jump: '跳' },
};

/**
 * The round button over jump: plays while your team has the ball, otherwise
 * change player (career games: trade men with a teammate on defence).
 */
type ActRole = 'plays' | 'switch' | 'off';

/** Play dial: radius, how far the labels sit from the middle, and the finger travel that picks one. */
const DIAL_R = 92;
const DIAL_LABEL_R = 62;
const DIAL_DEAD = 26;

/**
 * On-screen controls for phones and tablets: a floating joystick on the left
 * half and three action buttons on the right whose meaning follows play
 * (on defence "shoot" is intense defence, "pass" is a steal). Full stick
 * deflection sprints, so a sprinting shot near the rim is a dunk.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private stickId = -1;
  private origin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private readonly held = new Set<ButtonId>();
  private readonly buttons = new Map<ButtonId, HTMLElement>();
  private mode: TouchMode = 'none';
  private solo = false;
  private calls = false;
  private role: ActRole = 'off';
  /** The play dial while the round button is held with the ball: finger, press point, slice under it. */
  private readonly dial: HTMLElement;
  private dialId = -1;
  private dialFrom = { x: 0, y: 0 };
  private dialPick = 0;
  /** A play picked on the dial (1-5), for the frame loop to pick up. */
  private picked = 0;
  /** One-shot UI presses (menu, camera) for the frame loop to pick up. */
  private readonly taps = new Set<ButtonId>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="tzone"></div>
      <div class="tstick hidden"><i></i></div>
      <div class="tbig">
        <button data-b="act" class="tb act">換人</button>
        <button data-b="jump" class="tb jump">跳</button>
        <button data-b="pass" class="tb pass">傳球</button>
        <button data-b="shoot" class="tb shoot">投籃</button>
      </div>
      <div class="tdial hidden">
        <i class="tdial-mid">放開取消</i>
        ${PLAY_KINDS.map((k, i) => {
          const a = (i * 2 * Math.PI) / PLAY_KINDS.length;
          return `<span data-n="${i + 1}" style="left:${DIAL_R + Math.sin(a) * DIAL_LABEL_R}px;top:${DIAL_R - Math.cos(a) * DIAL_LABEL_R}px"><b>${i + 1}</b>${PLAY_NAME[k]}</span>`;
        }).join('')}
      </div>
      <div class="trotate">橫放手機玩起來更順手</div>
      <div class="tsmall tr">
        <button data-b="timeout">叫暫停(換人)</button>
        <button data-b="camera">視角</button>
        <button data-b="menu">☰</button>
      </div>`;
    parent.appendChild(this.root);
    this.base = this.root.querySelector('.tstick')!;
    this.knob = this.base.querySelector('i')!;
    this.dial = this.root.querySelector('.tdial')!;

    const zone = this.root.querySelector<HTMLElement>('.tzone')!;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      capture(zone, e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.remove('hidden');
      this.moveStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.stick = { x: 0, y: 0 };
      this.base.classList.add('hidden');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    for (const el of this.root.querySelectorAll<HTMLElement>('[data-b]')) {
      const id = el.dataset.b as ButtonId;
      this.buttons.set(id, el);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(el, e.pointerId);
        this.held.add(id);
        this.taps.add(id);
        el.classList.add('on');
        if (id === 'act' && this.role === 'plays') this.openDial(e);
      });
      const up = (e: PointerEvent) => {
        this.held.delete(id);
        el.classList.remove('on');
        if (id === 'act' && e.pointerId === this.dialId) {
          if (e.type === 'pointerup' && this.dialPick) this.picked = this.dialPick;
          this.closeDial();
        }
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      if (id === 'act') el.addEventListener('pointermove', (e) => this.moveDial(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  private moveStick(x: number, y: number): void {
    let dx = (x - this.origin.x) / RADIUS;
    let dy = (y - this.origin.y) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    this.stick = { x: dx, y: dy };
    this.knob.style.transform = `translate(${dx * RADIUS}px, ${dy * RADIUS}px)`;
  }

  /** Press on the round button with the ball: the dial opens around the finger (kept on screen). */
  private openDial(e: PointerEvent): void {
    this.dialId = e.pointerId;
    this.dialFrom = { x: e.clientX, y: e.clientY };
    this.dialPick = 0;
    const pad = DIAL_R + 6;
    const x = Math.min(Math.max(e.clientX, pad), window.innerWidth - pad);
    const y = Math.min(Math.max(e.clientY, pad), window.innerHeight - pad);
    this.dial.style.left = `${x - DIAL_R}px`;
    this.dial.style.top = `${y - DIAL_R}px`;
    this.showPick();
    this.dial.classList.remove('hidden');
  }

  /** Slide out from where you pressed: the direction picks a slice, 1 at the top and on clockwise. */
  private moveDial(e: PointerEvent): void {
    if (e.pointerId !== this.dialId) return;
    const dx = e.clientX - this.dialFrom.x;
    const dy = e.clientY - this.dialFrom.y;
    let pick = 0;
    if (Math.hypot(dx, dy) >= DIAL_DEAD) {
      const n = PLAY_KINDS.length;
      const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1 + 0.5 / n) % 1;
      pick = Math.floor(turn * n) + 1;
    }
    if (pick === this.dialPick) return;
    this.dialPick = pick;
    this.showPick();
  }

  private showPick(): void {
    for (const s of this.dial.querySelectorAll<HTMLElement>('[data-n]')) s.classList.toggle('on', Number(s.dataset.n) === this.dialPick);
    this.dial.classList.toggle('picking', this.dialPick > 0);
  }

  private closeDial(): void {
    this.dialId = -1;
    this.dialPick = 0;
    this.showPick();
    this.dial.classList.add('hidden');
  }

  /** A play picked on the dial since last asked (0: none). */
  consumePlay(): number {
    const n = this.picked;
    this.picked = 0;
    return n;
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    if (!on) this.reset();
  }

  /** Drop everything held (e.g. when the game is paused or ends). */
  reset(): void {
    this.held.clear();
    this.taps.clear();
    this.stickId = -1;
    this.stick = { x: 0, y: 0 };
    this.base.classList.add('hidden');
    for (const el of this.buttons.values()) el.classList.remove('on');
    this.closeDial();
    this.picked = 0;
  }

  /** `calls`: your team has the ball in a live game, so the round button calls plays. */
  setMode(mode: TouchMode, solo = false, calls = false): void {
    if (mode === this.mode && solo === this.solo && calls === this.calls) return;
    this.mode = mode;
    this.solo = solo;
    this.calls = calls;
    for (const id of ['shoot', 'pass', 'jump'] as const) this.buttons.get(id)!.textContent = LABELS[mode][id];
    this.role = calls ? 'plays' : !solo || mode === 'defense' ? 'switch' : 'off';
    const act = this.buttons.get('act')!;
    act.textContent = this.role === 'switch' ? (solo ? '換防' : '換人') : '戰術';
    act.classList.toggle('off', this.role === 'off');
    // Lost the ball with the dial open: nothing to call any more.
    if (this.role !== 'plays') this.closeDial();
    // Nobody to call timeouts for in a career game: the coach does that.
    this.buttons.get('timeout')!.classList.toggle('hidden', solo);
  }

  /** UI buttons pressed since last asked (menu, camera). */
  consumeTap(id: 'menu' | 'camera'): boolean {
    const had = this.taps.has(id);
    this.taps.delete(id);
    return had;
  }

  /** Gameplay buttons and stick, merged into the keyboard/pad input. */
  apply(inp: PlayerInput): void {
    const { x, y } = this.stick;
    const len = Math.hypot(x, y);
    if (len > 0.15) {
      inp.moveX = x;
      inp.moveZ = y;
      if (len >= SPRINT_AT) inp.sprint = true;
    }
    const h = this.held;
    if (h.has('shoot')) {
      if (this.mode === 'defense') inp.intenseD = true;
      else inp.shoot = true;
    }
    inp.pass ||= h.has('pass');
    inp.jump ||= h.has('jump');
    inp.switchPlayer ||= h.has('act') && this.role === 'switch';
    inp.timeout ||= h.has('timeout');
  }
}

/** Phones and tablets (a touch-screen laptop switches over on its first touch instead). */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

/** Keep receiving a finger's events after it slides off the element. */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-released pointer: plain events still work.
  }
}
