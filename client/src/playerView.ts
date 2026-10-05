import * as THREE from 'three';
import { BALL_RADIUS, DEFENSE_SET_SPEED, SHOT_SWEET, type PlayerState, type TeamInfo } from '@webnba/shared';
import { BASE_HEIGHT, buildPlayerModel, type Kit, type Limb, type Wheelchair } from './playerModel';

export type { Kit };

/** Home wears white with team-colour trim; away wears the team colour. */
export function kitFor(team: TeamInfo, home: boolean): Kit {
  const own = team.primary === '#000000' ? team.secondary : team.primary;
  return home
    ? { body: '#f2f2f2', trim: team.primary, number: team.primary, outline: team.secondary, team: own, accent: team.secondary }
    : { body: team.primary, trim: team.secondary, number: team.secondary === '#000000' ? '#ffffff' : team.secondary, outline: '#111111', team: own, accent: team.secondary };
}

export type OneShot = 'pass' | 'lob' | 'reach' | 'celebrate' | 'flop' | 'fouled';
const ONE_SHOT_SECONDS: Record<OneShot, number> = { pass: 0.38, lob: 0.55, reach: 0.35, celebrate: 1.5, flop: 1.7, fouled: 0.6 };
type Celebration = 'fist' | 'point' | 'vee' | 'thump';
const CELEBRATIONS: Celebration[] = ['fist', 'point', 'vee', 'thump'];

export interface AnimContext {
  hasBall: boolean;
  defending: boolean;
  inbounding: boolean;
  /** A pass is on its way to this player. */
  catching: boolean;
  /** A shot is in the air or the ball is loose: time to box out and go get it. */
  rebounding: boolean;
  /** World position the head should track (usually the ball). */
  lookAt: THREE.Vector3;
}

/** Shoulder pitch (- raises forward), roll (+ out to the side), elbow (- bends), wrist (+ cocks back). */
type Arm = [number, number, number, number];
/** Hip pitch (- forward), knee (+ bends), hip roll (+ out to the side), ankle (+ points the toes). */
type Leg = [number, number, number, number];

interface Pose {
  /** Pelvis drop, whole-body pitch (+ forward), side tilt and twist. */
  bodyY: number;
  tilt: number;
  roll: number;
  hipYaw: number;
  /** Upper body at the waist: pitch (+ forward), twist, side bend. */
  lean: number;
  twist: number;
  side: number;
  /** Extra head pitch on top of following the ball (+ looks down). */
  headPitch: number;
  armL: Arm;
  armR: Arm;
  legL: Leg;
  legR: Leg;
}

const restPose = (): Pose => ({
  bodyY: 0,
  tilt: 0,
  roll: 0,
  hipYaw: 0,
  lean: 0.04,
  twist: 0,
  side: 0,
  headPitch: 0,
  armL: [0.05, 0.12, -0.25, 0],
  armR: [0.05, 0.12, -0.25, 0],
  legL: [0, 0.1, 0.03, 0],
  legR: [0, 0.1, 0.03, 0],
});

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Wheelchair: pushing the rims by hand below this speed (m/s), the motor above it. */
const MOTOR_SPEED = 3.5;

/** Dribble moves are purely visual: the sim keeps the ball on the right, we draw it where the hands are. */
type DribbleMove = 'cross' | 'legs' | 'behind';

export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body: THREE.Group;
  private readonly spine: THREE.Group;
  private readonly head: THREE.Group;
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private readonly bigMan: boolean;
  private readonly chair: Wheelchair | undefined;
  /** Wheelchair: wheel angle, push-stroke phase, and the chair's tip and turn. */
  private wheelAngle = 0;
  private pushPhase = 0;
  private chairPitch = 0;
  private chairYaw = 0;
  private runPhase = 0;
  private slidePhase = 0;
  private clock = Math.random() * 10;
  private oneShot: OneShot | null = null;
  private oneShotT = 0;
  private celebration: Celebration = 'fist';
  private wasAirborne = false;
  private landT = 0;
  private readonly target: Pose = restPose();
  private readonly current: Pose = restPose();

  // Dribbling: which hand has it (1 = right, the sim's side), and any move in progress.
  private hand: 1 | -1 = 1;
  private move: { kind: DribbleMove; from: 1 | -1 } | null = null;
  private dribbleIdx = Number.NaN;
  /** Where to draw the ball while this player dribbles. */
  readonly dribbleBall = new THREE.Vector3();
  dribbling = false;
  /** Chance per bounce of a show move while standing (the menu showcase turns it up). */
  flair = 0.1;

  constructor(info: PlayerState['info'], kit: Kit) {
    const model = buildPlayerModel(info, kit);
    this.body = model.body;
    this.spine = model.spine;
    this.head = model.head;
    this.armL = model.armL;
    this.armR = model.armR;
    this.legL = model.legL;
    this.legR = model.legR;
    this.chair = model.chair;
    this.bigMan = info.position === 'C' || info.position === 'PF';
    this.root.scale.setScalar(info.heightM / BASE_HEIGHT);
    this.root.add(model.root);
  }

  /** Plays a one-shot animation driven by a game event. */
  trigger(kind: OneShot): void {
    this.oneShot = kind;
    this.oneShotT = 0;
    if (kind === 'celebrate') this.celebration = CELEBRATIONS[Math.floor(Math.random() * CELEBRATIONS.length)];
  }

  update(p: PlayerState, pos: THREE.Vector3, facing: number, ctx: AnimContext, dt: number): void {
    this.root.position.copy(pos);
    this.root.rotation.y = facing;
    this.clock += dt;

    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const vFwd = p.vel.x * fx + p.vel.z * fz;
    // The sim's "right" (where it keeps the ball) is the model's -x side.
    const vRight = p.vel.x * -fz + p.vel.z * fx;
    const airborne = pos.y > 0.02;
    if (this.wasAirborne && !airborne) this.landT = 0.22;
    this.wasAirborne = airborne;
    this.landT = Math.max(0, this.landT - dt);

    if (this.oneShot) {
      this.oneShotT += dt / ONE_SHOT_SECONDS[this.oneShot];
      if (this.oneShotT >= 1) this.oneShot = null;
    }

    const t = this.target;
    Object.assign(t, restPose());
    const shooting = p.action === 'shooting' || p.action === 'release';
    const k = p.action === 'release' ? 1 : clamp01(Math.max(0, p.shotMeter) / SHOT_SWEET);
    // Pressure D only shows while actually guarding someone.
    const pressure = p.intenseD && ctx.defending;
    // Running back or chasing, a defender pumps his arms like anyone else: no stance.
    const running = speed > DEFENSE_SET_SPEED && !(ctx.defending && Math.abs(vRight) > Math.abs(vFwd) * 0.9);
    const guarding = ctx.defending && !running;
    const sliding = guarding && !airborne && speed > 0.6 && Math.abs(vRight) > Math.abs(vFwd) * 0.9;

    // ---------------------------------------------------------------- legs and body
    if (this.chair) this.wheel(dt, speed, vFwd, vRight, guarding);
    else if (sliding) this.slide(dt, speed, vRight, pressure);
    else if (speed > 0.3) this.run(dt, speed, vFwd);
    else this.idle(guarding);

    if (airborne) {
      t.legL = [-0.45, 0.8, 0.06, 0.45];
      t.legR = [-0.15, 0.45, 0.06, 0.55];
      t.bodyY = 0;
    } else if (this.landT > 0) {
      const a = this.landT / 0.22;
      t.bodyY -= 0.12 * a;
      t.legL[1] += 0.6 * a;
      t.legR[1] += 0.6 * a;
      t.legL[0] -= 0.3 * a;
      t.legR[0] -= 0.3 * a;
    }

    // ---------------------------------------------------------------- actions, most specific first
    this.dribbling = false;
    if (!ctx.hasBall) {
      // A new possession starts in the right hand, where the sim has the ball.
      this.hand = 1;
      this.move = null;
      this.dribbleIdx = Number.NaN;
    }
    if (shooting && p.shotKind === 'dunk') this.dunk(p, k, airborne);
    else if (shooting && p.shotKind === 'free' && !airborne) this.freeThrow(k);
    else if (this.oneShot === 'flop' && !shooting) this.fall(this.oneShotT);
    else if (this.oneShot === 'fouled' && !shooting) this.fouled(this.oneShotT);
    else if (shooting && p.shotKind === 'layup') this.layup(p, k, airborne);
    else if (shooting) this.jumper(p, k, airborne);
    else if (this.oneShot === 'pass' || this.oneShot === 'lob') this.pass(this.oneShot, this.oneShotT);
    else if (this.oneShot === 'reach') this.reach(this.oneShotT);
    else if (this.oneShot === 'celebrate' && !ctx.hasBall && !airborne) this.celebrate(this.oneShotT);
    else if (ctx.inbounding) {
      t.armL = [-2.55, 0.25, -0.85, 0.3];
      t.armR = [-2.55, 0.25, -0.85, 0.3];
      t.lean = 0;
      t.headPitch = -0.1;
    } else if (airborne && !ctx.hasBall) {
      // Block, rebound or tip: reach for the ball with both hands.
      t.armL = [-2.95, 0.22, -0.08, -0.2];
      t.armR = [-2.95, 0.22, -0.08, -0.2];
      t.lean = -0.05;
    } else if (airborne && ctx.hasBall) {
      // Just grabbed it: chin the ball, elbows out.
      t.armL = [-1.25, 0.65, -1.95, 0];
      t.armR = [-1.25, 0.65, -1.95, 0];
      t.legL = [-0.3, 0.6, 0.18, 0.3];
      t.legR = [-0.3, 0.6, 0.18, 0.3];
    } else if (ctx.catching) {
      // Hands up and out to receive the pass.
      t.armL = [-1.35, 0.3, -0.35, 0.3];
      t.armR = [-1.35, 0.3, -0.35, 0.3];
    } else if (ctx.hasBall && p.dribbleDead) {
      // Dribble picked up: ball clutched at the chest, pivoting.
      t.armL = [-1.05, 0.4, -1.4, 0];
      t.armR = [-1.05, 0.4, -1.4, 0];
      t.lean = 0.12;
      t.legL = [-0.2, 0.35, 0.12, 0];
      t.legR = [0.1, 0.25, 0.12, 0];
    } else if (ctx.hasBall) {
      this.dribble(p, pos, fx, fz, speed, vRight);
    } else if (ctx.rebounding && !airborne && this.boxOut(pos, ctx.lookAt)) {
      // Boxing out.
    } else if (pressure && guarding) {
      // Pressure: low, one hand up to contest, the other active at the ball.
      const flick = Math.sin(this.clock * 9) * 0.25;
      t.armL = [-2.2, 0.45, -0.3, 0];
      t.armR = [-0.9 + flick, 0.7, -0.35, 0];
    } else if (guarding) {
      // Stance: arms wide, hands active.
      const wave = Math.sin(this.clock * 3.1) * 0.15;
      t.armL = [-0.55 + wave, 0.95, -0.55, 0.2];
      t.armR = [-0.55 - wave, 0.95, -0.55, 0.2];
    }
    if (this.chair) this.sit(dt, airborne);

    this.blend(dt);
    this.aimHead(ctx.lookAt, dt);
  }

  // ------------------------------------------------------------------ locomotion

  private run(dt: number, speed: number, vFwd: number): void {
    const t = this.target;
    const back = vFwd < -0.5;
    // Cadence rises with speed, and so does the stride.
    this.runPhase += dt * (5 + speed * 1.35) * (back ? -1 : 1);
    const ph = this.runPhase;
    const stride = Math.min(1, speed / 6.5);
    const sprint = clamp01((speed - 5) / 2.5);
    const legs = (side: number): Leg => {
      const a = ph + side;
      const s = Math.sin(a);
      const c = Math.cos(a);
      // The knee folds while the leg swings forward, nearly straight at foot strike.
      const knee = 0.15 + (0.5 + 1.1 * stride) * Math.max(0, c) ** 1.5 + 0.2 * stride * Math.max(0, -c);
      const hip = -s * (0.35 + 0.55 * stride);
      // Foot flat while planted, toes pushing off behind.
      const ankle = Math.max(0, s) * -0.2 + Math.max(0, -s) * 0.5 * stride;
      return [hip, knee, 0.03, ankle];
    };
    t.legL = legs(0);
    t.legR = legs(Math.PI);
    const swing = Math.sin(ph);
    // Arms pump opposite the legs, elbows tighter at a sprint.
    t.armL = [swing * (0.35 + 0.55 * stride), 0.12, -0.5 - 0.6 * stride - 0.3 * sprint, 0];
    t.armR = [-swing * (0.35 + 0.55 * stride), 0.12, -0.5 - 0.6 * stride - 0.3 * sprint, 0];
    t.bodyY = -0.035 * stride + Math.abs(Math.cos(ph)) * 0.04 * stride;
    t.lean = 0.06 + 0.16 * stride + 0.08 * sprint - (back ? 0.15 : 0);
    t.twist = swing * 0.12 * stride;
    t.hipYaw = -swing * 0.08 * stride;
    t.roll = Math.cos(ph) * 0.03 * stride;
  }

  /** Wheelchair: pushing the rims by hand when slow, the motor and joystick when fast; on defence it turns side to side. */
  private wheel(dt: number, speed: number, vFwd: number, vRight: number, guarding: boolean): void {
    const t = this.target;
    const c = this.chair!;
    const scale = this.root.scale.x;
    // Rolling: forward or back with the body, otherwise (turning on the spot) just forward.
    const roll = speed > 0.3 ? (Math.abs(vFwd) > 0.3 ? vFwd : speed) : 0;
    this.wheelAngle += (roll / (0.3 * scale)) * dt;
    for (const w of c.wheels) w.rotation.x = this.wheelAngle;
    const k = 1 - Math.exp(-dt * 8);
    // Casters trail the way the chair moves (the sim's right is the model's -x).
    const yaw = speed > 0.3 ? Math.atan2(-vRight, vFwd) : 0;
    for (const cs of c.casters) {
      cs.spin.rotation.x += ((speed * dt) / (0.07 * scale)) * (speed > 0.3 ? 1 : 0);
      let d = yaw - cs.swivel.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      cs.swivel.rotation.y += d * k;
    }
    const motor = speed >= MOTOR_SPEED;
    c.led.emissiveIntensity = motor ? 2.5 : 0;
    const turn = guarding ? Math.sin(this.clock * (speed > 0.6 ? 6 : 3)) * (speed > 0.6 ? 0.28 : 0.15) : 0;
    this.chairYaw += (turn - this.chairYaw) * k;
    c.pivot.rotation.y = this.chairYaw;
    if (motor) {
      // Right hand on the joystick, left on the armrest; the motor hums through the frame.
      t.armR = [-0.15, 0.12, -1.45, 0.1];
      t.armL = [-0.1, 0.15, -1.35, 0];
      t.lean = -0.02;
      t.bodyY = Math.sin(this.clock * 55) * 0.004;
    } else if (speed > 0.3) {
      // Both hands drive the push rims forward, then swing back for the next stroke.
      this.pushPhase += dt * (2.2 + speed * 0.9) * (vFwd < -0.3 ? -1 : 1);
      const s = Math.sin(this.pushPhase);
      const arm: [number, number, number, number] = [-0.1 - 0.35 * s, 0.34, -0.35 + 0.25 * s, 0];
      t.armL = [...arm];
      t.armR = [...arm];
      t.lean = 0.18 + 0.08 * s;
    } else {
      // Hands resting on the rims.
      const breathe = Math.sin(this.clock * 1.7);
      t.armL = [0.15, 0.32, -0.7, 0];
      t.armR = [0.15, 0.32, -0.7, 0];
      t.lean = 0.06 + breathe * 0.012;
    }
  }

  /** Wheelchair, after every action: legs stay seated, the chair (not the hips) tips for jumps, landings and falls. */
  private sit(dt: number, airborne: boolean): void {
    const t = this.target;
    t.legL = [-1.5, 1.52, 0.07, 0];
    t.legR = [-1.5, 1.52, 0.07, 0];
    t.bodyY = Math.max(-0.02, Math.min(0.05, t.bodyY));
    t.tilt = 0;
    t.hipYaw = 0;
    t.roll = 0;
    t.lean = Math.max(-0.15, Math.min(0.5, t.lean));
    let pitch = 0;
    if (this.oneShot === 'flop') {
      // Over backwards, a beat on the floor, then back on the wheels.
      const u = this.oneShotT;
      pitch = -1.2 * smooth(u / 0.3) * (1 - smooth((u - 0.65) / 0.35));
    } else if (airborne) pitch = -0.35;
    else if (this.landT > 0) pitch = 0.08 * (this.landT / 0.22);
    this.chairPitch += (pitch - this.chairPitch) * (1 - Math.exp(-dt * 10));
    this.chair!.pivot.rotation.x = this.chairPitch;
  }

  /** Defensive slide: wide, low, feet never cross. */
  private slide(dt: number, speed: number, vRight: number, intense: boolean): void {
    const t = this.target;
    this.slidePhase += dt * (6 + speed * 1.6);
    const s = Math.sin(this.slidePhase);
    // Moving to the model's +x (left) means vRight < 0.
    const dir = vRight < 0 ? 1 : -1;
    const lead = 0.32 + 0.12 * Math.max(0, s);
    const trail = 0.18 + 0.12 * Math.max(0, -s);
    t.bodyY = -0.17 - (intense ? 0.04 : 0) + Math.abs(s) * 0.02;
    t.lean = 0.32;
    t.tilt = 0.06;
    t.legL = [-0.45, 0.95, dir > 0 ? lead : trail, -0.35];
    t.legR = [-0.45, 0.95, dir > 0 ? trail : lead, -0.35];
    t.roll = dir * 0.04;
    t.armL = [-0.6, 1.05, -0.5, 0.2];
    t.armR = [-0.6, 1.05, -0.5, 0.2];
  }

  private idle(guarding: boolean): void {
    const t = this.target;
    const breathe = Math.sin(this.clock * 1.7);
    const shift = Math.sin(this.clock * 0.55);
    if (guarding) {
      // Stance, bouncing lightly on the toes.
      const bounce = Math.abs(Math.sin(this.clock * 4.2)) * 0.015;
      t.bodyY = -0.14 + bounce;
      t.lean = 0.3;
      t.tilt = 0.05;
      t.legL = [-0.42, 0.9, 0.24, -0.3];
      t.legR = [-0.42, 0.9, 0.24, -0.3];
      return;
    }
    t.bodyY = -0.01;
    t.lean = 0.05 + breathe * 0.012;
    t.roll = shift * 0.025;
    t.side = -shift * 0.03;
    t.legL = [0.02, 0.12 + Math.max(0, shift) * 0.12, 0.05, 0];
    t.legR = [0.02, 0.12 + Math.max(0, -shift) * 0.12, 0.05, 0];
    t.armL = [0.04, 0.14 + breathe * 0.02, -0.3, 0.1];
    t.armR = [0.04, 0.14 + breathe * 0.02, -0.3, 0.1];
  }

  // ------------------------------------------------------------------ ball handling

  private dribble(p: PlayerState, pos: THREE.Vector3, fx: number, fz: number, speed: number, vRight: number): void {
    const t = this.target;
    // u: 0 when the ball is in the hand, 0.5 on the floor, 1 back in a hand.
    const hp = p.dribblePhase / Math.PI - 0.5;
    const idx = Math.floor(hp);
    const u = hp - idx;
    if (idx !== this.dribbleIdx) {
      if (this.move) this.hand = this.hand === this.move.from ? ((-this.move.from) as 1 | -1) : this.hand;
      this.move = null;
      if (!Number.isNaN(this.dribbleIdx)) this.move = this.pickMove(speed, vRight);
      this.dribbleIdx = idx;
    }

    // Ball position across the body (+1 right, -1 left) and forward of it.
    // From a wheelchair the ball goes down outside the wheel.
    const wide = this.chair ? 0.48 : 0.32;
    let side: number = this.hand;
    let fwd = this.chair ? 0.18 : 0.28;
    if (this.move) {
      const m = smooth(u);
      side = mix(this.move.from, -this.move.from, m);
      const dip = Math.sin(u * Math.PI);
      if (this.move.kind === 'legs') fwd = 0.28 - 0.3 * dip;
      else if (this.move.kind === 'behind') fwd = 0.28 - 0.62 * dip;
      else fwd = 0.34;
    }
    const bounce = Math.abs(Math.sin(p.dribblePhase));
    const h = p.info.heightM;
    const rx = -fz;
    const rz = fx;
    this.dribbleBall.set(
      pos.x + rx * wide * side + fx * fwd,
      BALL_RADIUS + bounce * (h * (this.chair ? 0.3 : 0.45) - BALL_RADIUS),
      pos.z + rz * wide * side + fz * fwd,
    );
    this.dribbling = true;

    // The hand on the ball pumps; the free one guards. Mid-move, the ball changes hands at the floor.
    const active = this.move ? (u < 0.5 ? this.move.from : -this.move.from) : this.hand;
    const pump: Arm = [-0.45 - 0.2 * bounce, this.chair ? 0.55 : 0.28, -0.35 - (1 - bounce) * 0.55, 0.35 * (1 - bounce)];
    const guard: Arm = [-0.75, 0.5, -1.0, 0];
    if (this.move?.kind === 'behind' && u > 0.15 && u < 0.6) {
      // Wrap the ball around the back.
      const wrap: Arm = [0.55, 0.3, -0.6, 0.2];
      if (this.move.from === 1) t.armR = wrap;
      else t.armL = wrap;
      if (this.move.from === 1) t.armL = guard;
      else t.armR = guard;
    } else {
      t.armR = active === 1 ? pump : guard;
      t.armL = active === 1 ? guard : pump;
    }
    t.bodyY -= 0.06;
    t.lean += 0.08;
    if (this.move) {
      // Sell the move: dip, lean into it, and (between the legs) step through.
      const d = Math.sin(u * Math.PI);
      t.bodyY -= 0.06 * d;
      t.side = -0.1 * this.move.from * d;
      t.twist = 0.15 * this.move.from * d;
      if (this.move.kind === 'legs' && speed < 3) {
        const ballLeg = this.move.from === 1 ? t.legR : t.legL;
        const other = this.move.from === 1 ? t.legL : t.legR;
        ballLeg[0] = -0.5 * d;
        ballLeg[1] = 0.6 * d + 0.2;
        other[0] = 0.25 * d;
        ballLeg[2] = other[2] = 0.2 * d + 0.05;
      }
    }
  }

  /** Chooses a move for the next bounce: cross toward where we are heading, sometimes just for show. */
  private pickMove(speed: number, vRight: number): { kind: DribbleMove; from: 1 | -1 } | null {
    const move = this.pickAnyMove(speed, vRight);
    // Nothing goes between the legs of a seated player.
    return move && this.chair && move.kind === 'legs' ? { ...move, kind: 'cross' } : move;
  }

  private pickAnyMove(speed: number, vRight: number): { kind: DribbleMove; from: 1 | -1 } | null {
    const r = Math.random();
    // Heading away from the ball hand: switch hands.
    if (vRight * this.hand < -1.5 && r < 0.75) return { kind: r < 0.5 ? 'cross' : r < 0.65 ? 'legs' : 'behind', from: this.hand };
    if (speed < 2.5 && r < this.flair) {
      const k = r / this.flair;
      return { kind: k < 0.45 ? 'cross' : k < 0.85 ? 'legs' : 'behind', from: this.hand };
    }
    return null;
  }

  // ------------------------------------------------------------------ shots

  private jumper(p: PlayerState, k: number, airborne: boolean): void {
    const t = this.target;
    const release = p.action === 'release';
    if (!airborne && !release) {
      // Gather: sit into the legs, ball to the chest and up to the set point.
      t.bodyY = -0.12 * (1 - k * 0.5);
      t.legL = [-0.35, 0.75, 0.1, -0.2];
      t.legR = [-0.35, 0.75, 0.1, -0.2];
      t.lean = 0.12;
      t.armR = [-1.2 - 1.2 * k, 0.2, -1.7, 0.6];
      t.armL = [-1.2 - 1.0 * k, 0.4, -1.5, 0];
      return;
    }
    // In the air: legs together, toes pointed, a slight forward kick.
    t.legL = [-0.2, 0.25, 0.04, 0.6];
    t.legR = [-0.12, 0.2, 0.04, 0.6];
    t.lean = -0.04;
    t.headPitch = -0.15;
    if (!release) {
      // Set point above the forehead, wrist cocked; the guide hand on the side.
      t.armR = [-2.55 - 0.3 * k, 0.15, -1.5 + 0.4 * k, 0.9];
      t.armL = [-2.4, 0.45, -1.25, 0.2];
    } else {
      // Follow-through: arm locked out, wrist snapped down (the gooseneck), guide hand off.
      t.armR = [-2.95, 0.1, -0.05, -1.1];
      t.armL = [-2.2, 0.55, -0.6, 0];
    }
  }

  private freeThrow(k: number): void {
    const t = this.target;
    const release = k >= 1;
    t.bodyY = -0.08 * (1 - k);
    t.legL = [-0.25 * (1 - k), 0.5 * (1 - k) + 0.05, 0.1, release ? 0.35 : -0.15];
    t.legR = [-0.25 * (1 - k), 0.5 * (1 - k) + 0.05, 0.1, release ? 0.35 : -0.15];
    t.lean = 0.04;
    if (!release) {
      t.armR = [-0.9 - 1.9 * k, 0.15, -1.65 + 0.6 * k, 0.8];
      t.armL = [-0.9 - 1.7 * k, 0.4, -1.5 + 0.4 * k, 0.2];
    } else {
      t.armR = [-2.85, 0.1, -0.08, -1.0];
      t.armL = [-2.3, 0.5, -0.5, 0];
    }
  }

  private layup(p: PlayerState, k: number, airborne: boolean): void {
    const t = this.target;
    // Right-hand finish off the left foot: left knee drives up, right leg trails.
    t.legL = [-1.35, 1.45, 0.06, 0.3];
    t.legR = [0.25, 0.35, 0.05, 0.7];
    t.lean = 0.06;
    t.twist = -0.1;
    t.armL = [-1.3, 0.55, -1.2, 0];
    if (!airborne) {
      t.bodyY = -0.08;
      t.legR = [-0.2, 0.6, 0.05, 0];
      t.armR = [-1.3 - 0.6 * k, 0.2, -1.4, 0.3];
      return;
    }
    const release = p.action === 'release';
    // Reach up and roll it off the fingertips.
    t.armR = [-2.3 - 0.65 * k, 0.12, -0.7 + 0.6 * k, release ? -0.7 : 0.3];
    t.headPitch = -0.25;
  }

  private dunk(p: PlayerState, k: number, airborne: boolean): void {
    const t = this.target;
    if (p.action === 'release' && airborne) {
      // Hanging on the rim: hands on the iron, knees bent, swinging a little.
      const swing = Math.sin(this.clock * 6) * 0.08;
      t.armL = [-2.95, 0.3, -0.12, 0];
      t.armR = [-2.95, 0.3, -0.12, 0];
      t.legL = [-0.35 + swing, 0.9, 0.12, 0.4];
      t.legR = [-0.15 + swing, 0.7, 0.12, 0.4];
      t.tilt = -0.08;
      t.lean = -0.06;
      return;
    }
    if (!airborne) {
      // Load up for the jump.
      t.bodyY = -0.15;
      t.legL = [-0.55, 1.0, 0.1, -0.3];
      t.legR = [-0.3, 0.8, 0.1, -0.3];
      t.lean = 0.25;
      t.armL = [-0.9, 0.35, -1.3, 0];
      t.armR = [-0.9, 0.35, -1.3, 0];
      return;
    }
    const cock = smooth(k * 1.4);
    const slam = smooth((k - 0.7) / 0.3);
    t.headPitch = -0.2;
    if (this.bigMan) {
      // Two-handed power dunk: knees tucked, ball cocked behind the head.
      t.legL = [-0.9, 1.4, 0.15, 0.4];
      t.legR = [-0.8, 1.3, 0.15, 0.4];
      const arm: Arm = [-1.3 - 1.9 * cock + 0.9 * slam, 0.25, -1.4 + 1.0 * cock + 0.3 * slam, 0.4 - 1.0 * slam];
      t.armL = arm;
      t.armR = [...arm];
      t.lean = -0.15 * cock + 0.35 * slam;
    } else {
      // One-hand tomahawk: knee drive, the ball swung back and thrown down.
      t.legL = [-1.3, 1.5, 0.08, 0.3];
      t.legR = [0.15, 0.4, 0.06, 0.7];
      t.armR = [-1.3 - 2.0 * cock + 1.0 * slam, 0.2, -1.5 + 1.1 * cock + 0.3 * slam, 0.5 - 1.2 * slam];
      t.armL = [-1.6, 0.6, -0.8, 0];
      t.lean = -0.2 * cock + 0.4 * slam;
      t.twist = -0.15 * cock;
    }
  }

  // ------------------------------------------------------------------ other actions

  private pass(kind: 'pass' | 'lob', u: number): void {
    const t = this.target;
    // Step into it with the lead foot.
    t.legL = [-0.45, 0.45, 0.08, -0.1];
    t.legR = [0.2, 0.3, 0.08, 0.3];
    if (kind === 'lob') {
      // Two-hand overhead: from behind the head, over the top.
      const ext = smooth(u * 1.8);
      const arm: Arm = [-2.9 + 0.8 * ext, 0.3, -1.6 + 1.5 * ext, 0.6 - 1.2 * ext];
      t.armL = arm;
      t.armR = [...arm];
      t.lean = -0.1 + 0.35 * ext;
      return;
    }
    // Chest pass: punch out, thumbs down at the finish.
    const ext = smooth(u * 2.5);
    const arm: Arm = [-1.25 - 0.3 * ext, 0.3 - 0.2 * ext, -1.55 + 1.5 * ext, 0.4 - 1.1 * ext];
    t.armL = arm;
    t.armR = [...arm];
    t.lean = 0.12 + 0.18 * ext;
  }

  private reach(u: number): void {
    const t = this.target;
    // Swipe with the right hand, lunging onto the lead foot.
    const k = Math.sin(u * Math.PI);
    t.armR = [-0.6 - 1.0 * k, 0.35, -0.1, -0.4 * k];
    t.armL = [-0.3, 0.6, -0.6, 0];
    t.lean = 0.25 + 0.3 * k;
    t.twist = -0.2 * k;
    t.legR = [-0.6 * k, 0.6 * k + 0.2, 0.1, -0.2];
    t.legL = [0.25 * k, 0.4, 0.1, 0.3];
    t.bodyY = -0.08 * k;
  }

  private celebrate(u: number): void {
    const t = this.target;
    const pump = Math.abs(Math.sin(u * Math.PI * 3));
    switch (this.celebration) {
      case 'fist':
        t.armR = [-2.8, 0.15, -0.4 - 0.6 * pump, 0];
        t.armL = [-0.2, 0.25, -0.5, 0];
        t.lean = -0.05;
        break;
      case 'point':
        // One finger to the sky.
        t.armR = [-3.05, 0.05, 0, -0.3];
        t.armL = [0.1, 0.2, -0.3, 0];
        t.headPitch = -0.45;
        t.lean = -0.1;
        break;
      case 'vee':
        // Both arms up and wide, a little hop.
        t.armL = [-2.7, 0.6, -0.1, 0];
        t.armR = [-2.7, 0.6, -0.1, 0];
        t.bodyY = pump * 0.05;
        t.legL[3] = t.legR[3] = 0.3 * pump;
        break;
      case 'thump':
        // Fist to the chest, twice.
        t.armR = [-1.0 - 0.3 * pump, -0.35, -2.2, 0];
        t.armL = [-0.2, 0.3, -0.6, 0];
        t.lean = 0.05 - 0.08 * pump;
        t.headPitch = 0.15;
        break;
    }
  }

  /** Took the charge: knocked back to the floor, a beat sitting, then up again. */
  private fall(u: number): void {
    const t = this.target;
    const down = smooth(u / 0.3);
    const up = smooth((u - 0.65) / 0.35);
    const k = down * (1 - up);
    t.tilt = -1.15 * k;
    t.bodyY = -0.62 * k;
    t.lean = 0.35 * k;
    t.legL = [-1.45 * k, 1.3 * k + 0.1, 0.15, 0];
    t.legR = [-1.2 * k, 0.9 * k + 0.1, 0.2, 0];
    // Arms fling up, then reach back to break the fall.
    t.armL = u < 0.2 ? [-2.4, 0.8, -0.3, 0] : [0.7 * k, 0.45, -0.2, -0.5 * k];
    t.armR = u < 0.2 ? [-2.4, 0.8, -0.3, 0] : [0.7 * k, 0.45, -0.2, -0.5 * k];
    t.headPitch = 0.3 * k;
  }

  private fouled(u: number): void {
    const t = this.target;
    // Arms out, protesting the contact.
    const k = Math.sin(u * Math.PI);
    t.armL = [-1.6 * k, 0.65, -0.4, -0.3 * k];
    t.armR = [-1.6 * k, 0.65, -0.4, -0.3 * k];
    t.lean = -0.15 * k;
    t.headPitch = -0.2 * k;
  }

  /** Shot in the air near us: wide base, arms up, sealing the man behind. */
  private boxOut(pos: THREE.Vector3, ball: THREE.Vector3): boolean {
    if (Math.hypot(ball.x - pos.x, ball.z - pos.z) > 6) return false;
    const t = this.target;
    t.bodyY = -0.15;
    t.lean = 0.28;
    t.tilt = 0.04;
    t.legL = [-0.4, 0.85, 0.3, -0.3];
    t.legR = [-0.4, 0.85, 0.3, -0.3];
    t.armL = [-1.4, 0.75, -0.9, 0.3];
    t.armR = [-1.4, 0.75, -0.9, 0.3];
    t.headPitch = -0.3;
    return true;
  }

  // ------------------------------------------------------------------ apply

  private aimHead(lookAt: THREE.Vector3, dt: number): void {
    // Keep an eye on the ball, within what a neck can do.
    const local = this.root.worldToLocal(lookAt.clone());
    const yaw = Math.max(-1, Math.min(1, Math.atan2(local.x, local.z)));
    const eye = 1.75;
    const pitch = Math.max(-0.6, Math.min(0.5, Math.atan2(eye - local.y, Math.hypot(local.x, local.z) + 0.3) * 0.6));
    const k = Math.min(1, dt * 8);
    this.head.rotation.y += (yaw - this.head.rotation.y) * k;
    this.head.rotation.x += (pitch + this.current.headPitch - this.head.rotation.x) * k;
  }

  /** Ease every joint toward its target so pose changes never snap. */
  private blend(dt: number): void {
    const k = 1 - Math.exp(-dt * 16);
    const c = this.current;
    const t = this.target;
    const m = (a: number, b: number) => a + (b - a) * k;
    for (const key of ['bodyY', 'tilt', 'roll', 'hipYaw', 'lean', 'twist', 'side', 'headPitch'] as const) c[key] = m(c[key], t[key]);
    for (const key of ['armL', 'armR', 'legL', 'legR'] as const) for (let i = 0; i < 4; i++) c[key][i] = m(c[key][i], t[key][i]);

    this.body.position.y = c.bodyY;
    this.body.rotation.set(c.tilt, c.hipYaw, c.roll);
    this.spine.rotation.set(c.lean, c.twist, c.side);
    // Roll is "outward" for both sides, so the right side mirrors it.
    this.applyArm(this.armL, c.armL, 1);
    this.applyArm(this.armR, c.armR, -1);
    this.applyLeg(this.legL, c.legL, 1);
    this.applyLeg(this.legR, c.legR, -1);
  }

  private applyArm(limb: Limb, a: Arm, mirror: number): void {
    limb.upper.rotation.set(a[0], 0, mirror * a[1]);
    limb.lower.rotation.x = a[2];
    limb.end.rotation.x = a[3];
  }

  private applyLeg(limb: Limb, l: Leg, mirror: number): void {
    limb.upper.rotation.set(l[0], 0, mirror * l[2]);
    limb.lower.rotation.x = l[1];
    // Keep the sole roughly level with the floor, plus the pose's own ankle angle.
    limb.end.rotation.x = -(l[0] + l[1] + this.current.tilt) * 0.85 + l[3];
  }
}
