import * as THREE from 'three';
import {
  NO_INPUT,
  SHOT_SWEET,
  attackHoopX,
  canDunk,
  type GameState,
  type PlayerInfo,
  type PlayerInput,
  type TeamInfo,
} from '@webnba/shared';
import { Sfx } from './audio';
import type { Hud } from './hud';
import { Input } from './input';
import { Session } from './session';

/** How long one player shows off before the next one comes on. */
const SHOW_SECONDS = 20;
const FADE_SECONDS = 0.7;

type Step = 'show' | 'go' | 'shoot' | 'wait';

/**
 * Scripted "hands" for the showcase player: dribble moves on the spot, then a
 * jumper, a layup or a dunk, then the ball back and again. It plays through the
 * real sim (practice mode), so shots go in or miss like any other.
 */
class ShowInput extends Input {
  state!: GameState;
  private step: Step = 'show';
  private timer = 0;
  private spot = { x: 0, z: 0 };
  private jab = 1;
  private jabTimer = 0;
  private drive = false;
  private release = SHOT_SWEET;
  private giveBack = false;
  private showFor = 3;
  private started = false;

  constructor() {
    super(new EventTarget() as unknown as Window);
  }

  private get hoopX(): number {
    return attackHoopX(0, this.state.period);
  }

  /** A spot to work from: somewhere between the elbow and the arc. */
  private newSpot(): void {
    const a = (Math.random() - 0.5) * 2.4;
    const d = 4.2 + Math.random() * 3.2;
    const hx = this.hoopX;
    this.spot = { x: hx - Math.sign(hx) * Math.cos(a) * d, z: Math.sin(a) * d };
  }

  override sample(): PlayerInput {
    const s = this.state;
    const p = s.players[0];
    const inp: PlayerInput = { ...NO_INPUT };
    this.timer += 1 / 30;
    const toward = (x: number, z: number, scale = 1): number => {
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        inp.moveX = (dx / d) * Math.min(1, d) * scale;
        inp.moveZ = (dz / d) * Math.min(1, d) * scale;
      }
      return d;
    };

    switch (this.step) {
      case 'show': {
        if (s.ball.mode !== 'held') {
          this.step = 'wait';
          break;
        }
        // Jab side to side around the spot: each change of direction is a chance for a move.
        this.jabTimer -= 1 / 30;
        if (this.jabTimer <= 0) {
          this.jab = -this.jab;
          this.jabTimer = 0.45 + Math.random() * 0.5;
        }
        const hx = this.hoopX;
        const side = { x: p.pos.z, z: hx - p.pos.x };
        const len = Math.hypot(side.x, side.z) || 1;
        toward(this.spot.x + (side.x / len) * 0.7 * this.jab, this.spot.z + (side.z / len) * 0.7 * this.jab, 0.6);
        if (this.timer > this.showFor) {
          this.drive = canDunk(p) ? Math.random() < 0.5 : Math.random() < 0.3;
          this.step = 'go';
          this.timer = 0;
          if (!this.drive) this.newSpot();
        }
        break;
      }
      case 'go': {
        if (this.drive) {
          inp.sprint = true;
          const d = toward(this.hoopX - Math.sign(this.hoopX) * 0.6, p.pos.z * 0.5);
          if (d < 2.4 || this.timer > 4) this.startShot();
        } else {
          const d = toward(this.spot.x, this.spot.z);
          if (d < 0.35 || this.timer > 4) this.startShot();
        }
        break;
      }
      case 'shoot': {
        // Press to start the shot, hold until the meter reaches the chosen release point.
        if (p.action === 'shooting') this.started = true;
        inp.shoot = this.started ? p.action === 'shooting' && p.shotMeter < this.release : true;
        inp.sprint = this.drive;
        if ((this.started && p.action !== 'shooting') || this.timer > 3) {
          this.step = 'wait';
          this.timer = 0;
        }
        break;
      }
      case 'wait': {
        // Let the shot land and the celebration play, then walk out with the ball again.
        const settled = s.ball.mode !== 'flight';
        if (settled && this.timer > 2 && p.action === 'normal') {
          this.giveBack = true;
          this.showFor = 2.2 + Math.random() * 2;
          this.newSpot();
          this.step = 'show';
          this.timer = 0;
        }
        break;
      }
    }
    return inp;
  }

  private startShot(): void {
    this.step = 'shoot';
    this.timer = 0;
    this.started = false;
    // Mostly good timing, sometimes a little off either way.
    this.release = SHOT_SWEET + (Math.random() - 0.6) * 0.16;
  }

  /** The script's only "key": R, the practice give-me-the-ball button. */
  override consumePress(code: string): boolean {
    if (code !== 'KeyR' || !this.giveBack) return false;
    this.giveBack = false;
    return true;
  }

  override isDown(): boolean {
    return false;
  }

  start(): void {
    this.newSpot();
    this.timer = 0;
  }
}

/**
 * The menu background: one player alone on a dark court under a spotlight,
 * showing off for a while, seen from a close, slowly circling camera.
 */
export class Showcase {
  readonly session: Session;
  readonly camera: THREE.PerspectiveCamera;
  private readonly input = new ShowInput();
  private t = 0;
  private angle = Math.random() * Math.PI * 2;
  private readonly focus = new THREE.Vector3();

  /**
   * `hold` keeps this player on until told otherwise (the career screens show
   * your own player, and let you restyle him live).
   */
  constructor(
    public player: PlayerInfo,
    readonly team: TeamInfo,
    hud: Hud,
    aspect: number,
    readonly hold = false,
  ) {
    const lineup: TeamInfo = { ...team, players: [player, ...team.players.filter((p) => p !== player)] };
    this.session = new Session(
      [lineup, team],
      {
        mode: 'practice',
        humanTeams: [0],
        seed: (Math.random() * 2 ** 31) | 0,
      },
      hud,
      this.input,
      new Sfx(),
      { onFinal: () => {} },
      aspect,
      'broadcast',
      { showcase: true },
    );
    this.input.state = this.session.state;
    this.input.start();
    this.session.views[0].flair = 0.5;
    this.camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 120);
    const p = this.session.state.players[0].pos;
    this.focus.set(p.x, 1.25, p.z);
  }

  get finished(): boolean {
    return !this.hold && this.t >= SHOW_SECONDS;
  }

  /** Swaps in a restyled player without restarting the show. */
  setPlayer(info: PlayerInfo): void {
    this.player = info;
    this.session.restyle(0, info);
    this.session.views[0].flair = 0.5;
  }

  /** 0 = clear, 1 = black: fades in at the start and out at the end. */
  get fade(): number {
    const a = 1 - this.t / FADE_SECONDS;
    const b = this.hold ? 0 : 1 - (SHOW_SECONDS - this.t) / FADE_SECONDS;
    return Math.max(0, Math.min(1, Math.max(a, b)));
  }

  frame(dt: number): void {
    this.t += dt;
    this.input.state = this.session.state;
    this.session.frame(dt);
    const p = this.session.state.players[0].pos;
    this.session.arena.spotOn(p.x, p.z);
    this.focus.lerp(new THREE.Vector3(p.x, 1.25, p.z), Math.min(1, dt * 2.5));
    this.angle += dt * 0.12;
    // Phones held upright: further back, aimed low, so he stands in the top half above the buttons.
    const tall = this.camera.aspect < 1;
    const r = tall ? 12 : 6.2;
    const sx = Math.sin(this.angle);
    const cz = Math.cos(this.angle);
    this.camera.position.set(this.focus.x + sx * r, tall ? 2 : 2.1, this.focus.z + cz * r);
    // On wide screens aim left of the player so he stands clear of the menu on the right half.
    const shift = this.camera.aspect > 1.2 ? 1.5 : 0;
    this.camera.lookAt(this.focus.x - cz * shift, tall ? -1.4 : this.focus.y, this.focus.z + sx * shift);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.session.dispose();
  }
}
