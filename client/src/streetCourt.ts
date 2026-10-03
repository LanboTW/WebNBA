import * as THREE from 'three';
import { BOARD_X, COURT, HOOP, HOOP_X, THREE_CORNER_DX } from '@webnba/shared';
import { buildNet, type Arena } from './arena';

const PX_PER_M = 48;

/**
 * Street games: an outdoor half court at the +x hoop. Asphalt, a painted
 * court, one steel pole, a chain-link fence and a city block under daylight.
 */
export function buildStreetArena(scene: THREE.Scene): Arena {
  scene.background = new THREE.Color(0x9fc6ea);
  scene.fog = new THREE.Fog(0xb8d4ee, 45, 110);

  scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a4438, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(-4, 24, 12);
  sun.target.position.set(7, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const c = sun.shadow.camera;
  c.left = -16;
  c.right = 16;
  c.top = 14;
  c.bottom = -14;
  c.near = 1;
  c.far = 70;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Asphalt all around, the court painted on it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(5, -0.01, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const tex = new THREE.CanvasTexture(drawHalfCourt());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const court = new THREE.Mesh(new THREE.PlaneGeometry(L + 2, W * 2 + 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  court.rotation.x = -Math.PI / 2;
  court.position.set(L / 2, 0, 0);
  court.receiveShadow = true;
  court.renderOrder = -1;
  scene.add(court);

  const net = buildPole(scene);
  buildFence(scene);
  buildBlock(scene);

  let netAnim = 0;
  return {
    // Nobody ever shoots at the -x end; a stand-in keeps the indices.
    nets: [net, new THREE.Object3D()],
    setQuality(q) {
      const size = q === 'high' ? 4096 : 2048;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
    swishNet(hoopX) {
      if (hoopX > 0) netAnim = 1;
    },
    cheer() {},
    spotOn() {},
    update(dt) {
      if (netAnim <= 0) return;
      netAnim = Math.max(0, netAnim - dt * 1.6);
      net.scale.y = 1 + Math.sin(netAnim * 22) * 0.25 * netAnim;
      net.scale.x = net.scale.z = 1 - 0.18 * netAnim;
    },
  };
}

/** x from -1 to L+1, z from -W-1 to W+1 (a metre of margin all round). */
function drawHalfCourt(): HTMLCanvasElement {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((L + 2) * PX_PER_M);
  canvas.height = Math.round((W * 2 + 2) * PX_PER_M);
  const ctx = canvas.getContext('2d')!;
  const u = (x: number) => (x + 1) * PX_PER_M;
  const v = (z: number) => (z + W + 1) * PX_PER_M;

  // Worn asphalt, then the court's painted surface with its own wear.
  ctx.fillStyle = '#3d3f43';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#2f6b8a';
  ctx.fillRect(u(0), v(-W), L * PX_PER_M, W * 2 * PX_PER_M);
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 9000; i++) {
    const light = rand() < 0.5;
    ctx.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${0.03 + rand() * 0.07})`;
    const s = 1 + rand() * 3;
    ctx.fillRect(rand() * canvas.width, rand() * canvas.height, s, s);
  }

  const kw = COURT.keyWidth / 2;
  const ft = L - COURT.freeThrowFromBaseline;
  ctx.fillStyle = '#c4553a';
  ctx.fillRect(u(ft), v(-kw), (L - ft) * PX_PER_M, kw * 2 * PX_PER_M);

  ctx.lineWidth = 0.06 * PX_PER_M;
  ctx.strokeStyle = 'rgba(245,245,240,0.92)';
  const poly = (pts: [number, number][], close = false) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(u(x), v(z)) : ctx.moveTo(u(x), v(z))));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  // An arc around (cx, 0) opening toward the hoop end, from angle `from` to `to`.
  const arc = (cx: number, r: number, from: number, to: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const a = from + ((to - from) * i) / 48;
      pts.push([cx - Math.cos(a) * r, Math.sin(a) * r]);
    }
    poly(pts);
  };

  poly([
    [L, -kw],
    [ft, -kw],
    [ft, kw],
    [L, kw],
  ]);
  arc(ft, COURT.centerCircleRadius, -Math.PI / 2, Math.PI / 2);
  const cornerX = HOOP_X - THREE_CORNER_DX;
  poly([
    [L, COURT.threeCornerZ],
    [cornerX, COURT.threeCornerZ],
  ]);
  poly([
    [L, -COURT.threeCornerZ],
    [cornerX, -COURT.threeCornerZ],
  ]);
  const alpha = Math.asin(COURT.threeCornerZ / COURT.threeRadius);
  arc(HOOP_X, COURT.threeRadius, -alpha, alpha);
  arc(HOOP_X, COURT.restrictedRadius, -Math.PI / 2, Math.PI / 2);
  // Half of the centre circle on the half-court line.
  ctx.beginPath();
  ctx.arc(u(0), v(0), COURT.centerCircleRadius * PX_PER_M, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.lineWidth = 0.1 * PX_PER_M;
  poly(
    [
      [0, -W],
      [L, -W],
      [L, W],
      [0, W],
    ],
    true,
  );
  return canvas;
}

/** One steel pole with a painted steel backboard. */
function buildPole(scene: THREE.Scene): THREE.Object3D {
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

/** Fence behind the hoop and along the far sideline (the camera side stays open). */
function buildFence(scene: THREE.Scene): void {
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
  panel(-4, -sz, bx, -sz);
  panel(bx, -sz, bx, sz);
}

/** A row of plain buildings past the fence, and a few trees. */
function buildBlock(scene: THREE.Scene): void {
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tones = [0x8b6f5c, 0xa8a196, 0x6f7a86, 0xb98f6a, 0x7d6a74];
  const win = new THREE.MeshStandardMaterial({ color: 0x31404f, roughness: 0.3, metalness: 0.4 });
  const building = (x: number, z: number, w: number, d: number, facing: 'z' | 'x') => {
    const h = 8 + rand() * 16;
    const mat = new THREE.MeshStandardMaterial({ color: tones[Math.floor(rand() * tones.length)], roughness: 0.9 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, h / 2, z);
    scene.add(b);
    // Window bands on the side facing the court.
    for (let y = 2.5; y < h - 1.5; y += 3) {
      const band = new THREE.Mesh(new THREE.PlaneGeometry((facing === 'z' ? w : d) * 0.8, 1.1), win);
      if (facing === 'z') band.position.set(x, y, z + d / 2 + 0.02);
      else {
        band.rotation.y = -Math.PI / 2;
        band.position.set(x - w / 2 - 0.02, y, z);
      }
      scene.add(band);
    }
  };
  for (let x = -20; x < 30; x += 9 + rand() * 3) building(x, -24 - rand() * 4, 7 + rand() * 3, 8, 'z');
  for (let z = -18; z < 20; z += 9 + rand() * 3) building(31 + rand() * 3, z, 8, 8, 'x');
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 1 });
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 1 });
  for (const [x, z] of [
    [-6, -13],
    [4, -14],
    [21, -12],
    [21, 9],
    [-7, 12],
  ]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 2.6, 8), trunk);
    t.position.set(x, 1.3, z);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.8 + rand(), 12, 10), leaves);
    crown.position.set(x, 3.6, z);
    crown.castShadow = true;
    scene.add(t, crown);
  }
}
