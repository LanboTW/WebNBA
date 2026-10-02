import * as THREE from 'three';
import { SHOT_SWEET, type PlayerState, type TeamInfo } from '@webnba/shared';
import { BASE_HEIGHT, buildPlayerModel, type Kit, type Limb } from './playerModel';

export type { Kit };

/** Home wears white with team-colour trim; away wears the team colour. */
export function kitFor(team: TeamInfo, home: boolean): Kit {
  const own = team.primary === '#000000' ? team.secondary : team.primary;
  return home
    ? { body: '#f2f2f2', trim: team.primary, number: team.primary, outline: team.secondary, team: own }
    : { body: team.primary, trim: team.secondary, number: team.secondary === '#000000' ? '#ffffff' : team.secondary, outline: '#111111', team: own };
}

type OneShot = 'pass' | 'reach' | 'celebrate' | 'flop' | 'fouled';
const ONE_SHOT_SECONDS: Record<OneShot, number> = { pass: 0.35, reach: 0.35, celebrate: 1.3, flop: 1.1, fouled: 0.6 };

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
  private readonly body: THREE.Group;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly head: THREE.Group;
  private runPhase = 0;
  private clock = 0;
  private oneShot: OneShot | null = null;
  private oneShotT = 0;
  private readonly target: Pose = restPose();
  private readonly current: Pose = restPose();

  constructor(info: PlayerState['info'], kit: Kit) {
    const model = buildPlayerModel(info, kit);
    this.body = model.body;
    this.head = model.head;
    this.armL = model.armL;
    this.armR = model.armR;
    this.legL = model.legL;
    this.legR = model.legR;
    this.root.scale.setScalar(info.heightM / BASE_HEIGHT);
    this.root.add(this.body);
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
    if (shooting && p.shotKind === 'dunk') {
      const k = p.action === 'release' ? 1 : Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
      if (p.action === 'release' && airborne) {
        // Hanging on the rim: both hands up on the iron, knees tucked.
        t.armL = [-2.9, 0.3, -0.15];
        t.armR = [-2.9, -0.3, -0.15];
        t.legL = [-0.7, 1.3];
        t.legR = [-0.5, 1.1];
        t.lean = -0.1;
      } else {
        // Cock the ball back behind the head, then throw it down.
        const cock = Math.min(1, k * 1.4);
        const slam = Math.max(0, (k - 0.7) / 0.3);
        t.armL = [-1.2 - 1.9 * cock + 0.9 * slam, 0.25, -1.4 + 1.0 * cock];
        t.armR = [-1.2 - 1.9 * cock + 0.9 * slam, -0.25, -1.4 + 1.0 * cock];
        t.lean = -0.15 * cock + 0.35 * slam;
        t.legL = [-1.1, 1.3];
        t.legR = [0.2, 0.35];
      }
    } else if (shooting && p.shotKind === 'free' && !airborne) {
      // Set shot from the line: dip, then a straight follow-through.
      const k = p.action === 'release' ? 1 : Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
      t.armL = [-0.9 - 1.9 * k, 0.2, -1.5 + 1.3 * k];
      t.armR = [-0.9 - 2.1 * k, -0.15, -1.6 + 1.5 * k];
      t.bodyY = -0.07 * (1 - k);
      t.legL = [-0.25 * (1 - k), 0.5 * (1 - k)];
      t.legR = [-0.25 * (1 - k), 0.5 * (1 - k)];
      t.lean = 0;
    } else if (this.oneShot === 'flop' && !shooting) {
      // Took the charge: knocked back, arms flung up.
      const k = Math.sin(Math.min(1, this.oneShotT * 1.6) * Math.PI * 0.5);
      t.lean = -0.55 * k;
      t.bodyY = -0.25 * k;
      t.armL = [-2.4, 0.8, -0.3];
      t.armR = [-2.4, -0.8, -0.3];
      t.legL = [-0.9 * k, 1.2 * k];
      t.legR = [-0.6 * k, 0.9 * k];
    } else if (this.oneShot === 'fouled' && !shooting) {
      // Arms up, protesting the contact.
      const k = Math.sin(this.oneShotT * Math.PI);
      t.armL = [-1.6 * k, 0.6, -0.4];
      t.armR = [-1.6 * k, -0.6, -0.4];
      t.lean = -0.15 * k;
    } else if (shooting && p.shotKind === 'layup') {
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
    } else if (ctx.hasBall && p.dribbleDead) {
      // Dribble picked up: ball clutched at the chest, pivoting.
      t.armL = [-1.05, 0.4, -1.35];
      t.armR = [-1.05, -0.4, -1.35];
      t.lean = 0.1;
      t.legL = [-0.2, 0.35];
      t.legR = [0.1, 0.25];
    } else if (ctx.hasBall) {
      // Right hand pumps the dribble, left arm guards.
      const bounce = Math.abs(Math.sin(p.dribblePhase));
      t.armR = [-0.45, -0.25, -0.4 - (1 - bounce) * 0.5];
      t.armL = [-0.5 - swing * 0.2, 0.35, -0.9];
      t.bodyY -= 0.05;
    } else if (p.intenseD) {
      // Intense D: lower, one hand up to contest, the other active low at the ball.
      const flick = Math.sin(this.clock * 9) * 0.25;
      t.bodyY -= 0.16;
      t.lean = 0.3;
      t.armL = [-2.2, 0.45, -0.3];
      t.armR = [-0.9 + flick, -0.7, -0.35];
      if (!airborne) {
        t.legL = [-0.45 + swing * 0.35, 0.95];
        t.legR = [-0.45 - swing * 0.35, 0.95];
      }
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
