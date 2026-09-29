import type { PlayerInput } from '@webnba/shared';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard + gamepad. The broadcast camera looks toward -z from the +z sideline,
 * so "up" on screen is -z and "right" is +x.
 */
export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code) && !(e.target instanceof HTMLSelectElement)) e.preventDefault();
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
    return had;
  }

  clearPresses(): void {
    this.pressed.clear();
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
    }
    return { moveX, moveZ, sprint, shoot, jump, pass, switchPlayer };
  }
}
