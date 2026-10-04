import type { PlayerInput } from '@webnba/shared';
import type { TouchControls } from './touch';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard + gamepad. The broadcast camera looks toward -z from the +z sideline,
 * so "up" on screen is -z and "right" is +x.
 */
export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  /** On-screen controls, when the device is a touch screen. */
  touch: TouchControls | null = null;
  private iconTap = -1;
  /** When L (or LB) went down, -1 while it is up. */
  private lDownAt = -1;
  /** L went down when a play could be called: hold for the wheel, tap to switch. */
  private lCalls = false;
  /** A play was picked during this hold. */
  private lUsed = false;
  private padPrev: boolean[] = [];
  /** A play picked on the wheel (1-5), sent with the next input. */
  private pendingPlay = 0;
  /** Whether a play can be called right now (the session says: your team has the ball). */
  canCall: () => boolean = () => false;
  /** The play wheel is up (L held). */
  wheelOpen = false;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      // Leave form fields alone (typing a name or room code).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  /** A key press, taken once (no touch stand-ins). */
  private consumeKey(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** True once per physical key press (for UI shortcuts, not gameplay). */
  consumePress(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    // The touch menu and camera buttons stand in for Esc and C.
    const tap = code === 'Escape' ? 'menu' : code === 'KeyC' ? 'camera' : null;
    const tapped = !!tap && !!this.touch?.consumeTap(tap);
    return had || tapped;
  }

  /** A pass icon over a teammate was tapped (index 0-3). */
  tapIcon(i: number): void {
    this.iconTap = i;
  }

  /** The tapped icon, once. */
  takeIconTap(): number {
    const i = this.iconTap;
    this.iconTap = -1;
    return i;
  }

  /** A play picked by tapping the wheel. */
  choosePlay(n: number): void {
    this.pendingPlay = n;
    this.lUsed = true;
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  clearPresses(): void {
    this.pressed.clear();
    this.iconTap = -1;
    this.touch?.reset();
  }

  sample(): PlayerInput {
    const k = this.keys;
    let moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let moveZ = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    let sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    let shoot = k.has('KeyJ');
    let jump = k.has('Space');
    let pass = k.has('KeyK');
    let switchPlayer = false;
    let intenseD = k.has('KeyU');
    let timeout = k.has('KeyT');

    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const [ax, az] = pad.axes;
      if (Math.hypot(ax, az) > 0.18) {
        moveX = ax;
        moveZ = az;
      }
      const btn = (i: number) => !!pad.buttons[i]?.pressed;
      shoot ||= btn(2); // X / Square
      jump ||= btn(3); // Y / Triangle
      pass ||= btn(0); // A / Cross
      sprint ||= btn(7) || btn(5); // RT / RB
      intenseD ||= btn(6); // LT / L2
      timeout ||= btn(8); // Back / Share
    }
    // L / LB: a tap switches (or, in a career game, calls a pick / a switch); with your
    // team on the ball, holding it opens the play wheel (1-5, or the d-pad and Y).
    const padBtn = (i: number) => !!pad?.buttons[i]?.pressed;
    const lDown = k.has('KeyL') || padBtn(4);
    const now = performance.now();
    if (lDown && this.lDownAt < 0) {
      this.lDownAt = now;
      this.lUsed = false;
      this.lCalls = this.canCall();
      // Only presses made with the wheel up pick a play.
      for (let n = 1; n <= 5; n++) ['Digit' + n, 'Numpad' + n].forEach((c) => this.pressed.delete(c));
    }
    let play = 0;
    if (!this.lCalls) {
      switchPlayer = lDown;
      this.wheelOpen = false;
    } else if (lDown) {
      this.wheelOpen = now - this.lDownAt >= 180;
      if (this.wheelOpen) {
        const padEdge = (i: number) => padBtn(i) && !this.padPrev[i];
        const keys = [1, 2, 3, 4, 5].findIndex((n) => this.consumeKey(`Digit${n}`) || this.consumeKey(`Numpad${n}`));
        const padPick = [12, 15, 13, 14, 3].findIndex(padEdge);
        const n = keys >= 0 ? keys + 1 : padPick >= 0 ? padPick + 1 : 0;
        if (n && !this.lUsed) {
          play = n;
          this.lUsed = true;
        }
      }
    } else if (this.lDownAt >= 0) {
      // Let go: a quick tap without a pick is the old switch button.
      if (!this.lUsed && now - this.lDownAt < 300) switchPlayer = true;
      this.wheelOpen = false;
    }
    if (!lDown) this.lDownAt = -1;
    if (pad) this.padPrev = pad.buttons.map((b) => b.pressed);
    if (this.pendingPlay) {
      play = this.pendingPlay;
      this.pendingPlay = 0;
    }
    const inp: PlayerInput = { moveX, moveZ, sprint, shoot, jump, pass, switchPlayer, intenseD, timeout, ...(play ? { play } : {}) };
    this.touch?.apply(inp);
    return inp;
  }
}
