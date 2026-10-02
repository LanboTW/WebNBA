import * as THREE from 'three';
import type { TeamInfo } from '@webnba/shared';
import { Sfx } from './audio';
import type { Hud } from './hud';
import { Input } from './input';
import { Session } from './session';

/**
 * The menu background: a silent computer-vs-computer game seen from a camera
 * that slowly circles the court and drifts toward the ball. It gets its own
 * input and audio, so nothing the player types or hears reaches it.
 */
export class Attract {
  readonly session: Session;
  readonly camera: THREE.PerspectiveCamera;
  private angle = Math.random() * Math.PI * 2;
  private readonly focus = new THREE.Vector3();

  constructor(teams: [TeamInfo, TeamInfo], hud: Hud, aspect: number) {
    this.session = new Session(
      teams,
      {
        mode: 'game',
        humanTeams: [],
        difficulty: 'normal',
        quarterSeconds: 720,
        seed: (Math.random() * 2 ** 31) | 0,
        rules: { fouls: true, violations: true, fatigue: true },
      },
      hud,
      new Input(new EventTarget() as unknown as Window),
      new Sfx(),
      { onFinal: () => {} },
      aspect,
    );
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 200);
  }

  get finished(): boolean {
    return this.session.state.phase === 'final';
  }

  frame(dt: number): void {
    this.session.frame(dt);
    this.angle += dt * 0.05;
    const ball = this.session.state.ball.pos;
    this.focus.lerp(new THREE.Vector3(ball.x * 0.6, 1.2, ball.z * 0.3), Math.min(1, dt * 0.8));
    this.camera.position.set(this.focus.x + Math.sin(this.angle) * 23, 7.5, this.focus.z + Math.cos(this.angle) * 18);
    this.camera.lookAt(this.focus);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.session.dispose();
  }
}
