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

export class PlayerView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly armL: Limb;
  private readonly armR: Limb;
  private readonly legL: Limb;
  private readonly legR: Limb;
  private runPhase = 0;

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

  update(p: PlayerState, pos: THREE.Vector3, facing: number, hasBall: boolean, defending: boolean, dt: number): void {
    this.root.position.copy(pos);
    this.root.rotation.y = facing;

    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.runPhase += dt * (4 + speed * 1.6);
    const stride = Math.min(1, speed / 5);
    const swing = Math.sin(this.runPhase) * stride;
    const airborne = pos.y > 0.02;

    // Legs.
    this.legL.upper.rotation.x = swing * 0.8;
    this.legR.upper.rotation.x = -swing * 0.8;
    this.legL.lower.rotation.x = Math.max(0, -Math.sin(this.runPhase)) * 1.2 * stride + 0.15;
    this.legR.lower.rotation.x = Math.max(0, Math.sin(this.runPhase)) * 1.2 * stride + 0.15;
    if (airborne) {
      this.legL.upper.rotation.x = -0.35;
      this.legR.upper.rotation.x = -0.15;
      this.legL.lower.rotation.x = 0.7;
      this.legR.lower.rotation.x = 0.4;
    }

    // Slight crouch and lean with speed.
    this.body.rotation.x = stride * 0.18;
    this.body.position.y = airborne ? 0 : -0.04 * stride - (hasBall ? 0.05 : 0) + Math.abs(swing) * 0.03;

    if (p.action === 'shooting' || p.action === 'release') {
      const t = p.action === 'release' ? 1 : Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
      const raise = -0.6 - 2.3 * t;
      this.armL.upper.rotation.set(raise, 0, 0.15);
      this.armR.upper.rotation.set(raise, 0, -0.15);
      const bend = p.action === 'release' ? 0.1 : 1.6 - 0.9 * t;
      this.armL.lower.rotation.x = -bend;
      this.armR.lower.rotation.x = -bend;
      this.body.rotation.x = 0;
    } else if (hasBall) {
      // Right hand pumps the dribble, left arm guards.
      const bounce = Math.abs(Math.sin(p.dribblePhase));
      this.armR.upper.rotation.set(-0.45, 0, -0.25);
      this.armR.lower.rotation.x = -0.4 - (1 - bounce) * 0.5;
      this.armL.upper.rotation.set(-0.5 - swing * 0.2, 0, 0.35);
      this.armL.lower.rotation.x = -0.9;
    } else if (defending && speed < 3.5) {
      // Defensive stance: low, arms wide.
      this.body.position.y -= 0.1;
      this.body.rotation.x = 0.25;
      this.armL.upper.rotation.set(-0.5, 0, 0.9);
      this.armR.upper.rotation.set(-0.5, 0, -0.9);
      this.armL.lower.rotation.x = -0.5;
      this.armR.lower.rotation.x = -0.5;
      if (!airborne) {
        this.legL.upper.rotation.x = -0.35 + swing * 0.4;
        this.legR.upper.rotation.x = -0.35 - swing * 0.4;
        this.legL.lower.rotation.x = 0.7;
        this.legR.lower.rotation.x = 0.7;
      }
    } else {
      this.armL.upper.rotation.set(-swing * 0.7, 0, 0.12);
      this.armR.upper.rotation.set(swing * 0.7, 0, -0.12);
      this.armL.lower.rotation.x = -0.4 - stride * 0.5;
      this.armR.lower.rotation.x = -0.4 - stride * 0.5;
    }
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
