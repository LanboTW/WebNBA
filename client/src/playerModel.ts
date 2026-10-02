import * as THREE from 'three';
import type { Look, PlayerInfo } from '@webnba/shared';

export interface Kit {
  body: string;
  trim: string;
  number: string;
  outline: string;
  /** The team's own colour, for team-coloured shoes and headbands. */
  team: string;
}

/** Proportions are authored for a 2.0 m player and scaled to the real height. */
export const BASE_HEIGHT = 2.0;
export const THIGH = 0.5;
export const SHIN = 0.47;
export const UPPER_ARM = 0.33;
export const FOREARM = 0.3;
/** Hip joint height above the floor (ankle + shin + thigh). */
export const HIP_Y = THIGH + SHIN + 0.07;
export const SHOULDER_Y = HIP_Y + 0.58;
export const SHOULDER_X = 0.235;
export const HIP_X = 0.105;

export interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  /** Hand or foot, at the end of the lower segment. */
  end: THREE.Group;
}

export interface PlayerModel {
  body: THREE.Group;
  /** Rotates at the waist (lean, twist); everything above the shorts. */
  spine: THREE.Group;
  /** Pivot at the top of the neck. */
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
}

const SKIN = ['#eac0a0', '#d29a72', '#b0744c', '#8a5634', '#653d24', '#432819'];
const HAIR_DEFAULT = '#1d1612';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Players nobody has given a look yet still get a stable, plain one. */
export function fallbackLook(name: string): Look {
  const h = hash(name);
  return {
    skin: 3,
    hair: 'short',
    beard: 'none',
    headband: h % 7 === 0,
    sleeve: (['none', 'none', 'none', 'right', 'both'] as const)[(h >>> 3) % 5],
    kneepad: (h >>> 6) % 6 === 0,
    shoe: (['white', 'black', 'team'] as const)[(h >>> 9) % 3],
    socks: (h >>> 12) % 2 ? 'high' : 'low',
  };
}

export function skinColor(skin: Look['skin']): string {
  return typeof skin === 'string' ? skin : SKIN[Math.max(1, Math.min(6, Math.round(skin))) - 1];
}

const mat = (color: THREE.ColorRepresentation, roughness = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, ...extra });

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

/** A capsule from the group origin straight down by `len`. */
function segment(len: number, rTop: number, rBottom: number, material: THREE.Material): THREE.Mesh {
  const r = (rTop + rBottom) / 2;
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r * 0.6), 4, 10);
  // Taper: scale vertices by height so the top is rTop and the bottom rBottom.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + len / 2) / len; // 0 bottom .. 1 top
    const k = (rBottom + (rTop - rBottom) * Math.min(1, Math.max(0, t))) / r;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return mesh(geo, material, 0, -len / 2, 0);
}

export function buildPlayerModel(info: PlayerInfo, kit: Kit): PlayerModel {
  const look = info.look ?? fallbackLook(info.name);
  const skin = mat(skinColor(look.skin), 0.55);
  const jersey = mat(kit.body, 0.75);
  const trim = mat(kit.trim, 0.7);
  const hairMat = mat(look.hairColor ?? HAIR_DEFAULT, 0.95);
  const shoeColor = look.shoe === 'white' ? '#f4f4f4' : look.shoe === 'black' ? '#1b1b1f' : kit.team;
  const shoe = mat(shoeColor, 0.45);
  const sole = mat(look.shoe === 'white' ? '#d8d8d8' : '#f4f4f4', 0.6);
  const sock = mat('#f5f5f5', 0.85);
  const gear = mat(look.shoe === 'black' ? '#141418' : '#f2f2f2', 0.8);
  const band = mat(kit.team, 0.8);

  const body = new THREE.Group();

  // ---------------------------------------------------------------- lower body
  const shorts = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.24, 14), trim, 0, HIP_Y + 0.04, 0);
  shorts.scale.set(1.28, 1, 0.82);
  const waistband = mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 14), jersey, 0, HIP_Y + 0.15, 0);
  waistband.scale.set(1.28, 1, 0.82);
  body.add(shorts, waistband);

  // ---------------------------------------------------------------- upper body
  const spine = new THREE.Group();
  spine.position.y = HIP_Y + 0.12;
  body.add(spine);
  const y = (worldY: number) => worldY - spine.position.y;

  // Chest: a capsule squashed into an athletic, slightly tapered torso.
  const chest = segment(0.56, 0.2, 0.16, jersey);
  chest.position.y = y(HIP_Y + 0.68) - 0.28;
  chest.scale.set(1.25, 1, 0.68);
  spine.add(chest);

  // Trim around the neck and arm holes.
  const collar = mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 16), trim, 0, y(HIP_Y + 0.66), 0.02);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.scale.set(1.15, 1, 1);
  spine.add(collar);

  // Shoulders: skin domes where the sleeveless jersey leaves them bare.
  for (const s of [1, -1]) {
    const delt = mesh(new THREE.SphereGeometry(0.078, 12, 10), skin, s * SHOULDER_X, y(SHOULDER_Y) + 0.005, 0);
    delt.scale.set(1, 0.95, 1.05);
    spine.add(delt);
    const hole = mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14), trim, s * (SHOULDER_X - 0.04), y(SHOULDER_Y) - 0.06, 0);
    hole.rotation.y = Math.PI / 2;
    hole.rotation.x = 0.15;
    spine.add(hole);
  }

  // Number front and back.
  const numberTex = makeNumberTexture(info.number, kit);
  for (const side of [1, -1]) {
    const plate = mesh(
      new THREE.PlaneGeometry(0.26, 0.26),
      new THREE.MeshStandardMaterial({ map: numberTex, transparent: true, roughness: 0.75 }),
      0,
      y(HIP_Y + 0.4),
      side * 0.14,
    );
    if (side < 0) plate.rotation.y = Math.PI;
    spine.add(plate);
  }

  const neck = mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.1, 10), skin, 0, y(HIP_Y + 0.71), 0.005);
  spine.add(neck);

  const head = new THREE.Group();
  head.position.set(0, y(HIP_Y + 0.75), 0.01);
  spine.add(head);
  buildHead(head, look, skin, hairMat, band);

  // ---------------------------------------------------------------- limbs
  const sleeveMat = mat(look.shoe === 'black' ? '#141418' : '#f2f2f2', 0.85);
  const armL = makeArm(skin, look.sleeve === 'left' || look.sleeve === 'both' ? sleeveMat : null);
  const armR = makeArm(skin, look.sleeve === 'right' || look.sleeve === 'both' ? sleeveMat : null);
  armL.upper.position.set(SHOULDER_X, y(SHOULDER_Y), 0);
  armR.upper.position.set(-SHOULDER_X, y(SHOULDER_Y), 0);
  spine.add(armL.upper, armR.upper);

  const legOpts = { skin, trim, shoe, sole, sock, gear, kneepad: look.kneepad, highSocks: look.socks === 'high' };
  const legL = makeLeg(legOpts);
  const legR = makeLeg(legOpts);
  legL.upper.position.set(HIP_X, HIP_Y, 0);
  legR.upper.position.set(-HIP_X, HIP_Y, 0);
  body.add(legL.upper, legR.upper);

  body.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { body, spine, head, armL, armR, legL, legR };
}

function buildHead(head: THREE.Group, look: Look, skin: THREE.Material, hairMat: THREE.Material, band: THREE.Material): void {
  const cy = 0.115;
  const skull = mesh(new THREE.SphereGeometry(0.1, 20, 16), skin, 0, cy, 0);
  skull.scale.set(1, 1.2, 1.08);
  head.add(skull);
  // Jaw and chin, a little forward of the skull.
  const jaw = mesh(new THREE.SphereGeometry(0.075, 14, 10), skin, 0, cy - 0.06, 0.03);
  jaw.scale.set(1.05, 0.85, 1);
  head.add(jaw);
  const nose = mesh(new THREE.SphereGeometry(0.017, 10, 8), skin, 0, cy - 0.012, 0.1);
  nose.scale.set(0.85, 1.35, 0.9);
  head.add(nose);
  const mouth = mesh(new THREE.BoxGeometry(0.034, 0.005, 0.01), mat('#5a2a22', 0.8), 0, cy - 0.052, 0.098);
  head.add(mouth);
  for (const s of [1, -1]) {
    const ear = mesh(new THREE.SphereGeometry(0.024, 8, 6), skin, s * 0.1, cy, -0.005);
    ear.scale.set(0.5, 1.2, 0.9);
    head.add(ear);
    const eye = mesh(new THREE.SphereGeometry(0.0085, 8, 6), mat('#1a1410', 0.3), s * 0.034, cy + 0.018, 0.093);
    eye.scale.z = 0.6;
    head.add(eye);
    const brow = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), mat(look.hairColor ?? HAIR_DEFAULT, 0.9), s * 0.035, cy + 0.037, 0.094);
    brow.rotation.z = s * -0.1;
    head.add(brow);
  }

  // Hair: a cap over the skull, cut at a height set by the style, plus extras.
  const cap = (scale: number, cut: number) => {
    // cut: how far down the cap reaches, as a polar angle from the top.
    const geo = new THREE.SphereGeometry(0.1 * scale, 20, 12, 0, Math.PI * 2, 0, cut);
    const m = mesh(geo, hairMat, 0, cy + 0.005, -0.006);
    m.scale.set(1, 1.2, 1.08);
    // Lower at the back than at the front, like a real hairline.
    m.rotation.x = -0.35;
    head.add(m);
    return m;
  };
  switch (look.hair) {
    case 'buzz':
      cap(1.03, 1.15);
      break;
    case 'short':
      cap(1.07, 1.2);
      break;
    case 'afro': {
      const fro = mesh(new THREE.IcosahedronGeometry(0.145, 2), hairMat, 0, cy + 0.085, -0.045);
      fro.scale.set(1.05, 0.88, 0.85);
      head.add(fro);
      cap(1.05, 1.3);
      break;
    }
    case 'twists':
    case 'dreads': {
      cap(1.06, 1.3);
      const long = look.hair === 'dreads';
      const strand = new THREE.CylinderGeometry(0.011, 0.009, long ? 0.2 : 0.06, 5);
      for (let i = 0; i < (long ? 26 : 22); i++) {
        const a = (i / (long ? 26 : 22)) * Math.PI * 2;
        // Twists stand up over the crown; locs hang down the sides and back.
        if (long && Math.cos(a) > 0.55) continue; // keep the face clear
        const s = mesh(strand, hairMat);
        if (long) {
          s.position.set(Math.sin(a) * 0.105, cy - 0.04, Math.cos(a) * 0.105 - 0.01);
          s.rotation.set(Math.cos(a) * -0.25, 0, Math.sin(a) * 0.25);
        } else {
          const r = 0.06 + (i % 3) * 0.02;
          s.position.set(Math.sin(a) * r, cy + 0.11 - (i % 3) * 0.015, Math.cos(a) * r - 0.01);
          s.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
        }
        head.add(s);
      }
      break;
    }
    case 'long': {
      cap(1.07, 1.35);
      const tail = segment(0.24, 0.045, 0.03, hairMat);
      const pivot = new THREE.Group();
      pivot.position.set(0, cy + 0.02, -0.1);
      pivot.rotation.x = 0.25;
      pivot.add(tail);
      head.add(pivot);
      break;
    }
    case 'mohawk': {
      const ridge = mesh(new THREE.BoxGeometry(0.035, 0.06, 0.2), hairMat, 0, cy + 0.12, -0.01);
      head.add(ridge);
      cap(1.02, 0.9).scale.multiplyScalar(0.999);
      break;
    }
    case 'bald':
      break;
  }

  if (look.beard === 'stubble') {
    // Stubble: the jaw takes on a shadow of the hair colour.
    const tint = (skin as THREE.MeshStandardMaterial).color.clone().lerp((hairMat as THREE.MeshStandardMaterial).color, 0.4);
    jaw.material = mat(tint, 0.8);
  } else if (look.beard === 'full') {
    // The lower half of a slightly larger jaw, in hair colour.
    const geo = new THREE.SphereGeometry(0.077, 16, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    const beard = mesh(geo, hairMat, 0, cy - 0.058, 0.033);
    beard.scale.set(1.06, 0.95, 1.02);
    head.add(beard);
  }

  if (look.headband) {
    const hb = mesh(new THREE.CylinderGeometry(0.106, 0.106, 0.03, 20, 1, true), band, 0, cy + 0.065, -0.004);
    hb.scale.set(1.02, 1, 1.1);
    hb.rotation.x = -0.25;
    (band as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    head.add(hb);
  }
}

function makeArm(skin: THREE.Material, sleeve: THREE.Material | null): Limb {
  const upper = new THREE.Group();
  upper.add(segment(UPPER_ARM, 0.068, 0.052, skin));
  const lower = new THREE.Group();
  lower.position.y = -UPPER_ARM;
  lower.add(segment(FOREARM, 0.052, 0.038, skin));
  upper.add(lower);
  if (sleeve) {
    upper.add(segment(UPPER_ARM * 0.92, 0.071, 0.055, sleeve));
    lower.add(segment(FOREARM * 0.85, 0.055, 0.042, sleeve));
  }
  const end = new THREE.Group();
  end.position.y = -FOREARM;
  lower.add(end);
  // Hand: palm plus a thumb, slightly cupped.
  const palm = mesh(new THREE.CapsuleGeometry(0.024, 0.05, 3, 8), skin, 0, -0.045, 0.005);
  palm.scale.set(1.15, 1, 0.65);
  const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.03, 3, 6), skin, 0, -0.03, 0.025);
  thumb.rotation.x = 0.6;
  end.add(palm, thumb);
  return { upper, lower, end };
}

function makeLeg(o: {
  skin: THREE.Material;
  trim: THREE.Material;
  shoe: THREE.Material;
  sole: THREE.Material;
  sock: THREE.Material;
  gear: THREE.Material;
  kneepad: boolean;
  highSocks: boolean;
}): Limb {
  const upper = new THREE.Group();
  upper.add(segment(THIGH, 0.092, 0.068, o.skin));
  // Long, loose shorts down to just above the knee.
  const leg = mesh(new THREE.CylinderGeometry(0.105, 0.098, THIGH * 0.74, 12), o.trim, 0, -THIGH * 0.3, 0);
  upper.add(leg);

  const lower = new THREE.Group();
  lower.position.y = -THIGH;
  lower.add(segment(SHIN, 0.07, 0.044, o.skin));
  upper.add(lower);
  if (o.kneepad) {
    lower.add(mesh(new THREE.CylinderGeometry(0.07, 0.066, 0.1, 12), o.gear, 0, -0.06, 0));
  }
  const sockLen = o.highSocks ? SHIN * 0.5 : 0.08;
  const sock = mesh(new THREE.CylinderGeometry(0.052, 0.048, sockLen, 10), o.sock, 0, -SHIN + sockLen / 2, 0);
  lower.add(sock);

  const end = new THREE.Group();
  end.position.y = -SHIN;
  lower.add(end);
  // Shoe: rounded upper on a flat sole, toe forward (+z).
  const upperShoe = mesh(new THREE.CapsuleGeometry(0.058, 0.17, 4, 10), o.shoe, 0, -0.035, 0.055);
  upperShoe.rotation.x = Math.PI / 2;
  upperShoe.scale.set(1, 1, 0.85);
  const solePart = mesh(new THREE.BoxGeometry(0.118, 0.026, 0.3), o.sole, 0, -0.07, 0.055);
  end.add(upperShoe, solePart);
  return { upper, lower, end };
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
