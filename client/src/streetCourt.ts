import * as THREE from 'three';
import { BOARD_X, COURT, HOOP, HOOP_X, mapColor, type MapDef, type MapTime, type TeamInfo } from '@webnba/shared';
import { buildNet, netSwing, type Arena } from './arena';
import { buildFloor } from './courtFloor';

/** Outdoor light by time of day. */
const OUTDOOR_LIGHT: Record<
  MapTime,
  { bg: number; fog: number; near: number; far: number; sky: number; ground: number; hemi: number; sun: number; sunI: number; sunAt: [number, number, number] }
> = {
  day: { bg: 0x9fc6ea, fog: 0xb8d4ee, near: 45, far: 110, sky: 0xdcecff, ground: 0x4a4438, hemi: 1.1, sun: 0xfff2dc, sunI: 2.6, sunAt: [-11, 24, 12] },
  dusk: { bg: 0xe39a6c, fog: 0xd9a27e, near: 40, far: 105, sky: 0xffcf9e, ground: 0x3c2c2a, hemi: 0.75, sun: 0xff9550, sunI: 2.2, sunAt: [-30, 9, 14] },
  // The moon: no shadow; the floodlights carry the court.
  night: { bg: 0x070b18, fog: 0x070b18, near: 35, far: 95, sky: 0x40507a, ground: 0x0c0c12, hemi: 0.35, sun: 0x8fa6ff, sunI: 0.3, sunAt: [3, 30, -10] },
};

/**
 * An outdoor map: ground, the painted court, steel poles and, as the map
 * says, a chain-link fence and a city block; floodlights at night. `half`:
 * street games, one hoop at +x.
 */
export function buildOutdoor(scene: THREE.Scene, map: MapDef, home: TeamInfo, half: boolean): Arena {
  const l = OUTDOOR_LIGHT[map.time];
  const night = map.time === 'night';
  const cx = half ? 7 : 0;
  scene.background = new THREE.Color(l.bg);
  scene.fog = new THREE.Fog(l.fog, l.near, l.far);

  scene.add(new THREE.HemisphereLight(l.sky, l.ground, l.hemi));
  const sun = new THREE.DirectionalLight(l.sun, l.sunI);
  sun.position.set(cx + l.sunAt[0], l.sunAt[1], l.sunAt[2]);
  sun.target.position.set(cx, 0, 0);
  scene.add(sun, sun.target);
  let caster: THREE.DirectionalLight | THREE.SpotLight = sun;
  if (night) caster = addFloodlights(scene, half);
  else {
    sun.castShadow = true;
    const c = sun.shadow.camera;
    c.right = half ? 16 : 21;
    c.left = -c.right;
    c.top = half ? 14 : 16;
    c.bottom = -c.top;
    c.near = 1;
    c.far = 80;
    sun.shadow.bias = -0.0005;
  }
  caster.shadow.mapSize.set(2048, 2048);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(half ? 90 : 110, half ? 70 : 80),
    new THREE.MeshStandardMaterial({ color: mapColor(map.apron, home), roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(half ? 5 : 0, -0.01, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  scene.add(buildFloor(map, home, half).mesh);

  // In street games nobody ever shoots at the -x end; a stand-in keeps the indices.
  const nets = half ? [buildPole(scene, 1), new THREE.Object3D()] : [buildPole(scene, 1), buildPole(scene, -1)];
  if (map.fence) buildFence(scene, half);
  if (map.buildings) buildBlock(scene, half, night);
  const swing = netSwing(nets);
  return {
    nets,
    setQuality(q) {
      const size = night ? (q === 'high' ? 2048 : 1024) : q === 'high' ? 4096 : 2048;
      if (caster.shadow.mapSize.x !== size) {
        caster.shadow.mapSize.set(size, size);
        caster.shadow.map?.dispose();
        caster.shadow.map = null;
      }
    },
    swishNet: swing.swish,
    cheer() {},
    spotOn() {},
    update: swing.update,
  };
}

/** Night: light towers along the far sideline, and lamps out of view on the camera side. The first casts the shadows. */
function addFloodlights(scene: THREE.Scene, half: boolean): THREE.SpotLight {
  const W = COURT.halfWidth;
  const xs = half ? [2, 12] : [-12, 0, 12];
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.5 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
  lamp.color.multiplyScalar(2.2);
  const H = 10;
  let first: THREE.SpotLight | null = null;
  for (const z of [-(W + 3.4), W + 7]) {
    for (const x of xs) {
      const spot = new THREE.SpotLight(0xfff1d6, 140, 32, 0.62, 0.6, 2);
      spot.position.set(x, H, z);
      spot.target.position.set(x * 0.8 + (half ? 1.5 : 0), 0, z * -0.25);
      scene.add(spot, spot.target);
      if (!first) {
        first = spot;
        spot.castShadow = true;
        spot.shadow.bias = -0.0005;
        spot.shadow.camera.near = 2;
        spot.shadow.camera.far = 45;
      }
      if (z > 0) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, H, 10), steel);
      pole.position.set(x, H / 2, z - 0.3);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.25), steel);
      head.position.set(x, H + 0.2, z - 0.15);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.38), lamp);
      face.position.set(x, H + 0.2, z - 0.02);
      face.rotation.x = -0.35;
      scene.add(pole, head, face);
    }
  }
  return first!;
}

/** One steel pole with a painted steel backboard, at the +x (s = 1) or -x end. */
function buildPole(scene: THREE.Scene, s: 1 | -1): THREE.Object3D {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2f4a3a, metalness: 0.6, roughness: 0.45 });
  const poleX = COURT.halfLength + 1.1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3.9, 12), steel);
  pole.position.set(poleX, 1.95, 0);
  pole.castShadow = true;
  group.add(pole);
  const backX = BOARD_X + 0.04;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(poleX - backX, 0.14, 0.14), steel);
  arm.position.set((poleX + backX) / 2, 3.6, 0);
  arm.castShadow = true;
  group.add(arm);

  const boardH = HOOP.boardTop - HOOP.boardBottom;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, boardH, HOOP.boardHalfWidth * 2),
    new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 }),
  );
  board.position.set(BOARD_X + 0.02, HOOP.boardBottom + boardH / 2, 0);
  board.castShadow = true;
  group.add(board);
  const mark = new THREE.LineBasicMaterial({ color: 0xc4553a });
  const rect = (y0: number, y1: number, hw: number) => {
    const x = BOARD_X - 0.002;
    const pts = [
      new THREE.Vector3(x, y0, -hw),
      new THREE.Vector3(x, y1, -hw),
      new THREE.Vector3(x, y1, hw),
      new THREE.Vector3(x, y0, hw),
      new THREE.Vector3(x, y0, -hw),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mark));
  };
  rect(HOOP.boardBottom + 0.02, HOOP.boardTop - 0.02, HOOP.boardHalfWidth - 0.02);
  rect(HOOP.rimHeight + 0.05, HOOP.rimHeight + 0.5, 0.295);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0531f, metalness: 0.4, roughness: 0.5 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.rimRadius, HOOP.rimTube * 1.4, 8, 40), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(HOOP_X, HOOP.rimHeight, 0);
  rim.castShadow = true;
  group.add(rim);
  const bracketLen = Math.abs(BOARD_X - HOOP_X) - HOOP.rimRadius;
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(bracketLen, 0.03, 0.12), rimMat);
  bracket.position.set(BOARD_X - bracketLen / 2, HOOP.rimHeight, 0);
  group.add(bracket);

  const net = buildNet();
  net.position.set(HOOP_X, HOOP.rimHeight, 0);
  group.add(net);
  // Built at +x; the other end is the same turned around.
  if (s < 0) group.rotation.y = Math.PI;
  scene.add(group);
  return net;
}

/** Chain-link texture: diamonds of wire on transparent. */
function chainLink(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(200,205,210,0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 32);
  ctx.lineTo(32, 0);
  ctx.lineTo(64, 32);
  ctx.lineTo(32, 64);
  ctx.closePath();
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fence behind the hoops and along the far sideline (the camera side stays open). */
function buildFence(scene: THREE.Scene, half: boolean): void {
  const H = 3.6;
  const tex = chainLink();
  const post = new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 0.6, roughness: 0.4 });
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, H, 8);
  const panel = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const t = tex.clone();
    t.repeat.set(len / 0.35, H / 0.35);
    t.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, H),
      new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5 }),
    );
    mesh.position.set((x0 + x1) / 2, H / 2, (z0 + z1) / 2);
    mesh.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    scene.add(mesh);
    const posts = Math.ceil(len / 3);
    for (let i = 0; i <= posts; i++) {
      const p = new THREE.Mesh(postGeo, post);
      p.position.set(x0 + ((x1 - x0) * i) / posts, H / 2, z0 + ((z1 - z0) * i) / posts);
      p.castShadow = true;
      scene.add(p);
    }
  };
  const bx = COURT.halfLength + 3.2;
  const sz = COURT.halfWidth + 2.6;
  panel(half ? -4 : -bx, -sz, bx, -sz);
  panel(bx, -sz, bx, sz);
  if (!half) panel(-bx, -sz, -bx, sz);
}

/** Rows of plain buildings past the fence (lit windows at night), and a few trees. */
function buildBlock(scene: THREE.Scene, half: boolean, night: boolean): void {
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tones = [0x8b6f5c, 0xa8a196, 0x6f7a86, 0xb98f6a, 0x7d6a74];
  const win = new THREE.MeshStandardMaterial({ color: 0x31404f, roughness: 0.3, metalness: 0.4 });
  const lit = new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffc56a, emissiveIntensity: 0.9 });
  /** `facing`: the side toward the court (+z, or the -x / +x face). */
  const building = (x: number, z: number, w: number, d: number, facing: 'z' | '-x' | '+x') => {
    const h = 8 + rand() * 16;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tones[Math.floor(rand() * tones.length)]).multiplyScalar(night ? 0.3 : 1), roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z);
    scene.add(b);
    // Window bands on the side facing the court.
    for (let y = 2.5; y < h - 1.5; y += 3) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry((facing === 'z' ? w : d) * 0.8, 1.1), night && rand() < 0.55 ? lit : win);
      if (facing === 'z') band.position.set(x, y, z + d / 2 + 0.02);
      else {
        const side = facing === '-x' ? -1 : 1;
        band.rotation.y = (side * Math.PI) / 2;
        band.position.set(x + side * (w / 2 + 0.02), y, z);
      }
      scene.add(band);
    }
  };
  for (let x = half ? -20 : -30; x < 30; x += 9 + rand() * 3) building(x, -24 - rand() * 4, 7 + rand() * 3, 8, 'z');
  for (let z = -18; z < 20; z += 9 + rand() * 3) building(31 + rand() * 3, z, 8, 8, '-x');
  if (!half) for (let z = -18; z < 20; z += 9 + rand() * 3) building(-31 - rand() * 3, z, 8, 8, '+x');
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x3f7a3a).multiplyScalar(night ? 0.35 : 1), roughness: 1 });
  const trees = half
    ? [
        [-6, -13],
        [4, -14],
        [21, -12],
        [21, 9],
        [-7, 12],
      ]
    : [
        [-8, -14],
        [6, -14],
        [21, -12],
        [21, 9],
        [-21, -12],
        [-21, 9],
      ];
  for (const [x, z] of trees) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.6, 8), trunk);
    t.position.set(x, 1.3, z);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8 + rand(), 12, 10), leaves);
    crown.position.set(x, 3.6, z);
    crown.castShadow = true;
    scene.add(t, crown);
  }
}
