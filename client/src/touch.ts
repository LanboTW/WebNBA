import type { PlayerInput } from '@webnba/shared';

/** Stick radius in CSS pixels; pushing past SPRINT_AT of it also sprints. */
const RADIUS = 60;
const SPRINT_AT = 0.92;

type ButtonId = 'shoot' | 'pass' | 'jump' | 'switch' | 'timeout' | 'menu' | 'camera';

/** What the player is doing right now, so the big buttons can say what they do. */
export type TouchMode = 'offense' | 'offball' | 'defense' | 'none';

const LABELS: Record<TouchMode, Record<'shoot' | 'pass' | 'jump', string>> = {
  offense: { shoot: '投籃', pass: '傳球', jump: '跳' },
  // Career games: a teammate has the ball.
  offball: { shoot: '投籃', pass: '要球', jump: '跳' },
  defense: { shoot: '緊迫防守', pass: '抄截', jump: '蓋帽' },
  none: { shoot: '投籃', pass: '傳球', jump: '跳' },
};

/** The small switch button: change player, or in career games call a pick / a switch. */
const SWITCH_LABEL: Record<TouchMode, [string, string]> = {
  offense: ['換人', '擋拆'],
  offball: ['換人', '擋拆'],
  defense: ['換人', '換防'],
  none: ['換人', '換人'],
};

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
        <button data-b="jump" class="tb jump">跳</button>
        <button data-b="pass" class="tb pass">傳球</button>
        <button data-b="shoot" class="tb shoot">投籃</button>
      </div>
      <div class="trotate">橫放手機玩起來更順手</div>
      <div class="tsmall">
        <button data-b="switch">換人</button>
        <button data-b="timeout">叫暫停</button>
        <button data-b="camera">視角</button>
        <button data-b="menu">☰</button>
      </div>`;
    parent.appendChild(this.root);
    this.base = this.root.querySelector('.tstick')!;
    this.knob = this.base.querySelector('i')!;

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
      });
      const up = () => {
        this.held.delete(id);
        el.classList.remove('on');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
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
  }

  setMode(mode: TouchMode, solo = false): void {
    if (mode === this.mode && solo === this.solo) return;
    this.mode = mode;
    this.solo = solo;
    for (const id of ['shoot', 'pass', 'jump'] as const) this.buttons.get(id)!.textContent = LABELS[mode][id];
    this.buttons.get('switch')!.textContent = SWITCH_LABEL[mode][solo ? 1 : 0];
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
    inp.switchPlayer ||= h.has('switch');
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
