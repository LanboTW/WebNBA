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
    let switchPlayer = k.has('KeyL');
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
      switchPlayer ||= btn(4); // LB / L1
      sprint ||= btn(7) || btn(5); // RT / RB
      intenseD ||= btn(6); // LT / L2
      timeout ||= btn(8); // Back / Share
    }
    const inp: PlayerInput = { moveX, moveZ, sprint, shoot, jump, pass, switchPlayer, intenseD, timeout };
    this.touch?.apply(inp);
    return inp;
  }
}
