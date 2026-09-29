import * as THREE from 'three';
import { SHOT_SWEET, type PlayerState, type TeamInfo } from '@webnba/shared';

export interface Kit {
  body: string;
  trim: string;
  number: string;
  outline: string;
}

/** Home wears white with team-colour trim; away wears the team colour. */
export function kitFor(team: TeamInfo, home: boolean): Kit {
  return home
    ? { body: '#f2f2f2', trim: team.primary, number: team.primary, outline: team.secondary }
    : { body: team.primary, trim: team.secondary, number: team.secondary === '#000000' ? '#ffffff' : team.secondary, outline: '#111111' };
}

/** Proportions are authored for a 2.0 m player and scaled to the real height. */
const BASE_HEIGHT = 2.0;
const THIGH = 0.5;
const SHIN = 0.47;
const UPPER_ARM = 0.34;
const FOREARM = 0.32;

interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
}

type OneShot = 'pass' | 'reach' | 'celebrate';
const ONE_SHOT_SECONDS: Record<OneShot, number> = { pass: 0.35, reach: 0.35, celebrate: 1.3 };

export interface AnimContext {
  hasBall: boolean;
  defending: boolean;
  inbounding: boolean;
  /** A pass is on its way to this player. */
  catching: boolean;
  /** World position the head should track (usually the ball). */
  lookAt: THREE.Vector3;
}

/** Joint angles: arms [shoulder pitch, shoulder roll, elbow], legs [hip, knee]. */
interface Pose {
  bodyY: number;
  lean: number;
  armL: [number, number, number];
  armR: [number, number, number];
  legL: [number, number];
  legR: [number, number];
}

const restPose = (): Pose => ({ bodyY: 0, lean: 0, armL: [0, 0.12, -0.4], armR: [0, -0.12, -0.4], legL: [0, 0.12], legR: [0, 0.12] });

export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly head: THREE.Mesh;
  private runPhase = 0;
  private clock = 0;
  private oneShot: OneShot | null = null;
  private oneShotT = 0;
  private readonly target: Pose = restPose();
  private readonly current: Pose = restPose();

  constructor(info: PlayerState['info'], kit: Kit) {
    const jersey = new THREE.MeshStandardMaterial({ color: kit.body, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: kit.trim, roughness: 0.7 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x8d5a3b, roughness: 0.8, flatShading: true });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });

    const s = info.heightM / BASE_HEIGHT;
    this.root.scale.setScalar(s);
    this.root.add(this.body);

    const hipY = THIGH + SHIN + 0.06;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), jersey);
    torso.position.y = hipY + 0.36;
    this.body.add(torso);

    const shorts = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.3), trim);
    shorts.position.y = hipY + 0.02;
    this.body.add(shorts);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), skin);
    neck.position.y = hipY + 0.72;
    this.body.add(neck);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), skin);
    head.position.y = hipY + 0.86;
    this.body.add(head);
    this.head = head;

    const numberTex = makeNumberTexture(info.number, kit);
    for (const side of [1, -1]) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.34),
        new THREE.MeshStandardMaterial({ map: numberTex, transparent: true, roughness: 0.7 }),
      );
      plate.position.set(0, hipY + 0.4, side * 0.141);
      if (side < 0) plate.rotation.y = Math.PI;
      this.body.add(plate);
    }

    const shoulderY = hipY + 0.6;
    this.armL = makeLimb(UPPER_ARM, FOREARM, 0.055, skin, jersey);
    this.armR = makeLimb(UPPER_ARM, FOREARM, 0.055, skin, jersey);
    this.armL.upper.position.set(0.3, shoulderY, 0);
    this.armR.upper.position.set(-0.3, shoulderY, 0);
    this.body.add(this.armL.upper, this.armR.upper);

    this.legL = makeLimb(THIGH, SHIN, 0.08, skin, trim, shoe);
    this.legR = makeLimb(THIGH, SHIN, 0.08, skin, trim, shoe);
    this.legL.upper.position.set(0.13, hipY - 0.06, 0);
    this.legR.upper.position.set(-0.13, hipY - 0.06, 0);
    this.body.add(this.legL.upper, this.legR.upper);

    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  /** Plays a one-shot upper-body animation driven by a game event. */
  trigger(kind: OneShot): void {
    this.oneShot = kind;
    this.oneShotT = 0;
  }

  update(p: PlayerState, pos: THREE.Vector3, facing: number, ctx: AnimContext, dt: number): void {
    this.root.position.copy(pos);
    this.root.rotation.y = facing;
    this.clock += dt;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.runPhase += dt * (4 + speed * 1.6);
    const stride = Math.min(1, speed / 5);
    const swing = Math.sin(this.runPhase) * stride;
    const airborne = pos.y > 0.02;

    if (this.oneShot) {
      this.oneShotT += dt / ONE_SHOT_SECONDS[this.oneShot];
      if (this.oneShotT >= 1) this.oneShot = null;
    }

    const t = this.target;
    // Base: locomotion.
    t.bodyY = Math.abs(swing) * 0.03 - 0.04 * stride + Math.sin(this.clock * 2.2) * 0.008 * (1 - stride);
    t.lean = stride * 0.18;
    t.legL = [swing * 0.8, Math.max(0, -Math.sin(this.runPhase)) * 1.2 * stride + 0.12];
    t.legR = [-swing * 0.8, Math.max(0, Math.sin(this.runPhase)) * 1.2 * stride + 0.12];
    t.armL = [-swing * 0.7, 0.12, -0.35 - stride * 0.5];
    t.armR = [swing * 0.7, -0.12, -0.35 - stride * 0.5];

    if (airborne) {
      t.legL = [-0.4, 0.75];
      t.legR = [-0.15, 0.45];
    }

    const shooting = p.action === 'shooting' || p.action === 'release';
    if (shooting && p.shotKind === 'layup') {
      // One-hand finish with a knee drive.
      const k = p.action === 'release' ? 1 : Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
      t.lean = 0.05;
      t.armR = [-1.6 - 1.4 * k, -0.1, -0.6 + 0.55 * k];
      t.armL = [-1.1, 0.35, -0.9];
      t.legL = [-1.25, 1.4];
      t.legR = [0.15, 0.2];
    } else if (shooting) {
      const k = p.action === 'release' ? 1 : Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
      const raise = -0.6 - 2.3 * k;
      const bend = p.action === 'release' ? 0.1 : 1.6 - 0.9 * k;
      t.lean = 0;
      t.armL = [raise, 0.15, -bend];
      t.armR = [raise, -0.15, -bend];
      if (!airborne) {
        // Dip at the start of the gather.
        t.bodyY = -0.08 * (1 - k);
        t.legL = [-0.3 * (1 - k), 0.6 * (1 - k)];
        t.legR = [-0.3 * (1 - k), 0.6 * (1 - k)];
      }
    } else if (this.oneShot === 'pass') {
      // Chest pass: from the chest, arms punch out and follow through.
      const k = this.oneShotT;
      const ext = Math.min(1, k * 2.5);
      t.armL = [-1.25 - 0.3 * ext, 0.25 - 0.15 * ext, -1.5 + 1.45 * ext];
      t.armR = [-1.25 - 0.3 * ext, -0.25 + 0.15 * ext, -1.5 + 1.45 * ext];
      t.lean = 0.2 * ext;
    } else if (this.oneShot === 'reach') {
      // Steal swipe with the right hand.
      const k = Math.sin(this.oneShotT * Math.PI);
      t.armR = [-0.6 - 1.0 * k, -0.35, -0.1];
      t.armL = [-0.3, 0.5, -0.6];
      t.lean = 0.2 + 0.25 * k;
    } else if (this.oneShot === 'celebrate' && !ctx.hasBall && !airborne) {
      const pump = Math.abs(Math.sin(this.oneShotT * Math.PI * 3));
      t.armR = [-2.8, -0.15, -0.4 - 0.5 * pump];
      t.armL = [-0.2, 0.2, -0.5];
    } else if (ctx.inbounding) {
      // Ball held overhead, looking for a target.
      t.armL = [-2.55, 0.25, -0.85];
      t.armR = [-2.55, -0.25, -0.85];
      t.lean = 0;
    } else if (airborne && !ctx.hasBall) {
      // Block, rebound or tip: both arms straight up.
      t.armL = [-2.95, 0.22, -0.05];
      t.armR = [-2.95, -0.22, -0.05];
      t.lean = -0.05;
    } else if (airborne && ctx.hasBall) {
      t.armL = [-1.2, 0.3, -1.2];
      t.armR = [-1.2, -0.3, -1.2];
    } else if (ctx.catching) {
      // Hands up and out to receive the pass.
      t.armL = [-1.35, 0.3, -0.35];
      t.armR = [-1.35, -0.3, -0.35];
    } else if (ctx.hasBall) {
      // Right hand pumps the dribble, left arm guards.
      const bounce = Math.abs(Math.sin(p.dribblePhase));
      t.armR = [-0.45, -0.25, -0.4 - (1 - bounce) * 0.5];
      t.armL = [-0.5 - swing * 0.2, 0.35, -0.9];
      t.bodyY -= 0.05;
    } else if (ctx.defending && speed < 3.5) {
      // Defensive stance: low, arms wide, shuffling.
      t.bodyY -= 0.1;
      t.lean = 0.25;
      t.armL = [-0.5, 0.9, -0.5];
      t.armR = [-0.5, -0.9, -0.5];
      if (!airborne) {
        t.legL = [-0.35 + swing * 0.4, 0.7];
        t.legR = [-0.35 - swing * 0.4, 0.7];
      }
    }

    this.blend(dt);

    // Keep an eye on the ball.
    const local = this.root.worldToLocal(ctx.lookAt.clone());
    const yaw = Math.max(-1, Math.min(1, Math.atan2(local.x, local.z)));
    this.head.rotation.y += (yaw - this.head.rotation.y) * Math.min(1, dt * 8);
  }

  /** Ease every joint toward its target so pose changes never snap. */
  private blend(dt: number): void {
    const k = 1 - Math.exp(-dt * 18);
    const c = this.current;
    const t = this.target;
    const mix = (a: number, b: number) => a + (b - a) * k;
    c.bodyY = mix(c.bodyY, t.bodyY);
    c.lean = mix(c.lean, t.lean);
    for (const key of ['armL', 'armR'] as const) for (let i = 0; i < 3; i++) c[key][i] = mix(c[key][i], t[key][i]);
    for (const key of ['legL', 'legR'] as const) for (let i = 0; i < 2; i++) c[key][i] = mix(c[key][i], t[key][i]);

    this.body.position.y = c.bodyY;
    this.body.rotation.x = c.lean;
    this.armL.upper.rotation.set(c.armL[0], 0, c.armL[1]);
    this.armL.lower.rotation.x = c.armL[2];
    this.armR.upper.rotation.set(c.armR[0], 0, c.armR[1]);
    this.armR.lower.rotation.x = c.armR[2];
    this.legL.upper.rotation.x = c.legL[0];
    this.legL.lower.rotation.x = c.legL[1];
    this.legR.upper.rotation.x = c.legR[0];
    this.legR.lower.rotation.x = c.legR[1];
  }
}

function makeLimb(
  upperLen: number,
  lowerLen: number,
  radius: number,
  skin: THREE.Material,
  sleeve: THREE.Material,
  foot?: THREE.Material,
): Limb {
  const upper = new THREE.Group();
  const upperMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.85, upperLen, 7), foot ? skin : sleeve);
  upperMesh.position.y = -upperLen / 2;
  upper.add(upperMesh);
  if (!foot) {
    // Short sleeve cap over the shoulder, skin below.
    upperMesh.material = skin;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.3, 0.12, 7), sleeve);
    cap.position.y = -0.05;
    upper.add(cap);
  } else {
    const shortsLeg = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.5, radius * 1.4, upperLen * 0.55, 7), sleeve);
    shortsLeg.position.y = -upperLen * 0.25;
    upper.add(shortsLeg);
  }

  const lower = new THREE.Group();
  lower.position.y = -upperLen;
  const lowerMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius * 0.7, lowerLen, 7), skin);
  lowerMesh.position.y = -lowerLen / 2;
  lower.add(lowerMesh);
  if (foot) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.28), foot);
    shoe.position.set(0, -lowerLen - 0.02, 0.06);
    lower.add(shoe);
  } else {
    const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 1.1, 0), skin);
    hand.position.y = -lowerLen - 0.03;
    lower.add(hand);
  }
  upper.add(lower);
  return { upper, lower };
}

function makeNumberTexture(num: number, kit: Kit): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 84px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = kit.outline;
  ctx.strokeText(String(num), 64, 68);
  ctx.fillStyle = kit.number;
  ctx.fillText(String(num), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
