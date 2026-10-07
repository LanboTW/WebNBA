import * as THREE from 'three';
import type { Look, PlayerInfo } from '@webnba/shared';

export interface Kit {
  body: string;
  trim: string;
  number: string;
  outline: string;
  /** The team's own colour, for team-coloured shoes and headbands. */
  team: string;
  /** The team's second colour (wheelchair frames). */
  accent: string;
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
/** Seated in a wheelchair: hip height, and the whole model's top as a share of standing height. */
export const SEAT_HIP = 0.6;
export const SEATED = (BASE_HEIGHT - HIP_Y + SEAT_HIP) / BASE_HEIGHT;

/** How high the model's head really reaches (a seated player is shorter). */
export function modelTop(info: PlayerInfo): number {
  return info.look?.body === 'wheelchair' ? info.heightM * SEATED : info.heightM;
}

export interface Limb {
  upper: THREE.Group;
  lower: THREE.Group;
  /** Hand or foot, at the end of the lower segment. */
  end: THREE.Group;
}

/** The moving parts of a wheelchair. */
export interface Wheelchair {
  /** Tips the whole chair about the rear wheels' contact with the floor (- lifts the front). */
  pivot: THREE.Group;
  /** Big rear wheels: spin about x. */
  wheels: THREE.Group[];
  /** Front casters: swivel about y, the wheel inside spins about x. */
  casters: { swivel: THREE.Group; spin: THREE.Group }[];
  /** The motor's light. */
  led: THREE.MeshStandardMaterial;
}

export interface PlayerModel {
  /** What goes in the scene: the body itself, or the chair with the body sitting in it. */
  root: THREE.Group;
  body: THREE.Group;
  /** Rotates at the waist (lean, twist); everything above the shorts. */
  spine: THREE.Group;
  /** Pivot at the top of the neck. */
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
  chair?: Wheelchair;
  /** Cartoon bodies: the belly under the jersey, bobbing as he runs. */
  belly?: THREE.Group;
}

/** Cartoon bodies start from their own face and hair; whatever the look sets still wins. */
const TOON_LOOK: Partial<Record<NonNullable<Look['body']>, Partial<Look>>> = {
  homer: { skin: '#f7d330', hair: 'bald', hairColor: '#2a2320', beard: 'none', headband: false },
  peter: { skin: 1, hair: 'short', hairColor: '#5b3a22', beard: 'none', headband: false },
};

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
  // A look may be partial (a custom player with only a body type): the rest falls back.
  const look: Look = { ...fallbackLook(info.name), ...(info.look?.body ? TOON_LOOK[info.look.body] : undefined), ...info.look };
  // Homer and Peter: a big belly, wider shoulders and thicker arms and legs.
  const toon = look.body === 'homer' || look.body === 'peter';
  const sx = toon ? 0.255 : SHOULDER_X;
  const thick = toon ? 1.18 : 1;
  const skin = mat(skinColor(look.skin), 0.55);
  const jersey = mat(kit.body, 0.75);
  const trim = mat(kit.trim, 0.7);
  const hairMat = mat(look.hairColor ?? HAIR_DEFAULT, 0.95);
  const shoeColor = look.shoeColor ?? (look.shoe === 'white' ? '#f4f4f4' : look.shoe === 'black' ? '#1b1b1f' : kit.team);
  const shoe = mat(shoeColor, 0.45);
  const sole = mat(look.shoe === 'white' ? '#d8d8d8' : '#f4f4f4', 0.6);
  const sock = mat('#f5f5f5', 0.85);
  const gear = mat(look.shoe === 'black' ? '#141418' : '#f2f2f2', 0.8);
  const band = mat(kit.team, 0.8);

  const body = new THREE.Group();

  // ---------------------------------------------------------------- lower body
  const shorts = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.24, 14), trim, 0, HIP_Y + 0.04, 0);
  shorts.scale.set(toon ? 1.42 : 1.28, 1, toon ? 0.95 : 0.82);
  const waistband = mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.04, 14), jersey, 0, HIP_Y + 0.15, 0);
  waistband.scale.copy(shorts.scale);
  body.add(shorts, waistband);

  // ---------------------------------------------------------------- upper body
  const spine = new THREE.Group();
  spine.position.y = HIP_Y + 0.12;
  body.add(spine);
  const y = (worldY: number) => worldY - spine.position.y;

  // Chest: a capsule squashed into an athletic, slightly tapered torso.
  const chest = segment(0.56, 0.2, 0.16, jersey);
  chest.position.y = y(HIP_Y + 0.68) - 0.28;
  chest.scale.set(toon ? 1.38 : 1.25, 1, toon ? 0.76 : 0.68);
  spine.add(chest);

  // The belly pushes the jersey forward and out over the shorts; the front number rides on it.
  let belly: THREE.Group | undefined;
  if (toon) {
    belly = new THREE.Group();
    belly.position.set(0, y(HIP_Y + 0.3), 0.05);
    const ball = mesh(new THREE.SphereGeometry(BELLY_R, 22, 16), jersey);
    ball.scale.set(1.22, 1.05, 1);
    belly.add(ball);
    spine.add(belly);
  }

  // Trim around the neck and arm holes.
  const collar = mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 16), trim, 0, y(HIP_Y + 0.66), 0.02);
  collar.rotation.x = Math.PI / 2 - 0.25;
  collar.scale.set(1.15, 1, 1);
  spine.add(collar);
  if (look.body === 'homer') {
    // His white shirt collar shows above the jersey, the points lying on the chest.
    const shirt = mat('#f6f6f2', 0.8);
    const band = mesh(new THREE.TorusGeometry(0.082, 0.02, 6, 18), shirt, 0, y(HIP_Y + 0.675), 0.02);
    band.rotation.x = Math.PI / 2 - 0.25;
    band.scale.set(1.15, 1, 1);
    spine.add(band);
    for (const s of [1, -1]) {
      const point = mesh(new THREE.BoxGeometry(0.055, 0.055, 0.012), shirt, s * 0.04, y(HIP_Y + 0.65), 0.125);
      point.rotation.set(-0.15, 0, s * 0.6);
      spine.add(point);
    }
  }

  // Shoulders: skin domes where the sleeveless jersey leaves them bare.
  for (const s of [1, -1]) {
    const delt = mesh(new THREE.SphereGeometry(0.078 * thick, 12, 10), skin, s * sx, y(SHOULDER_Y) + 0.005, 0);
    delt.scale.set(1, 0.95, 1.05);
    spine.add(delt);
    const hole = mesh(new THREE.TorusGeometry(0.07 * thick, 0.012, 6, 14), trim, s * (sx - 0.04), y(SHOULDER_Y) - 0.06, 0);
    hole.rotation.y = Math.PI / 2;
    hole.rotation.x = 0.15;
    spine.add(hole);
  }

  // Number front and back.
  const numberTex = makeNumberTexture(info.number, kit);
  for (const side of [1, -1]) {
    const numberMat = new THREE.MeshStandardMaterial({ map: numberTex, transparent: true, roughness: 0.75 });
    if (belly && side > 0) {
      // Bent to the belly's curve, a little above its widest point.
      const up = 0.07;
      const plate = mesh(bentPlane(0.24, BELLY_R * 1.22, BELLY_R), numberMat, 0, up, Math.sqrt(BELLY_R ** 2 - up ** 2) + 0.004);
      plate.rotation.x = -Math.asin(up / BELLY_R);
      belly.add(plate);
      continue;
    }
    const plate = mesh(new THREE.PlaneGeometry(0.26, 0.26), numberMat, 0, y(HIP_Y + 0.4), side * (toon ? 0.155 : 0.14));
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
  const armL = makeArm(skin, look.sleeve === 'left' || look.sleeve === 'both' ? sleeveMat : null, thick);
  const armR = makeArm(skin, look.sleeve === 'right' || look.sleeve === 'both' ? sleeveMat : null, thick);
  armL.upper.position.set(sx, y(SHOULDER_Y), 0);
  armR.upper.position.set(-sx, y(SHOULDER_Y), 0);
  spine.add(armL.upper, armR.upper);

  const legOpts = { skin, trim, shoe, sole, sock, gear, kneepad: look.kneepad, highSocks: look.socks === 'high', thick };
  const legL = makeLeg(legOpts);
  const legR = makeLeg(legOpts);
  legL.upper.position.set(HIP_X, HIP_Y, 0);
  legR.upper.position.set(-HIP_X, HIP_Y, 0);
  body.add(legL.upper, legR.upper);

  const chair = look.body === 'wheelchair' ? buildWheelchair(body, kit) : undefined;
  const root = chair ? chair.root : body;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return { root, body, spine, head, armL, armR, legL, legR, ...(chair ? { chair: chair.parts } : {}), ...(belly ? { belly } : {}) };
}

const BELLY_R = 0.21;

/** A square plane bent back at the edges, to lie on a round surface (radii across and up). */
function bentPlane(size: number, rx: number, ry: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(size, size, 8, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, -(pos.getX(i) ** 2) / (2 * rx) - pos.getY(i) ** 2 / (2 * ry));
  geo.computeVertexNormals();
  return geo;
}

/** Where the rear wheels touch the floor: the chair tips about this line. */
const AXLE_Z = -0.05;
const REAR_R = 0.3;
const CASTER_R = 0.07;

/** A tube between two points. */
function rod(a: [number, number, number], b: [number, number, number], r: number, material: THREE.Material): THREE.Mesh {
  const from = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(from);
  const m = mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), material);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

/** A wheel turning about x: tyre, rim, spokes and (for the big ones) a push rim on the outside. */
function makeWheel(r: number, tyre: THREE.Material, metal: THREE.Material, spokes: number, out = 0): THREE.Group {
  const spin = new THREE.Group();
  const disc = new THREE.Group();
  disc.rotation.y = Math.PI / 2;
  spin.add(disc);
  disc.add(mesh(new THREE.TorusGeometry(r - r * 0.08, r * 0.08, 8, 28), tyre));
  disc.add(mesh(new THREE.TorusGeometry(r * 0.84, r * 0.035, 6, 28), metal));
  for (let i = 0; i < spokes; i++) {
    const s = mesh(new THREE.CylinderGeometry(r * 0.012, r * 0.012, r * 1.66, 4), metal);
    s.rotation.z = (i / spokes) * Math.PI;
    disc.add(s);
  }
  disc.add(mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 0.2, 10), metal).rotateX(Math.PI / 2));
  if (out) disc.add(mesh(new THREE.TorusGeometry(r * 0.88, 0.011, 6, 28), metal, 0, 0, out * 0.035));
  return spin;
}

/** Seats the body in a wheelchair in the team's second colour, with a motor under the seat. */
function buildWheelchair(body: THREE.Group, kit: Kit): { root: THREE.Group; parts: Wheelchair } {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.z = AXLE_Z;
  root.add(pivot);
  const chair = new THREE.Group();
  chair.position.z = -AXLE_Z;
  pivot.add(chair);
  // The body sits: its own pose (and the view's bob) moves it within the seat.
  const seat = new THREE.Group();
  seat.position.y = SEAT_HIP - HIP_Y;
  seat.add(body);
  chair.add(seat);

  const frame = mat(kit.accent, 0.35, { metalness: 0.6 });
  const metal = mat('#c9ccd2', 0.3, { metalness: 0.85 });
  const tyre = mat('#18181a', 0.9);
  const fabric = mat('#232326', 0.9);
  const motorMat = mat('#3a3d44', 0.5, { metalness: 0.4 });
  const led = new THREE.MeshStandardMaterial({ color: '#1d3a66', emissive: '#3aa0ff', emissiveIntensity: 0, roughness: 0.3 });

  chair.add(mesh(new THREE.BoxGeometry(0.46, 0.04, 0.44), fabric, 0, SEAT_HIP - 0.1, 0.17));
  const back = mesh(new THREE.BoxGeometry(0.44, 0.42, 0.03), fabric, 0, SEAT_HIP + 0.18, -0.16);
  back.rotation.x = -0.12;
  chair.add(back);
  const rail = SEAT_HIP - 0.12;
  for (const s of [1, -1]) {
    // Back post and push handle, side rail, the front tube down to the footrest.
    chair.add(rod([s * 0.23, rail, -0.12], [s * 0.23, SEAT_HIP + 0.42, -0.2], 0.016, frame));
    chair.add(rod([s * 0.23, SEAT_HIP + 0.42, -0.2], [s * 0.23, SEAT_HIP + 0.4, -0.31], 0.018, fabric));
    chair.add(rod([s * 0.23, rail, -0.12], [s * 0.23, rail, 0.42], 0.016, frame));
    chair.add(rod([s * 0.23, rail, 0.42], [s * 0.17, 0.06, 0.6], 0.015, frame));
    chair.add(rod([s * 0.23, rail, 0.42], [s * 0.2, CASTER_R * 2 + 0.03, 0.42], 0.015, frame));
    // Armrest.
    chair.add(rod([s * 0.27, rail, -0.08], [s * 0.27, 0.74, -0.08], 0.013, frame));
    chair.add(rod([s * 0.27, rail, 0.22], [s * 0.27, 0.74, 0.22], 0.013, frame));
    chair.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.36), fabric, s * 0.27, 0.755, 0.07));
  }
  chair.add(rod([-REAR_R - 0.04, REAR_R, AXLE_Z], [REAR_R + 0.04, REAR_R, AXLE_Z], 0.014, metal));
  chair.add(mesh(new THREE.BoxGeometry(0.36, 0.02, 0.14), frame, 0, 0.05, 0.6));
  // Joystick on the right armrest (the model's -x).
  chair.add(mesh(new THREE.BoxGeometry(0.07, 0.045, 0.1), motorMat, -0.27, 0.79, 0.25));
  chair.add(rod([-0.27, 0.8, 0.26], [-0.27, 0.86, 0.27], 0.007, metal));
  chair.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), tyre, -0.27, 0.865, 0.27));
  // Motor and battery under the seat, its light at the front.
  chair.add(mesh(new THREE.BoxGeometry(0.3, 0.14, 0.24), motorMat, 0, 0.3, 0.12));
  chair.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), led, 0, 0.33, 0.245));

  const wheels: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const w = makeWheel(REAR_R, tyre, metal, 8, s);
    // Cambered: tops lean in.
    const camber = new THREE.Group();
    camber.position.set(s * (REAR_R + 0.02), REAR_R, AXLE_Z);
    camber.rotation.z = s * 0.07;
    camber.add(w);
    chair.add(camber);
    wheels.push(w);
  }
  const casters: Wheelchair['casters'] = [];
  for (const s of [1, -1]) {
    const swivel = new THREE.Group();
    swivel.position.set(s * 0.2, CASTER_R * 2 + 0.03, 0.42);
    swivel.add(rod([0, 0, 0], [0, -0.05, -0.03], 0.01, frame));
    const spin = makeWheel(CASTER_R, tyre, metal, 3);
    spin.position.set(0, -CASTER_R - 0.03, -0.035);
    swivel.add(spin);
    chair.add(swivel);
    casters.push({ swivel, spin });
  }
  return { root, parts: { pivot, wheels, casters, led } };
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
  const homer = look.body === 'homer';
  const peter = look.body === 'peter';
  if (homer) {
    // A long, drooping nose.
    const nose = mesh(new THREE.CapsuleGeometry(0.017, 0.035, 4, 10), skin, 0, cy - 0.008, 0.113);
    nose.rotation.x = Math.PI / 2 + 0.35;
    head.add(nose);
  } else {
    const nose = mesh(new THREE.SphereGeometry(0.017, 10, 8), skin, 0, cy - 0.012, 0.1);
    nose.scale.set(0.85, 1.35, 0.9);
    head.add(nose);
  }
  const mouth = mesh(new THREE.BoxGeometry(homer ? 0.05 : 0.034, 0.005, 0.01), mat('#5a2a22', 0.8), 0, cy - 0.052, homer ? 0.114 : peter ? 0.101 : 0.098);
  head.add(mouth);
  const dark = mat('#1a1410', 0.3);
  for (const s of [1, -1]) {
    const ear = mesh(new THREE.SphereGeometry(0.024, 8, 6), skin, s * 0.1, cy, -0.005);
    ear.scale.set(0.5, 1.2, 0.9);
    head.add(ear);
    if (homer) {
      // Big white eyeballs touching in the middle, a dot of a pupil each.
      head.add(mesh(new THREE.SphereGeometry(0.03, 16, 12), mat('#ffffff', 0.35), s * 0.031, cy + 0.024, 0.083));
      const pupil = mesh(new THREE.SphereGeometry(0.0055, 8, 6), dark, s * 0.031, cy + 0.024, 0.112);
      pupil.scale.z = 0.5;
      head.add(pupil);
      continue;
    }
    const eye = mesh(new THREE.SphereGeometry(0.0085, 8, 6), dark, s * 0.034, cy + 0.018, 0.093);
    eye.scale.z = 0.6;
    head.add(eye);
    const brow = mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), mat(look.hairColor ?? HAIR_DEFAULT, 0.9), s * 0.035, cy + (peter ? 0.05 : 0.037), 0.094);
    brow.rotation.z = s * -0.1;
    head.add(brow);
  }
  if (homer) {
    // The stubble muzzle: a bigger, fuller jaw in grey-brown.
    jaw.material = mat('#b39d7a', 0.85);
    jaw.position.z = 0.035;
    jaw.scale.set(1.15, 0.95, 1.1);
  }
  if (peter) {
    // Round glasses, and the chin: a big jaw jutting forward, split down the middle.
    const frame = mat('#26201c', 0.4);
    const lens = new THREE.MeshStandardMaterial({ color: '#dfefff', roughness: 0.1, transparent: true, opacity: 0.22 });
    for (const s of [1, -1]) {
      head.add(mesh(new THREE.TorusGeometry(0.026, 0.0035, 6, 20), frame, s * 0.036, cy + 0.02, 0.107));
      head.add(mesh(new THREE.CircleGeometry(0.026, 20), lens, s * 0.036, cy + 0.02, 0.106));
      head.add(rod([s * 0.062, cy + 0.024, 0.104], [s * 0.1, cy + 0.024, 0.01], 0.003, frame));
      const chin = mesh(new THREE.SphereGeometry(0.047, 14, 10), skin, s * 0.021, cy - 0.094, 0.068);
      chin.scale.set(1, 0.85, 1);
      head.add(chin);
    }
    head.add(rod([0.01, cy + 0.024, 0.11], [-0.01, cy + 0.024, 0.11], 0.003, frame));
    jaw.scale.set(1.12, 0.92, 1.05);
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
  if (homer) {
    // Two hairs looping over the top, and a short ring round the back above the ears.
    for (const s of [1, -1]) {
      const loop = mesh(new THREE.TorusGeometry(0.034, 0.0032, 4, 16, Math.PI).rotateY(Math.PI / 2), hairMat, s * 0.012, cy + 0.1, s * 0.012);
      head.add(loop);
    }
    const ring = mesh(new THREE.TorusGeometry(0.099, 0.006, 5, 24, Math.PI).rotateX(-Math.PI / 2), hairMat, 0, cy + 0.025, -0.004);
    ring.scale.set(1.02, 1.6, 1.1);
    head.add(ring);
    // Zigzag tufts standing up along it.
    const tuft = new THREE.ConeGeometry(0.01, 0.028, 4);
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      head.add(mesh(tuft, hairMat, Math.cos(a) * 0.1, cy + 0.035 + (i % 2) * 0.006, -Math.sin(a) * 0.11 - 0.004));
    }
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

function makeArm(skin: THREE.Material, sleeve: THREE.Material | null, k = 1): Limb {
  const upper = new THREE.Group();
  upper.add(segment(UPPER_ARM, 0.068 * k, 0.052 * k, skin));
  const lower = new THREE.Group();
  lower.position.y = -UPPER_ARM;
  lower.add(segment(FOREARM, 0.052 * k, 0.038 * k, skin));
  upper.add(lower);
  if (sleeve) {
    upper.add(segment(UPPER_ARM * 0.92, 0.071 * k, 0.055 * k, sleeve));
    lower.add(segment(FOREARM * 0.85, 0.055 * k, 0.042 * k, sleeve));
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
  /** Thickness, 1 for an athlete. */
  thick: number;
}): Limb {
  const k = o.thick;
  const upper = new THREE.Group();
  upper.add(segment(THIGH, 0.092 * k, 0.068 * k, o.skin));
  // Long, loose shorts down to just above the knee.
  const leg = mesh(new THREE.CylinderGeometry(0.105 * k, 0.098 * k, THIGH * 0.74, 12), o.trim, 0, -THIGH * 0.3, 0);
  upper.add(leg);

  const lower = new THREE.Group();
  lower.position.y = -THIGH;
  lower.add(segment(SHIN, 0.07 * k, 0.044 * k, o.skin));
  upper.add(lower);
  if (o.kneepad) {
    lower.add(mesh(new THREE.CylinderGeometry(0.07 * k, 0.066 * k, 0.1, 12), o.gear, 0, -0.06, 0));
  }
  const sockLen = o.highSocks ? SHIN * 0.5 : 0.08;
  const sock = mesh(new THREE.CylinderGeometry(0.052 * k, 0.048 * k, sockLen, 10), o.sock, 0, -SHIN + sockLen / 2, 0);
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
