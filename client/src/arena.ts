import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { BOARD_X, COURT, HOOP, HOOP_X, THREE_CORNER_DX, type TeamInfo } from '@webnba/shared';
import type { Quality, QualityAware } from './graphics';
import { loadLogo } from './logos';

const PX_PER_M = 72;

export interface Arena extends QualityAware {
  /** Index 0 is the +x hoop, index 1 the -x hoop. */
  nets: THREE.Object3D[];
  swishNet(hoopX: number): void;
  cheer(): void;
  update(dt: number): void;
  /** Showcase only: centre the spotlight on this spot of the floor. */
  spotOn(x: number, z: number): void;
}

/**
 * The court and everything around it. A showcase arena (the menu background)
 * has no crowd and is dark apart from one spotlight that follows the player.
 */
export function buildArena(scene: THREE.Scene, home: TeamInfo, showcase = false): Arena {
  scene.background = new THREE.Color(0x07080d);
  scene.fog = new THREE.Fog(0x07080d, 40, 80);

  const lights = addLights(scene, showcase);
  const key = lights.key;
  const floor = buildFloor(home);
  scene.add(floor.group);
  addCeiling(scene);
  const crowd: Crowd = showcase ? { root: new THREE.Group(), setDensity() {} } : buildStands(scene, home);
  const nets = [buildHoop(scene, 1, home), buildHoop(scene, -1, home)];

  const netAnim = [0, 0];
  let cheerT = 0;
  let quality: Quality | null = null;
  return {
    nets,
    setQuality(q, renderer) {
      if (q === quality) return;
      quality = q;
      const size = q === 'high' ? 4096 : 2048;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
      floor.setReflection(q === 'high' && !showcase, renderer);
      if (showcase) scene.environmentIntensity = 0.12;
      crowd.setDensity(q === 'low' ? 0.55 : q === 'medium' ? 0.8 : 1, q !== 'low');
    },
    swishNet(hoopX) {
      netAnim[hoopX > 0 ? 0 : 1] = 1;
    },
    cheer() {
      cheerT = 2.2;
    },
    spotOn(x, z) {
      lights.spot?.position.set(x + 1.5, 9, z + 3);
      lights.spot?.target.position.set(x, 0, z);
    },
    update(dt) {
      nets.forEach((net, i) => {
        const t = netAnim[i];
        if (t <= 0) return;
        netAnim[i] = Math.max(0, t - dt * 1.6);
        net.scale.y = 1 + Math.sin(t * 22) * 0.25 * t;
        net.scale.x = net.scale.z = 1 - 0.18 * t;
      });
      if (cheerT > 0) {
        cheerT = Math.max(0, cheerT - dt);
        crowd.root.position.y = Math.abs(Math.sin(cheerT * 14)) * 0.12 * Math.min(1, cheerT);
      }
    },
  };
}

function addLights(scene: THREE.Scene, showcase: boolean): { key: THREE.DirectionalLight; spot: THREE.SpotLight | null } {
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a1a, showcase ? 0.12 : 0.9));
  const key = new THREE.DirectionalLight(0xffffff, showcase ? 0.25 : 2.2);
  key.position.set(6, 22, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const c = key.shadow.camera;
  c.left = -18;
  c.right = 18;
  c.top = 12;
  c.bottom = -12;
  c.near = 1;
  c.far = 60;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff1dd, showcase ? 0.08 : 0.6);
  fill.position.set(-10, 15, -8);
  scene.add(fill);
  if (!showcase) return { key, spot: null };
  // One spotlight carries the scene; it casts the only shadow.
  key.castShadow = false;
  const spot = new THREE.SpotLight(0xfff4e2, 260, 30, 0.42, 0.55, 2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0005;
  scene.add(spot, spot.target);
  return { key, spot };
}

/** Banks of arena lights over the court; bright enough to bloom on high quality. */
function addCeiling(scene: THREE.Scene): void {
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  glow.color.multiplyScalar(2.2);
  const frame = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.8 });
  const bank = new THREE.BoxGeometry(3.2, 0.25, 0.9);
  const face = new THREE.PlaneGeometry(3.0, 0.7);
  for (const x of [-12, -4, 4, 12]) {
    for (const z of [-6, 6]) {
      const b = new THREE.Mesh(bank, frame);
      b.position.set(x, 16, z);
      const f = new THREE.Mesh(face, glow);
      f.rotation.x = Math.PI / 2;
      f.position.set(x, 15.87, z);
      scene.add(b, f);
    }
  }
}

function buildFloor(home: TeamInfo): { group: THREE.Object3D; setReflection(on: boolean, r: THREE.WebGLRenderer): void } {
  const group = new THREE.Group();
  const w = COURT.halfLength * 2;
  const h = COURT.halfWidth * 2;

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 8, h + 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(home.primary).multiplyScalar(0.6), roughness: 0.8 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  apron.receiveShadow = true;
  group.add(apron);

  const canvas = drawCourt(home);
  const tex = new THREE.CanvasTexture(canvas);
  // The centre shows the abbreviation until the logo arrives (or for good if there is none).
  loadLogo(home).then((img) => {
    if (!img) return;
    const ctx = canvas.getContext('2d')!;
    const r = (COURT.centerCircleRadius - 0.03) * PX_PER_M;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = home.primary;
    ctx.fill();
    const size = r * 1.55;
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    tex.needsUpdate = true;
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const court = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.05 }),
  );
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  // Drawn first among see-through things so floor markers still show on top.
  court.renderOrder = -1;
  group.add(court);

  // High quality: a mirror just under a slightly see-through court reads as polished wood.
  let mirror: Reflector | null = null;
  const courtMat = court.material;
  return {
    group,
    setReflection(on, r) {
      if (on && !mirror) {
        const scale = r.getPixelRatio() * 0.5;
        mirror = new Reflector(new THREE.PlaneGeometry(w, h), {
          textureWidth: Math.round(window.innerWidth * scale),
          textureHeight: Math.round(window.innerHeight * scale),
          color: 0x9a8f86,
          clipBias: 0.003,
        });
        mirror.rotation.x = -Math.PI / 2;
        mirror.position.y = -0.004;
        group.add(mirror);
      }
      if (mirror) mirror.visible = on;
      courtMat.transparent = on;
      courtMat.opacity = on ? 0.82 : 1;
      courtMat.needsUpdate = true;
    },
  };
}

function drawCourt(home: TeamInfo): HTMLCanvasElement {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(L * 2 * PX_PER_M);
  canvas.height = Math.round(W * 2 * PX_PER_M);
  const ctx = canvas.getContext('2d')!;
  const u = (x: number) => (x + L) * PX_PER_M;
  const v = (z: number) => (z + W) * PX_PER_M;

  // Maple planks running the length of the court.
  ctx.fillStyle = '#d6a268';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const plank = 0.12 * PX_PER_M;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < canvas.height; y += plank) {
    ctx.fillStyle = `rgba(${rand() < 0.5 ? '90,50,20' : '255,235,200'},${0.04 + rand() * 0.06})`;
    ctx.fillRect(0, y, canvas.width, plank);
    ctx.fillStyle = 'rgba(80,45,15,0.12)';
    ctx.fillRect(0, y, canvas.width, 1);
  }

  const paint = home.primary;
  ctx.lineWidth = 0.05 * PX_PER_M;
  ctx.strokeStyle = '#ffffff';

  const poly = (pts: [number, number][], close = false) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(u(x), v(z)) : ctx.moveTo(u(x), v(z))));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  const circle = (x: number, z: number, r: number, fill?: string) => {
    ctx.beginPath();
    ctx.arc(u(x), v(z), r * PX_PER_M, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.stroke();
  };

  // Centre circle and team mark.
  circle(0, 0, COURT.centerCircleRadius, paint);
  ctx.fillStyle = home.secondary;
  ctx.font = `bold ${0.9 * PX_PER_M}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(home.abbr, u(0), v(0));

  for (const s of [1, -1]) {
    const base = s * L;
    const ft = s * (L - COURT.freeThrowFromBaseline);
    const kw = COURT.keyWidth / 2;
    const hoop = s * HOOP_X;

    // Paint.
    ctx.fillStyle = paint;
    ctx.fillRect(Math.min(u(base), u(ft)), v(-kw), Math.abs(u(base) - u(ft)), v(kw) - v(-kw));
    poly([[base, -kw], [ft, -kw], [ft, kw], [base, kw]]);
    circle(ft, 0, COURT.centerCircleRadius);

    // Three-point line: corner straights plus the arc.
    const cornerX = hoop - s * THREE_CORNER_DX;
    poly([[base, COURT.threeCornerZ], [cornerX, COURT.threeCornerZ]]);
    poly([[base, -COURT.threeCornerZ], [cornerX, -COURT.threeCornerZ]]);
    const alpha = Math.asin(COURT.threeCornerZ / COURT.threeRadius);
    const arc: [number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const a = -alpha + (2 * alpha * i) / 64;
      arc.push([hoop - s * Math.cos(a) * COURT.threeRadius, Math.sin(a) * COURT.threeRadius]);
    }
    poly(arc);

    // Restricted area.
    const ra: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 32;
      ra.push([hoop - s * Math.cos(a) * COURT.restrictedRadius, Math.sin(a) * COURT.restrictedRadius]);
    }
    poly(ra);
  }

  poly([[0, -W], [0, W]]);
  ctx.lineWidth = 0.1 * PX_PER_M;
  poly([[-L, -W], [L, -W], [L, W], [-L, W]], true);
  return canvas;
}

interface Crowd {
  root: THREE.Object3D;
  /** Share of seats filled (0-1) and whether fans get heads. */
  setDensity(share: number, heads: boolean): void;
}

function buildStands(scene: THREE.Scene, home: TeamInfo): Crowd {
  const stands = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(home.primary).multiplyScalar(0.35), roughness: 0.9 });
  const tiers = 9;
  const rows: { x: number; z: number; len: number; alongX: boolean; outward: number }[] = [];
  const sideZ = COURT.halfWidth + 3.2;
  const endX = COURT.halfLength + 4.2;
  for (let i = 0; i < tiers; i++) {
    const off = i * 0.9;
    rows.push({ x: 0, z: sideZ + off, len: 2 * endX + 2 * off, alongX: true, outward: 1 });
    rows.push({ x: 0, z: -(sideZ + off), len: 2 * endX + 2 * off, alongX: true, outward: -1 });
    rows.push({ x: endX + off, z: 0, len: 2 * sideZ, alongX: false, outward: 1 });
    rows.push({ x: -(endX + off), z: 0, len: 2 * sideZ, alongX: false, outward: -1 });
  }
  const seatGeo = new THREE.BoxGeometry(1, 1, 1);
  const fanGeo = new THREE.BoxGeometry(0.42, 0.5, 0.3);
  const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const fans: THREE.Matrix4[] = [];
  const fanColors: THREE.Color[] = [];
  const palette = [home.primary, home.secondary, '#ffffff', '#2b2b33', '#8b1e1e', '#3a5da8', '#d7c6a5'];
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  rows.forEach((row, idx) => {
    const tier = Math.floor(idx / 4);
    const y = tier * 0.5;
    const step = new THREE.Mesh(seatGeo, seatMat);
    step.scale.set(row.alongX ? row.len : 0.9, 0.5 + y, row.alongX ? 0.9 : row.len);
    step.position.set(row.x, (0.5 + y) / 2, row.z);
    step.receiveShadow = true;
    stands.add(step);
    const count = Math.floor(row.len / 0.62);
    for (let i = 0; i < count; i++) {
      if (rand() < 0.04) continue;
      const t = -row.len / 2 + 0.31 + i * 0.62;
      const m = new THREE.Matrix4().makeTranslation(
        row.alongX ? t : row.x,
        0.5 + y + 0.25,
        row.alongX ? row.z : t,
      );
      fans.push(m);
      const c = palette[Math.floor(rand() * palette.length)];
      fanColors.push(new THREE.Color(c).multiplyScalar(0.55 + rand() * 0.4));
    }
  });
  scene.add(stands);

  // Shuffled, so a lower density empties random seats rather than whole rows.
  const order = fans.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const skinTones = ['#f1c9a5', '#d9a47a', '#b07850', '#8d5a3b', '#5e3a24'].map((c) => new THREE.Color(c));
  const root = new THREE.Group();
  const bodies = new THREE.InstancedMesh(fanGeo, new THREE.MeshLambertMaterial(), fans.length);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), fans.length);
  const up = new THREE.Matrix4().makeTranslation(0, 0.37, 0);
  order.forEach((src, i) => {
    bodies.setMatrixAt(i, fans[src]);
    bodies.setColorAt(i, fanColors[src]);
    heads.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(fans[src], up));
    heads.setColorAt(i, skinTones[Math.floor(rand() * skinTones.length)]);
  });
  root.add(bodies, heads);
  scene.add(root);
  return {
    root,
    setDensity(share, withHeads) {
      bodies.count = heads.count = Math.round(fans.length * share);
      heads.visible = withHeads;
    },
  };
}

function buildHoop(scene: THREE.Scene, s: 1 | -1, home: TeamInfo): THREE.Object3D {
  const group = new THREE.Group();
  const padMat = new THREE.MeshStandardMaterial({ color: home.primary, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.35 });

  const baseX = s * (COURT.halfLength + 1.5);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.3), padMat);
  base.position.set(baseX, 0.55, 0);
  base.castShadow = true;
  group.add(base);

  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.6, 0.28), padMat);
  pole.position.set(baseX, 2.4, 0);
  pole.castShadow = true;
  group.add(pole);

  const backX = s * (BOARD_X + 0.03);
  const armLen = Math.abs(baseX - backX);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLen, 0.18, 0.18), steel);
  arm.position.set((baseX + backX) / 2, 3.55, 0);
  arm.castShadow = true;
  group.add(arm);

  const boardH = HOOP.boardTop - HOOP.boardBottom;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, boardH, HOOP.boardHalfWidth * 2),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, roughness: 0.05 }),
  );
  board.position.set(s * (BOARD_X + 0.015), HOOP.boardBottom + boardH / 2, 0);
  group.add(board);

  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const rectLine = (y0: number, y1: number, hw: number) => {
    const x = s * (BOARD_X - 0.001);
    const pts = [
      new THREE.Vector3(x, y0, -hw),
      new THREE.Vector3(x, y1, -hw),
      new THREE.Vector3(x, y1, hw),
      new THREE.Vector3(x, y0, hw),
      new THREE.Vector3(x, y0, -hw),
    ];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  };
  rectLine(HOOP.boardBottom, HOOP.boardTop, HOOP.boardHalfWidth);
  rectLine(HOOP.rimHeight + 0.05, HOOP.rimHeight + 0.5, 0.295);

  const rimX = s * HOOP_X;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(HOOP.rimRadius, HOOP.rimTube, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xff5a1f, metalness: 0.4, roughness: 0.4 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.set(rimX, HOOP.rimHeight, 0);
  rim.castShadow = true;
  group.add(rim);

  const bracketLen = Math.abs(BOARD_X - HOOP_X) - HOOP.rimRadius;
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(bracketLen, 0.03, 0.12), rim.material);
  bracket.position.set(s * (BOARD_X - bracketLen / 2), HOOP.rimHeight, 0);
  group.add(bracket);

  const net = buildNet();
  net.position.set(rimX, HOOP.rimHeight, 0);
  group.add(net);

  scene.add(group);
  return net;
}

export function buildNet(): THREE.Object3D {
  const strands = 14;
  const rings = 5;
  const depth = 0.42;
  const pts: THREE.Vector3[] = [];
  const at = (ring: number, i: number) => {
    const t = ring / (rings - 1);
    const r = HOOP.rimRadius * (1 - 0.42 * t);
    const a = ((i + (ring % 2) * 0.5) / strands) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * r, -depth * t, Math.sin(a) * r);
  };
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let i = 0; i < strands; i++) {
      const a = at(ring, i);
      const next = ring % 2 === 0 ? i : i + 1;
      pts.push(a, at(ring + 1, next % strands));
      pts.push(a, at(ring + 1, (next - 1 + strands) % strands));
    }
  }
  const net = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.9 }),
  );
  const pivot = new THREE.Group();
  pivot.add(net);
  return pivot;
}
