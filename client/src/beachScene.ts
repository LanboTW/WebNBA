import * as THREE from 'three';
import { COURT, type MapTime } from '@webnba/shared';

/** z of the waterline: the sea lies past the far sideline (-z). */
const SHORE = -21;

/** Sea colours by time: shallow, mid, deep. */
const SEA: Record<MapTime, [string, string, string]> = {
  day: ['#46d6cc', '#1f93b8', '#0e4f8c'],
  dusk: ['#5aa9a6', '#2d6d8c', '#1b3c62'],
  night: ['#12404a', '#0c2638', '#06101f'],
};

const CLOUD: Record<MapTime, number> = { day: 0xffffff, dusk: 0xffc4a6, night: 0x283149 };

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Bands of colour across the texture's width (around a cone or sphere, along a towel). */
function stripes(colors: string[], n: number): THREE.CanvasTexture {
  return canvas(256, 4, (ctx) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect((256 * i) / n, 0, 256 / n + 1, 4);
    }
  });
}

/**
 * The beach past the court: sea with moving foam, wet sand, palms, umbrellas
 * and loungers, a lifeguard tower, surfboards, rocks, a bobbing sailboat,
 * islands and clouds; tiki torches and moonlight on the water at night.
 * `sand`: the ground's colour. Returns the animation step.
 */
export function buildBeach(scene: THREE.Scene, time: MapTime, sand: string): (dt: number) => void {
  const night = time === 'night';
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const add = (o: THREE.Object3D, x: number, y: number, z: number) => {
    o.position.set(x, y, z);
    scene.add(o);
    return o;
  };
  const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const shadow = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((m) => (m.castShadow = true));
    return o;
  };

  // The sea: one plane from just inside the sand out past the far plane, coloured by depth.
  const DEPTH = 320;
  const LAND = 2;
  const [shallow, mid, deep] = SEA[time];
  const seaTex = canvas(4, 1024, (ctx) => {
    const g = ctx.createLinearGradient(0, 1024, 0, 0);
    const at = (d: number) => (d + LAND) / DEPTH;
    g.addColorStop(0, hexA(shallow, 0));
    g.addColorStop(at(0), hexA(shallow, 0.55));
    g.addColorStop(at(2.5), hexA(shallow, 1));
    g.addColorStop(at(9), mid);
    g.addColorStop(at(45), deep);
    g.addColorStop(1, deep);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 1024);
  });
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(700, DEPTH),
    std(0xffffff, { map: seaTex, transparent: true, roughness: 0.22, metalness: 0.05 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.receiveShadow = true;
  add(sea, 0, 0.012, SHORE + LAND - DEPTH / 2);

  // Wet sand: darker toward the water.
  const wet = new THREE.Color(sand).multiplyScalar(0.7);
  const wetTex = canvas(4, 64, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, `#${wet.getHexString()}`);
    g.addColorStop(1, hexA(`#${wet.getHexString()}`, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 64);
  });
  const wetSand = new THREE.Mesh(new THREE.PlaneGeometry(700, 4), std(0xffffff, { map: wetTex, transparent: true, roughness: 0.6 }));
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.receiveShadow = true;
  add(wetSand, 0, 0.004, SHORE + 1);

  // Foam: a broken white line washing up and back, and a fainter one where the waves break.
  const foamTex = canvas(512, 32, (ctx) => {
    for (let i = 0; i < 260; i++) {
      const x = rand() * 512;
      const y = 16 + (rand() - 0.5) * 18 * rand();
      ctx.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 4 + rand() * 14, 1.5 + rand() * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  foamTex.wrapS = THREE.RepeatWrapping;
  const foams = [
    { base: SHORE + 0.4, swing: 0.9, phase: 0, peak: 0.95, w: 1.6 },
    { base: SHORE - 3.2, swing: 1.3, phase: 2.1, peak: 0.55, w: 2.4 },
  ].map((f) => {
    const t = foamTex.clone();
    t.repeat.set(700 / 14, 1);
    t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(700, f.w), std(0xffffff, { map: t, transparent: true, depthWrite: false, roughness: 0.5 }));
    m.rotation.x = -Math.PI / 2;
    add(m, 0, 0.02, f.base);
    return { ...f, mesh: m, tex: t };
  });

  // Palms.
  const ringTex = canvas(64, 8, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#6e5136' : '#8a6a48';
      ctx.fillRect(i * 8, 0, 8, 8);
    }
  });
  ringTex.wrapS = THREE.RepeatWrapping;
  ringTex.repeat.set(6, 1);
  const trunkMat = std(0xffffff, { map: ringTex, roughness: 1 });
  const frondMat = std(0x3d8a3a, { side: THREE.DoubleSide, roughness: 0.9 });
  const frondDark = std(0x2f6e30, { side: THREE.DoubleSide, roughness: 0.9 });
  const nutMat = std(0x5b3d22);
  const frondGeo = (() => {
    const L = 3.3;
    const g = new THREE.PlaneGeometry(L, 1, 10, 2);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getX(i) / L;
      const z = p.getZ(i) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * 0.9;
      p.setZ(i, z);
      p.setY(i, t * L * 0.55 - t * t * L * 1.15 - Math.abs(z) * 0.35);
    }
    g.computeVertexNormals();
    return g;
  })();
  const palm = (x: number, z: number, h: number, dir: number, lean: number) => {
    const g = new THREE.Group();
    const top = new THREE.Vector3(Math.cos(dir) * lean, h, Math.sin(dir) * lean);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(top.x * 0.15, h * 0.6, top.z * 0.15), top);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.16, 8), trunkMat));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const f = new THREE.Mesh(frondGeo, i % 2 ? frondMat : frondDark);
      f.position.copy(top);
      f.rotation.y = (i / n) * Math.PI * 2 + rand() * 0.4;
      f.scale.setScalar(0.85 + rand() * 0.3);
      g.add(f);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), nutMat);
      c.position.set(top.x + Math.cos(a) * 0.2, h - 0.22, top.z + Math.sin(a) * 0.2);
      g.add(c);
    }
    add(shadow(g), x, 0, z);
  };
  for (const [x, z, h, dir, lean] of [
    [-21, -12.8, 6.2, -2.4, 1.6],
    [-11, -18, 7, 1.9, 1.2],
    [3.5, -18.8, 6.4, -1.3, 1.8],
    [16.5, -13, 7.4, -0.6, 1.4],
    [27, -10, 6.8, 0.3, 2],
    [-27.5, -7.5, 6.6, 2.9, 1.7],
    [25.5, 8, 6, 0.7, 1.3],
    [-25, 9, 7.2, 2.4, 1.5],
  ]) {
    palm(x, z, h, dir, lean);
  }

  // Umbrellas, each with a towel and a lounger.
  const pole = std(0xe8e2d4, { roughness: 0.5 });
  const wood = std(0x9c7650);
  const cloth = std(0xf2efe6);
  const sets: [number, number, string[]][] = [
    [-15.5, -14.6, ['#d93a32', '#f7f3ea']],
    [-4.5, -15.6, ['#2468c8', '#f7f3ea']],
    [8, -14.8, ['#f2b51d', '#ef7a1c']],
    [12.5, -17.4, ['#2e9e5b', '#f7f3ea']],
    [-30, -14, ['#e45a9a', '#f7f3ea']],
  ];
  for (const [x, z, colors] of sets) {
    const g = new THREE.Group();
    const tilt = (rand() - 0.5) * 0.25;
    const stick = new THREE.Group();
    stick.rotation.z = tilt;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), pole);
    p.position.y = 1.2;
    const tex = stripes(colors, 8);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.45, 16, 1, true), std(0xffffff, { map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    canopy.position.y = 2.3;
    stick.add(p, canopy);
    g.add(stick);
    const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.8), std(0xffffff, { map: stripes([colors[0], '#ffffff', colors[1]], 9), roughness: 1 }));
    towel.rotation.x = -Math.PI / 2;
    towel.rotation.z = 0.3 + rand() * 0.5;
    towel.position.set(-0.9, 0.012, 0.4);
    towel.receiveShadow = true;
    g.add(towel);
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 1.3), cloth);
    seat.position.set(0, 0.32, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.75), cloth);
    back.position.set(0, 0.55, -0.88);
    back.rotation.x = -0.75;
    chair.add(seat, back);
    for (const [lx, lz] of [
      [-0.27, -0.55],
      [0.27, -0.55],
      [-0.27, 0.55],
      [0.27, 0.55],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.04), wood);
      leg.position.set(lx, 0.16, lz);
      chair.add(leg);
    }
    chair.position.set(0.9, 0, 0.2);
    chair.rotation.y = Math.PI + (rand() - 0.5) * 0.6;
    g.add(chair);
    g.rotation.y = (rand() - 0.5) * 0.8;
    add(shadow(g), x, 0, z);
  }

  // The lifeguard tower.
  {
    const g = new THREE.Group();
    const white = std(0xf1efe8);
    const legMat = std(0xdcd6c8);
    for (const [lx, lz] of [
      [-0.8, -0.8],
      [0.8, -0.8],
      [-0.8, 0.8],
      [0.8, 0.8],
    ]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.14), legMat);
      leg.position.set(lx, 1.25, lz);
      g.add(leg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 2.4), wood);
    deck.position.y = 2.5;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.4, 1.6), std(0x7fc4e0));
    hut.position.set(0, 3.26, -0.2);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), std(0x1d2a33, { roughness: 0.2, metalness: 0.4 }));
    glass.position.set(0, 3.45, 0.61);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.75, 4), std(0xc8352c));
    roof.position.set(0, 4.33, -0.2);
    roof.rotation.y = Math.PI / 4;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.06, 0.06), white);
    rail.position.set(0, 3.0, 1.17);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 3.6), wood);
    ramp.position.set(0, 1.25, 2.6);
    ramp.rotation.x = 0.78;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6), white);
    mast.position.set(0.7, 5.0, -0.8);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), std(0xd8282a, { side: THREE.DoubleSide }));
    flag.position.set(1.0, 5.55, -0.8);
    g.add(deck, hut, glass, roof, rail, ramp, mast, flag);
    g.rotation.y = -0.35;
    add(shadow(g), 23, 0, -15.5);
  }

  // Surfboards standing in the sand by the tower.
  const boardGeo = new THREE.SphereGeometry(1, 18, 12);
  [
    [19.6, -13.6, '#f4d03f', 0.08],
    [20.3, -13.9, '#e8573a', -0.05],
    [21, -13.5, '#3fb6c8', 0.12],
  ].forEach(([x, z, c, tilt]) => {
    const b = new THREE.Mesh(boardGeo, std(c as string, { roughness: 0.35 }));
    b.scale.set(0.27, 1.05, 0.05);
    b.rotation.set(0, -0.3, tilt as number);
    add(shadow(b), x as number, 0.82, z as number);
  });

  // Beach balls.
  const ballTex = stripes(['#e53935', '#ffffff', '#1e88e5', '#ffffff', '#fdd835', '#ffffff'], 6);
  for (const [x, z] of [
    [-8.5, -17.4],
    [10.5, -13.2],
  ]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 12), std(0xffffff, { map: ballTex, roughness: 0.4 }));
    b.rotation.set(rand(), rand(), rand());
    add(shadow(b), x, 0.24, z);
  }

  // Rocks at the waterline and out in the shallows.
  const rock = std(0x6f6a64, { flatShading: true, roughness: 1 });
  for (const [x, z, s] of [
    [-35, -21.5, 1.6],
    [-32, -20, 0.9],
    [-38, -27, 1.2],
    [34, -22.5, 1.8],
    [37, -20.5, 1],
    [44, -29, 1.4],
  ]) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
    r.scale.set(1 + rand() * 0.5, 0.55 + rand() * 0.3, 1 + rand() * 0.4);
    r.rotation.set(rand(), rand() * 3, rand());
    add(shadow(r), x, s * 0.2, z);
  }

  // Sailboats.
  const sailMat = std(0xfbfaf4, { side: THREE.DoubleSide, roughness: 0.7 });
  const boat = (scale: number) => {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 4, 10, 1, false, 0, Math.PI), std(0xf5f5f5));
    hull.rotation.set(0, 0, Math.PI / 2);
    hull.rotation.x = Math.PI;
    hull.position.y = 0.3;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.12, 1.52), std(0x1f4e8c));
    stripe.position.y = 0.27;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5.5, 6), std(0xcfcfcf));
    mast.position.set(0.3, 3, 0);
    const main = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(-1.9, 0), new THREE.Vector2(0, 4.8)]);
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(main), sailMat);
    sail.position.set(0.25, 0.75, 0);
    const jibShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.6, 0), new THREE.Vector2(0, 4.2)]);
    const jib = new THREE.Mesh(new THREE.ShapeGeometry(jibShape), sailMat);
    jib.position.set(0.35, 0.75, 0.02);
    g.add(hull, stripe, mast, sail, jib);
    g.scale.setScalar(scale);
    return g;
  };
  const boats = [
    { g: boat(1), x: 20, z: -58, phase: 0 },
    { g: boat(0.8), x: -42, z: -95, phase: 1.7 },
  ];
  for (const b of boats) {
    b.g.rotation.y = 0.25;
    add(b.g, b.x, 0, b.z);
  }

  // Islands on the horizon, hazed by the fog.
  const island = std(night ? 0x1c2a22 : 0x4f6d4a, { roughness: 1 });
  for (const [x, z, sx, sy, sz] of [
    [-75, -150, 34, 10, 14],
    [70, -160, 48, 14, 18],
    [10, -175, 22, 6, 10],
  ]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), island);
    m.scale.set(sx, sy, sz);
    add(m, x, 0, z);
  }

  // Clouds: unfogged so they stay white against the sky.
  const cloudMat = new THREE.MeshBasicMaterial({ color: CLOUD[time], fog: false, transparent: true, opacity: night ? 0.7 : 0.92 });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const puffs = 4 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(3 + rand() * 3, 14, 10), cloudMat);
      s.position.set((j - puffs / 2) * 4 + rand() * 2, rand() * 2, rand() * 2);
      s.scale.y = 0.55;
      g.add(s);
    }
    add(g, -65 + i * 26 + rand() * 8, 22 + rand() * 18, -135 - rand() * 20);
  }

  // Night: the moon and its light on the water, and tiki torches along the sand.
  const flames: THREE.Object3D[] = [];
  let glitter: THREE.CanvasTexture | null = null;
  if (night) {
    const moon = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
    add(moon, -22, 19, -150);
    glitter = canvas(64, 512, (ctx) => {
      for (let i = 0; i < 380; i++) {
        const y = rand() * 512;
        const fade = Math.min(1, y / 80, (512 - y) / 60);
        const spread = 10 + (y / 512) * 22;
        ctx.fillStyle = `rgba(255,240,205,${(0.3 + rand() * 0.7) * fade})`;
        ctx.fillRect(32 + (rand() - 0.5) * spread * 2, y, 3 + rand() * 12, 1.5 + rand() * 2);
      }
    });
    glitter.wrapT = THREE.RepeatWrapping;
    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 125),
      new THREE.MeshBasicMaterial({ map: glitter, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.75 }),
    );
    path.rotation.x = -Math.PI / 2;
    add(path, -18, 0.03, -150 + 125 / 2 - 2);

    const bamboo = std(0x8a6a3e);
    const fire = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
    fire.color.multiplyScalar(2.2);
    const core = new THREE.MeshBasicMaterial({ color: 0xffe08a });
    core.color.multiplyScalar(2.2);
    const W = COURT.halfWidth;
    for (const [x, z] of [
      [-18.5, -12],
      [-6, -12.6],
      [6, -12.6],
      [18.5, -12],
      [20.5, 0],
      [-20.5, 0],
      [20.5, W + 3],
      [-20.5, W + 3],
    ]) {
      const g = new THREE.Group();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.7, 8), bamboo);
      stick.position.y = 0.85;
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.08, 0.22, 10), bamboo);
      cup.position.y = 1.78;
      const flame = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 10), fire);
      outer.position.y = 0.21;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 8), core);
      inner.position.y = 0.13;
      flame.add(outer, inner);
      flame.position.y = 1.88;
      flames.push(flame);
      g.add(stick, cup, flame);
      add(g, x, 0, z);
    }
  }

  let t = 0;
  return (dt) => {
    t += dt;
    for (const f of foams) {
      const s = Math.sin(t * 0.85 + f.phase);
      f.mesh.position.z = f.base + s * f.swing;
      (f.mesh.material as THREE.MeshStandardMaterial).opacity = f.peak * (0.55 + 0.45 * (0.5 - s * 0.5));
      f.tex.offset.x += dt * 0.004;
    }
    for (const b of boats) {
      b.g.position.y = Math.sin(t * 1.1 + b.phase) * 0.14;
      b.g.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.05;
      b.g.rotation.x = Math.sin(t * 1.3 + b.phase) * 0.03;
    }
    flames.forEach((f, i) => {
      f.scale.set(1 + Math.sin(t * 9 + i) * 0.08, 1 + Math.sin(t * 13 + i * 2.3) * 0.15 + Math.sin(t * 7.1 + i) * 0.1, 1);
    });
    if (glitter) glitter.offset.y = (glitter.offset.y + dt * 0.01) % 1;
  };
}

/** Low wooden posts with two ropes, where a chain-link fence would stand. */
export function buildRopeFence(scene: THREE.Scene, half: boolean): void {
  const post = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.95 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 1 });
  const postGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.95, 8);
  const span = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.4);
    const at = (i: number) => new THREE.Vector3(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n);
    for (let i = 0; i <= n; i++) {
      const p = new THREE.Mesh(postGeo, post);
      p.position.copy(at(i)).setY(0.475);
      p.castShadow = true;
      scene.add(p);
      if (i === n) continue;
      for (const y of [0.85, 0.48]) {
        const a = at(i).setY(y);
        const b = at(i + 1).setY(y);
        const m = a.clone().lerp(b, 0.5);
        m.y -= 0.14;
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 8, 0.018, 5), rope));
      }
    }
  };
  const bx = COURT.halfLength + 3.2;
  const sz = COURT.halfWidth + 2.6;
  span(half ? -4 : -bx, -sz, bx, -sz);
  span(bx, -sz, bx, sz);
  if (!half) span(-bx, -sz, -bx, sz);
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
