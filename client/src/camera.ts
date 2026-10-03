import * as THREE from 'three';

/**
 * 'broadcast': TV sideline view. 'end': behind the offence looking at the
 * basket they attack. 'player': close behind your own player (career games).
 */
export type CameraMode = 'broadcast' | 'end' | 'player';

export const CAMERA_LABEL: Record<CameraMode, string> = { broadcast: '轉播視角', end: '後場視角', player: '球員視角' };

/** For the player view: who to stand behind and what he is looking at. */
export interface Follow {
  x: number;
  z: number;
  /** Point the camera leans toward a little (the hoop on offence, the ball on defence). */
  toward: { x: number; z: number };
  /** +1 / -1: the way his team attacks. The view always looks that way (it only turns at half time). */
  attack: number;
}

/** How far (radians) the player view may lean off the court's axis toward the play. */
const PLAYER_LEAN = 0.35;

export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly look = new THREE.Vector3();
  private initialised = false;
  /** End view: heading of the camera's forward direction on the floor (0 = +x). */
  private yaw = 0;
  /**
   * Player view: the heading the stick follows. It stays on the court's axis
   * (his attack direction) on offence and defence alike, so "up" never
   * changes meaning mid-play; the picture may lean a little, the controls don't.
   */
  private controlYaw = 0;

  constructor(
    aspect: number,
    public mode: CameraMode = 'broadcast',
  ) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 200);
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.initialised = false;
  }

  /**
   * focus: where the action is (the ball). attackDir: +1 / -1, the direction the
   * team with the ball is going, which the end view looks toward.
   */
  update(focus: THREE.Vector3, attackDir: number, dt: number, follow: Follow | null = null): void {
    const narrow = this.camera.aspect < 1;
    let desiredPos: THREE.Vector3;
    let desiredLook: THREE.Vector3;
    if (this.mode === 'player' && follow) {
      // On defence he faces the ball with his back to his own hoop: the same way his team attacks.
      const base = follow.attack >= 0 ? 0 : Math.PI;
      this.controlYaw = this.initialised ? lerpAngle(this.controlYaw, base, 1 - Math.exp(-dt * 2)) : base;
      const dx = follow.toward.x - follow.x;
      const dz = follow.toward.z - follow.z;
      // Lean toward the play, a little; right under the target the direction means nothing.
      const off = Math.hypot(dx, dz) > 2.2 ? angleDiff(Math.atan2(dz, dx), base) : 0;
      const lean = Math.max(-PLAYER_LEAN, Math.min(PLAYER_LEAN, off * 0.5));
      const target = this.controlYaw + lean;
      this.yaw = this.initialised ? lerpAngle(this.yaw, target, 1 - Math.exp(-dt * 2.5)) : target;
      const fx = Math.cos(this.yaw);
      const fz = Math.sin(this.yaw);
      const back = narrow ? 9.5 : 7.5;
      desiredPos = new THREE.Vector3(follow.x - fx * back, narrow ? 5.6 : 4.4, follow.z - fz * back);
      desiredLook = new THREE.Vector3(follow.x + fx * 4, 1, follow.z + fz * 4);
      this.camera.fov = 55;
    } else if (this.mode === 'end' || this.mode === 'player') {
      const target = attackDir >= 0 ? 0 : Math.PI;
      this.yaw = this.initialised ? lerpAngle(this.yaw, target, 1 - Math.exp(-dt * 2.2)) : target;
      const fx = Math.cos(this.yaw);
      const fz = Math.sin(this.yaw);
      const back = narrow ? 13 : 10.5;
      const cx = focus.x * 0.85;
      const cz = focus.z * 0.45;
      desiredPos = new THREE.Vector3(Math.max(-21, Math.min(21, cx - fx * back)), narrow ? 9 : 7.2, cz - fz * back);
      desiredLook = new THREE.Vector3(cx + fx * 5, 0.6, cz + fz * 5);
      this.camera.fov = 50;
    } else {
      const dist = narrow ? 24 : 16.5;
      const x = focus.x * 0.75 + attackDir * 12.75 * 0.25;
      desiredPos = new THREE.Vector3(x * 0.82, narrow ? 13 : 9.5, dist + focus.z * 0.25);
      desiredLook = new THREE.Vector3(x * 0.9, 1.4, focus.z * 0.35);
      this.camera.fov = 42;
    }
    this.camera.updateProjectionMatrix();
    if (!this.initialised) {
      this.camera.position.copy(desiredPos);
      this.look.copy(desiredLook);
      this.initialised = true;
    }
    const k = 1 - Math.exp(-dt * (this.mode === 'player' && follow ? 6 : 3.5));
    this.camera.position.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k);
    this.camera.lookAt(this.look);
  }

  /**
   * Converts a screen-relative stick (right = +moveX, down = +moveZ) into a
   * world-space direction, so "up" always means "away from the camera".
   */
  toWorld(moveX: number, moveZ: number): { x: number; z: number } {
    if (this.mode === 'broadcast') return { x: moveX, z: moveZ };
    // The player view steers by the court's axis; the end view (also the player view's
    // fallback while he sits) by where it looks.
    const heading = this.mode === 'player' ? this.controlYaw : this.yaw;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    // right = (-fz, fx), forward = (fx, fz); screen up is -moveZ.
    return { x: -fz * moveX - fx * moveZ, z: fx * moveX - fz * moveZ };
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

/** b - a, wrapped to (-PI, PI]. */
function angleDiff(b: number, a: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
