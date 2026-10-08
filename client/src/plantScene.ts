import * as THREE from 'three';
import { COURT, mapColor, type MapDef, type TeamInfo } from '@webnba/shared';
import { buildHoop, netSwing, type Arena, type Cheer } from './arena';
import { buildFloor } from './courtFloor';
import type { Quality } from './graphics';

/**
 * The Springfield nuclear power plant (the built-in `plant` map): a turbine
 * hall with teal wall panels, gauge consoles, pipes and high windows on the
 * cooling towers. Past the +x hoop lies the school bus Peter and Homer
 * wrecked, on its side and burning, torn ducts draped over it; past the other
 * end, glowing waste barrels. Mr. Burns stands on the catwalk over the far
 * sideline pointing at the ball, Smithers at his side; Lenny, Carl and two
 * workers in radiation suits watch from the floor. The camera looks from +z.
 */

const SKIN = '#ffd521';
const WALL_Z = -13.5;
const SIDE_X = 28;
/** Low and forward enough that Burns stays below the scoreboard on the broadcast camera. */
const CATWALK_Y = 2.3;
const CATWALK_Z = -10.7;

/** What Burns says when someone scores. */
const LINES: Record<Cheer, string> = { score: 'Excellent…', dunk: '放狗！', three: 'Smithers，記下他的名字' };

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function shadows<T extends THREE.Object3D>(o: T, receive = false): T {
  o.traverse((m) => {
    m.castShadow = true;
    m.receiveShadow = receive;
  });
  return o;
}

export function buildPlant(scene: THREE.Scene, map: MapDef, home: TeamInfo, half: boolean): Arena {
  const bg = 0x0a0d10;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 45, 90);
  const cx = half ? 7 : 0;

  // Cold fluorescent light; the fire and the waste add their own.
  scene.add(new THREE.HemisphereLight(0xd6ecff, 0x2a211d, 0.85));
  const key = new THREE.DirectionalLight(0xeaf6ff, 2.0);
  key.position.set(6, 22, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const c = key.shadow.camera;
  c.left = -30;
  c.right = 30;
  c.top = 16;
  c.bottom = -18;
  c.near = 1;
  c.far = 60;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe8e0, 0.5);
  fill.position.set(-10, 15, -8);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(SIDE_X * 2, 50),
    std(0xffffff, { map: groundTexture(mapColor(map.apron, home)), roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.01, WALL_Z + 25);
  ground.receiveShadow = true;
  scene.add(ground);
  const floor = buildFloor(map, home, half);
  scene.add(floor.mesh);
  addHazardBorder(scene, half);

  addHall(scene, half);
  addConsoles(scene, half);
  const fire = addBus(scene);
  const glow = addBarrels(scene, half);

  const nets = half ? [buildHoop(scene, 1, home), new THREE.Object3D()] : [buildHoop(scene, 1, home), buildHoop(scene, -1, home)];
  const swing = netSwing(nets);

  // The catwalk over the far sideline, and the boss on it.
  addCatwalk(scene, cx);
  const burns = buildBurns();
  // Off the middle, where the scoreboard sits.
  const bossX = cx + 3.2;
  burns.root.position.set(bossX, CATWALK_Y, CATWALK_Z + 0.2);
  const smithers = buildSmithers();
  smithers.root.position.set(bossX - 0.95, CATWALK_Y, CATWALK_Z - 0.25);
  // A little larger than life, so the boss reads from the far camera.
  burns.root.scale.setScalar(1.3);
  smithers.root.scale.setScalar(1.3);
  scene.add(shadows(burns.root), shadows(smithers.root));
  const bubble = speechBubble();
  // Just right of his head on screen, clear of him.
  bubble.sprite.position.set(bossX + 0.55, CATWALK_Y + 2.3, CATWALK_Z + 0.6);
  scene.add(bubble.sprite);

  const workers = [
    buildWorker('lenny'),
    buildWorker('carl'),
    buildWorker('suit'),
    buildWorker('suit'),
  ];
  const spots: [number, number][] = half
    ? [
        [1.2, -8.7],
        [2.6, -9.1],
        [-3.5, -6],
        [-4.2, 4.5],
      ]
    : [
        [-7.8, -8.7],
        [-6.4, -9.1],
        [-19.5, -7],
        [17.6, -6.6],
      ];
  workers.forEach((w, i) => {
    const [x, z] = spots[i];
    w.root.position.set(x, 0, z);
    // Facing the middle of the court.
    w.root.rotation.y = Math.atan2(cx - x, -z);
    scene.add(shadows(w.root));
  });

  const target = new THREE.Vector3(cx, 1, 0);
  let talk = 0;
  let t = 0;
  let quality: Quality | null = null;
  return {
    nets,
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      const size = q === 'high' ? 4096 : 2048;
      if (key.shadow.mapSize.x !== size) {
        key.shadow.mapSize.set(size, size);
        key.shadow.map?.dispose();
        key.shadow.map = null;
      }
    },
    swishNet: swing.swish,
    cheer(kind = 'score') {
      talk = 2.8;
      bubble.say(LINES[kind]);
      for (const w of workers) w.cheer();
    },
    follow(x, z) {
      target.set(x, 1, z);
    },
    spotOn() {},
    update(dt) {
      t += dt;
      swing.update(dt);
      fire(t);
      glow(t);
      talk = Math.max(0, talk - dt);
      burns.update(dt, t, target, talk > 0);
      smithers.update(dt, t, burns.root.rotation.y, talk > 0);
      bubble.update(dt, talk);
      for (const w of workers) w.update(dt, t);
    },
  };
}

/** Dirty concrete: the apron colour with stains and cracks. */
function groundTexture(color: string): THREE.CanvasTexture {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tex = canvas(1024, 1024, (ctx) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 70; i++) {
      const r = 20 + rand() * 90;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      const dark = rand() < 0.7;
      g.addColorStop(0, dark ? 'rgba(20,12,10,0.28)' : 'rgba(255,240,220,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(rand() * 1024, rand() * 1024);
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(15,10,8,0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let x = rand() * 1024;
      let y = rand() * 1024;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rand() - 0.5) * 80;
        y += (rand() - 0.5) * 80;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2.5);
  tex.anisotropy = 8;
  return tex;
}

/** Yellow and black warning stripes around the court. */
function addHazardBorder(scene: THREE.Scene, half: boolean): void {
  const tex = canvas(256, 32, (ctx) => {
    ctx.fillStyle = '#f2c414';
    ctx.fillRect(0, 0, 256, 32);
    ctx.fillStyle = '#16140f';
    for (let x = -32; x < 288; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 32);
      ctx.lineTo(x + 16, 32);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, 0);
      ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  const L = COURT.halfLength + 0.6;
  const W = COURT.halfWidth + 0.6;
  const x0 = half ? -0.6 : -L;
  const band = 0.45;
  const strip = (len: number, x: number, z: number, along: boolean) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 1.4, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, band), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }));
    m.rotation.x = -Math.PI / 2;
    if (!along) m.rotation.z = Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  const len = L - x0 + band * 2;
  strip(len, (L + x0) / 2, -W - band / 2, true);
  strip(len, (L + x0) / 2, W + band / 2, true);
  strip(W * 2, L + band / 2, 0, false);
  strip(W * 2, x0 - band / 2, 0, false);
}

/** Teal wall panels with rust streaks. */
function panelTexture(): THREE.CanvasTexture {
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const tex = canvas(512, 512, (ctx) => {
    ctx.fillStyle = '#5f9ea6';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        const g = ctx.createLinearGradient(0, j * 256, 0, j * 256 + 256);
        g.addColorStop(0, '#6eb0b6');
        g.addColorStop(1, '#4f8a94');
        ctx.fillStyle = g;
        ctx.fillRect(i * 128 + 3, j * 256 + 3, 122, 250);
        // Rust running down from a bolt.
        if (rand() < 0.55) {
          const x = i * 128 + 10 + rand() * 100;
          const r = ctx.createLinearGradient(0, j * 256, 0, j * 256 + 60 + rand() * 150);
          r.addColorStop(0, 'rgba(120,60,30,0.55)');
          r.addColorStop(1, 'rgba(120,60,30,0)');
          ctx.fillStyle = r;
          ctx.fillRect(x, j * 256 + 3, 6 + rand() * 10, 250);
        }
      }
    }
    ctx.fillStyle = '#2f5a62';
    for (let i = 0; i <= 4; i++) ctx.fillRect(i * 128 - 2, 0, 4, 512);
    ctx.fillRect(0, 254, 512, 4);
    ctx.fillStyle = '#2a3f44';
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++)
        for (const [dx, dy] of [
          [8, 8],
          [120, 8],
          [8, 248],
          [120, 248],
        ]) {
          ctx.beginPath();
          ctx.arc(i * 128 + dx, j * 256 + dy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The view out of the high windows: a hazy sky and two steaming cooling towers. */
function windowTexture(): THREE.CanvasTexture {
  return canvas(512, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#9fc9e0');
    g.addColorStop(1, '#d9e6d0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 128);
    for (const x of [150, 330]) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc(x + k * 10 - 10, 24 - k * 6, 18 + k * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#9a9c98';
      ctx.beginPath();
      ctx.moveTo(x - 46, 128);
      ctx.quadraticCurveTo(x - 18, 80, x - 30, 34);
      ctx.lineTo(x + 30, 34);
      ctx.quadraticCurveTo(x + 18, 80, x + 46, 128);
      ctx.fill();
      ctx.fillStyle = '#7d807c';
      ctx.fillRect(x - 30, 34, 60, 5);
    }
    // Window bars.
    ctx.fillStyle = '#22343a';
    for (let x = 0; x <= 512; x += 64) ctx.fillRect(x - 3, 0, 6, 128);
    ctx.fillRect(0, 60, 512, 5);
  });
}

/** Walls, ceiling, light tubes, pipes, extinguishers. */
function addHall(scene: THREE.Scene, half: boolean): void {
  const H = 14;
  const panels = panelTexture();
  const wall = (len: number, x: number, z: number, ry: number) => {
    const t = panels.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 8, H / 8);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), std(0xffffff, { map: t, roughness: 0.8 }));
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
  };
  wall(SIDE_X * 2, 0, WALL_Z, 0);
  wall(50, -SIDE_X, WALL_Z + 25, Math.PI / 2);
  wall(50, SIDE_X, WALL_Z + 25, -Math.PI / 2);
  wall(SIDE_X * 2, 0, WALL_Z + 50, Math.PI);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_X * 2, 50), std(0x1c2226));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, WALL_Z + 25);
  scene.add(ceiling);

  // High windows along the back wall.
  const win = new THREE.MeshBasicMaterial({ map: windowTexture() });
  for (const x of [-18, 0, 18]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), win);
    w.position.set(x, 10.6, WALL_Z + 0.02);
    scene.add(w);
  }

  // Steel roof trusses and hanging fluorescent tubes.
  const steel = std(0x3a4247, { metalness: 0.5, roughness: 0.6 });
  const tube = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xeafaff).multiplyScalar(2) });
  for (const x of [-21, -14, -7, 0, 7, 14, 21]) {
    scene.add(box(0.35, 0.6, 50, steel, x, H - 0.4, WALL_Z + 25));
  }
  for (const x of [-12, -4, 4, 12]) {
    for (const z of [-7, 0, 7]) {
      scene.add(box(2.6, 0.12, 0.5, steel, x, 11.2, z));
      for (const dz of [-0.12, 0.12]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), tube);
        l.rotation.z = Math.PI / 2;
        l.position.set(x, 11.1, z + dz);
        scene.add(l);
      }
    }
  }

  // Pipes on the back and side walls, with valve wheels.
  const pipe = std(0x8a9096, { metalness: 0.6, roughness: 0.45 });
  const red = std(0xb3241c, { roughness: 0.5 });
  const run = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => {
    const d = b.clone().sub(a);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), m);
    p.position.copy(a).addScaledVector(d, 0.5);
    p.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    p.castShadow = true;
    scene.add(p);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  run(v(-SIDE_X, 7.6, WALL_Z + 0.5), v(SIDE_X, 7.6, WALL_Z + 0.5), 0.28, pipe);
  run(v(-SIDE_X, 8.4, WALL_Z + 0.4), v(SIDE_X, 8.4, WALL_Z + 0.4), 0.16, red);
  for (const x of [-24, -15, 11, 16, 24]) run(v(x, 0, WALL_Z + 0.45), v(x, 7.6, WALL_Z + 0.45), 0.2, pipe);
  for (const s of [-1, 1]) {
    run(v(s * (SIDE_X - 0.5), 6.5, -12), v(s * (SIDE_X - 0.5), 6.5, 20), 0.3, pipe);
    run(v(s * (SIDE_X - 0.4), 0, 2), v(s * (SIDE_X - 0.4), 6.5, 2), 0.22, pipe);
  }
  for (const x of [-15, 16]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 16), red);
    wheel.position.set(x, 3.2, WALL_Z + 0.85);
    scene.add(wheel);
    run(v(x, 3.2, WALL_Z + 0.45), v(x, 3.2, WALL_Z + 0.85), 0.05, red);
  }

  // Fire extinguishers, as in the fight.
  const ext = (x: number, z: number, ry: number) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 4, 12), std(0xd01e1a, { roughness: 0.35 })));
    g.add(box(0.06, 0.1, 0.06, std(0x222222), 0, 0.36, 0));
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 6, 12, Math.PI), std(0x1a1a1a));
    hose.position.set(0.1, 0.3, 0.05);
    hose.rotation.z = -Math.PI / 2;
    g.add(hose);
    g.add(box(0.3, 0.05, 0.08, std(0x333333), 0, -0.12, -0.12));
    g.position.set(x, 1.35, z);
    g.rotation.y = ry;
    scene.add(shadows(g));
  };
  for (const x of half ? [-6, 14, 21] : [-21, -9, 9, 22]) ext(x, WALL_Z + 0.2, 0);
  ext(-SIDE_X + 0.2, 4, Math.PI / 2);
  ext(SIDE_X - 0.2, -2, -Math.PI / 2);
}

/** Blue control consoles with gauges under the catwalk. */
function addConsoles(scene: THREE.Scene, half: boolean): void {
  const face = canvas(256, 192, (ctx) => {
    ctx.fillStyle = '#2f4f9e';
    ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = '#25407f';
    ctx.fillRect(10, 120, 236, 60);
    for (let i = 0; i < 3; i++) {
      const x = 50 + i * 78;
      ctx.fillStyle = '#e8eef2';
      ctx.beginPath();
      ctx.arc(x, 60, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#9aa6b0';
      ctx.stroke();
      ctx.strokeStyle = '#c0251d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 60);
      const a = -2.2 + i * 1.1;
      ctx.lineTo(x + Math.cos(a) * 22, 60 + Math.sin(a) * 22);
      ctx.stroke();
      ctx.fillStyle = '#c0251d';
      ctx.beginPath();
      ctx.arc(x, 60, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Vent slots, and a row of lamps.
    ctx.fillStyle = '#1b2c58';
    for (let k = 0; k < 5; k++) ctx.fillRect(24, 128 + k * 10, 90, 5);
    const lamps = ['#ff3b30', '#ffd60a', '#34c759', '#34c759', '#ff9f0a'];
    lamps.forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(140 + k * 22, 150, 7, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  const body = std(0x2f4f9e, { roughness: 0.55, metalness: 0.2 });
  const front = std(0xffffff, { map: face, roughness: 0.5, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.12 });
  const xs = half ? [-8, -4.5, 13.5] : [-15, -11.5, 8.5, 12];
  for (const x of xs) {
    const g = new THREE.Group();
    g.add(box(3.2, 2.4, 1.2, body, 0, 1.2, 0));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.3), front);
    f.position.set(0, 1.2, 0.61);
    g.add(f);
    // The sloped desk on top.
    const desk = box(3.2, 0.15, 0.9, std(0x24407f), 0, 2.45, 0.3);
    desk.rotation.x = 0.35;
    g.add(desk);
    g.position.set(x, 0, WALL_Z + 0.7);
    scene.add(shadows(g, true));
  }
}

/**
 * The school bus on its side, burning at the front, with the torn ducts that
 * came down with it. Returns the flicker step.
 */
function addBus(scene: THREE.Scene): (t: number) => void {
  const yellow = std(0xf0a400, { roughness: 0.55 });
  const black = std(0x1b1b1b, { roughness: 0.6 });
  const glass = std(0x2a3a44, { roughness: 0.15, metalness: 0.3 });
  const steel = std(0x9aa0a6, { metalness: 0.6, roughness: 0.4 });
  // Built upright (length along x, front at +x), then laid on its side.
  const bus = new THREE.Group();
  const LEN = 9;
  bus.add(box(LEN, 2.5, 2.5, yellow, 0, 1.85, 0));
  for (let x = -LEN / 2 + 0.6; x < LEN / 2; x += 0.75) bus.add(box(0.08, 0.06, 2.52, std(0xd99400), x, 3.1, 0));
  for (const s of [1, -1]) {
    bus.add(box(LEN - 1.4, 0.75, 0.04, glass, -0.4, 2.35, s * 1.26));
    bus.add(box(LEN, 0.1, 0.04, black, 0, 1.55, s * 1.27));
    bus.add(box(LEN, 0.1, 0.04, black, 0, 1.2, s * 1.27));
    for (const x of [-3, 2.6]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 18), black);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.6, s * 1.1);
      bus.add(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.42, 10), steel);
      hub.rotation.x = Math.PI / 2;
      hub.position.copy(w.position);
      bus.add(hub);
    }
  }
  // The hood and grille, the windshield and the SCHOOL BUS sign.
  bus.add(box(1.5, 1.3, 2.3, yellow, LEN / 2 + 0.75, 1.25, 0));
  bus.add(box(0.06, 1.0, 1.7, std(0x6b6f72, { metalness: 0.5 }), LEN / 2 + 1.52, 1.25, 0));
  bus.add(box(0.3, 0.3, 2.6, steel, LEN / 2 + 1.6, 0.55, 0));
  bus.add(box(0.04, 0.9, 2.1, glass, LEN / 2 + 0.02, 2.4, 0));
  const sign = canvas(256, 48, (ctx) => {
    ctx.fillStyle = '#f0a400';
    ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCHOOL BUS', 128, 26);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.38), new THREE.MeshStandardMaterial({ map: sign }));
  plate.position.set(LEN / 2 + 0.03, 3.0, 0);
  plate.rotation.y = Math.PI / 2;
  bus.add(plate);
  // A dented roof edge.
  const dent = box(1.6, 0.5, 0.6, black, LEN / 2 - 1.4, 3.05, 1.0);
  dent.rotation.x = 0.5;
  bus.add(dent);

  // On its side, the roof toward the court and the front toward the hoop.
  bus.rotation.x = -Math.PI / 2;
  bus.position.y = 1.32;
  const wreck = new THREE.Group();
  wreck.add(bus);
  wreck.position.set(23, 0, -12.2);
  wreck.rotation.y = Math.PI - 0.12;
  scene.add(shadows(wreck, true));

  // The ducts: grey ribbed tubes down from the wall, torn open at the ends.
  const ribs = canvas(64, 256, (ctx) => {
    ctx.fillStyle = '#8f969c';
    ctx.fillRect(0, 0, 64, 256);
    ctx.fillStyle = '#62696f';
    for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 64, 5);
  });
  ribs.wrapS = ribs.wrapT = THREE.RepeatWrapping;
  const duct = (pts: [number, number, number][], r: number) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const t = ribs.clone();
    t.needsUpdate = true;
    t.repeat.set(1, curve.getLength() / 1.4);
    const m = std(0xffffff, { map: t, metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 14, false), m);
    scene.add(shadows(tube, true));
    // The torn end: a ring of jagged teeth.
    const end = curve.getPoint(1);
    const dir = curve.getTangent(1);
    const teeth = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.5, 14, 1, true);
    const pos = teeth.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setY(i, 0.25 + ((i % 2) * 0.45 + ((i * 7) % 5) * 0.06));
    teeth.computeVertexNormals();
    const torn = new THREE.Mesh(teeth, std(0x6f767c, { metalness: 0.5, side: THREE.DoubleSide }));
    torn.position.copy(end);
    torn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    scene.add(shadows(torn));
  };
  // One down over the bus to the floor in front of it, one torn off above it.
  duct(
    [
      [19.5, 12.8, WALL_Z + 0.6],
      [20.2, 8.5, WALL_Z + 1.4],
      [21.4, 4.4, -10.8],
      [22.2, 3.4, -8.9],
      [22.8, 0.7, -7.2],
    ],
    0.62,
  );
  duct(
    [
      [SIDE_X - 0.4, 10.5, -10],
      [26.4, 6.8, -10.6],
      [25.4, 4.2, -10.4],
      [24.6, 3.4, -9.6],
    ],
    0.55,
  );

  // Fire at the front of the bus, behind it against the wall.
  const flame = canvas(64, 128, (ctx) => {
    const g = ctx.createRadialGradient(32, 96, 2, 32, 80, 60);
    g.addColorStop(0, 'rgba(255,250,200,1)');
    g.addColorStop(0.25, 'rgba(255,200,60,0.95)');
    g.addColorStop(0.6, 'rgba(255,90,20,0.6)');
    g.addColorStop(1, 'rgba(160,20,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.quadraticCurveTo(64, 70, 54, 110);
    ctx.quadraticCurveTo(32, 132, 10, 110);
    ctx.quadraticCurveTo(0, 70, 32, 0);
    ctx.fill();
  });
  const flames: { s: THREE.Sprite; h: number; ph: number }[] = [];
  const spots: [number, number, number, number][] = [
    [17.4, 2.2, -12.9, 4.6],
    [18.6, 2.6, -13.0, 5.2],
    [19.8, 2.4, -12.9, 4.4],
    [16.6, 1.4, -11.9, 3.0],
    [18.2, 3.6, -11.6, 2.6],
    [16.4, 0.9, -9.6, 1.6],
  ];
  spots.forEach(([x, y, z, h], i) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flame, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    s.position.set(x, y, z);
    scene.add(s);
    flames.push({ s, h, ph: i * 1.7 });
  });
  const light = new THREE.PointLight(0xff7a1e, 90, 24, 1.6);
  light.position.set(17.5, 3, -10);
  scene.add(light);
  // Black smoke rolling up the wall.
  const puff = canvas(64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(40,36,34,0.9)');
    g.addColorStop(1, 'rgba(40,36,34,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  const smoke = Array.from({ length: 7 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
    scene.add(s);
    return s;
  });
  return (t) => {
    smoke.forEach((s, i) => {
      const life = (t * 0.12 + i / smoke.length) % 1;
      s.position.set(18.4 + Math.sin(i * 2.3 + life * 3) * 0.8, 4 + life * 9, -12.6 + life * 0.8);
      s.scale.setScalar(2 + life * 5);
      s.material.opacity = 0.75 * Math.sin(life * Math.PI);
    });
    for (const f of flames) {
      const k = 1 + Math.sin(t * 9 + f.ph) * 0.12 + Math.sin(t * 23 + f.ph * 2) * 0.06;
      f.s.scale.set(f.h * 0.55 * (2 - k), f.h * k, 1);
    }
    light.intensity = 80 + Math.sin(t * 13) * 18 + Math.sin(t * 31) * 10;
  };
}

/** Yellow drums with the radiation sign, some leaking green. Returns the glow's pulse. */
function addBarrels(scene: THREE.Scene, half: boolean): (t: number) => void {
  const label = canvas(256, 128, (ctx) => {
    ctx.fillStyle = '#e8b417';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = 'rgba(80,50,20,0.25)';
    ctx.fillRect(0, 0, 256, 10);
    ctx.fillRect(0, 118, 256, 10);
    for (const cx of [64, 192]) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(cx, 64, 8, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(cx, 64);
        ctx.arc(cx, 64, 38, a - 0.52, a + 0.52);
        ctx.arc(cx, 64, 13, a + 0.52, a - 0.52, true);
        ctx.fill();
      }
    }
  });
  const drum = std(0xffffff, { map: label, roughness: 0.5, metalness: 0.2 });
  const ooze = new THREE.MeshStandardMaterial({ color: 0x7dff3a, emissive: 0x5cff1a, emissiveIntensity: 1.6, roughness: 0.3 });
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 20);
  const bx = half ? -9 : -22;
  const bz = -10;
  const at: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [0.9, 0, 0.2, 0],
    [-0.9, 0, -0.1, 0],
    [0.4, 0, 0.95, 0],
    [-0.5, 0, 0.9, 0],
    [0.45, 1.2, 0.15, 0],
    [-0.45, 1.2, 0, 0],
    [2.2, 0, 1.4, 1],
    [1.6, 0, -0.9, 0],
  ];
  const pulse: THREE.Mesh[] = [];
  for (const [dx, y, dz, tipped] of at) {
    const d = new THREE.Mesh(geo, drum);
    if (tipped) {
      d.rotation.z = Math.PI / 2;
      d.rotation.y = 0.6;
      d.position.set(bx + dx, 0.42, bz + dz);
      // A puddle of the stuff.
      const p = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), ooze);
      p.rotation.x = -Math.PI / 2;
      p.scale.set(1.3, 0.8, 1);
      p.position.set(bx + dx + 1.1, 0.012, bz + dz + 0.5);
      scene.add(p);
      pulse.push(p);
    } else {
      d.position.set(bx + dx, y + 0.6, bz + dz);
      // Open tops glowing green.
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20), ooze);
      top.rotation.x = -Math.PI / 2;
      top.position.set(bx + dx, y + 1.21, bz + dz);
      scene.add(top);
      pulse.push(top);
    }
    d.castShadow = true;
    d.receiveShadow = true;
    scene.add(d);
  }
  const light = new THREE.PointLight(0x6dff2a, 45, 16, 1.6);
  light.position.set(bx + 0.6, 2.2, bz + 1.2);
  scene.add(light);
  return (t) => {
    const k = 0.5 + Math.sin(t * 2.2) * 0.5;
    ooze.emissiveIntensity = 1.2 + k * 0.8;
    light.intensity = 35 + k * 20;
  };
}

/** A steel catwalk along the back wall, with railings and posts. */
function addCatwalk(scene: THREE.Scene, cx: number): void {
  const steel = std(0x4b5358, { metalness: 0.6, roughness: 0.5 });
  const rail = std(0xd6b21c, { roughness: 0.5 });
  // Stops short of the bus.
  const x0 = cx - 13;
  const x1 = Math.min(cx + 13, 15.5);
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  const deck = box(len, 0.14, 1.9, steel, mid, CATWALK_Y - 0.07, CATWALK_Z);
  scene.add(shadows(deck, true));
  const front = CATWALK_Z + 0.9;
  for (const y of [0.55, 1.05]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, len, 8), rail);
    r.rotation.z = Math.PI / 2;
    r.position.set(mid, CATWALK_Y + y, front);
    scene.add(r);
  }
  for (let x = x0; x <= x1 + 0.01; x += len / Math.round(len / 2)) {
    scene.add(box(0.06, 1.05, 0.06, rail, x, CATWALK_Y + 0.52, front));
  }
  for (const x of [x0 + 1, x0 + len / 3, x0 + (len * 2) / 3, x1 - 1]) {
    scene.add(shadows(box(0.25, CATWALK_Y, 0.25, steel, x, CATWALK_Y / 2, front - 0.1)));
  }
  // A kick plate so the edge reads from below.
  scene.add(box(len, 0.22, 0.04, rail, mid, CATWALK_Y + 0.04, front + 0.02));
}

// ---- The people -------------------------------------------------------------

/** An arm from the shoulder along +z, so pointing it is a lookAt. */
interface Arm {
  pivot: THREE.Group;
  len: number;
}

function arm(len: number, r: number, sleeve: THREE.Material, hand: THREE.Material, x: number, y: number): Arm {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const a = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 4, 10), sleeve);
  a.rotation.x = Math.PI / 2;
  a.position.z = len / 2 - r;
  pivot.add(a);
  const h = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 10, 8), hand);
  h.position.z = len - r;
  pivot.add(h);
  return { pivot, len };
}

const _p = new THREE.Vector3();
/** Points the arm at a spot (in the figure's own space); `reach` stretches or shortens it to touch it. */
function aim(a: Arm, root: THREE.Object3D, x: number, y: number, z: number, reach = false): void {
  _p.set(x, y, z);
  const d = _p.distanceTo(a.pivot.position);
  root.updateMatrixWorld();
  root.localToWorld(_p);
  a.pivot.lookAt(_p);
  a.pivot.scale.z = reach ? Math.min(1.1, d / a.len) : 1;
}

/** A Simpsons head: big white eyes with dot pupils. Returns the head group (origin at the neck). */
function head(skin: THREE.Material, r: number, opts: { nose?: 'long' | 'hook'; overbite?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), skin);
  skull.scale.set(0.95, 1.2, 1);
  skull.position.y = r * 1.1;
  g.add(skull);
  const white = std(0xffffff, { roughness: 0.3 });
  const dark = std(0x111111, { roughness: 0.3 });
  for (const s of [1, -1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 14, 10), white);
    eye.position.set(s * r * 0.3, r * 1.3, r * 0.82);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.06, 6, 5), dark);
    pupil.position.set(s * r * 0.3, r * 1.3, r * 1.13);
    g.add(pupil);
  }
  if (opts.nose === 'hook') {
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.16, r * 0.75, 8), skin);
    nose.rotation.x = Math.PI / 2 + 0.6;
    nose.position.set(0, r * 0.95, r * 1.2);
    g.add(nose);
  } else {
    const nose = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.12, r * 0.28, 4, 8), skin);
    nose.rotation.x = Math.PI / 2 + 0.3;
    nose.position.set(0, r * 1.02, r * 1.05);
    g.add(nose);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(r * 0.55, r * 0.05, r * 0.05), std(0x5a2a22));
  mouth.position.set(0, r * 0.62, r * 0.93);
  g.add(mouth);
  if (opts.overbite) {
    const lip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 10, 8), skin);
    lip.scale.set(1.3, 0.5, 0.7);
    lip.position.set(0, r * 0.7, r * 0.9);
    g.add(lip);
  }
  for (const s of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 8, 6), skin);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(s * r * 0.95, r * 1.05, 0);
    g.add(ear);
  }
  return g;
}

/** Legs and a body: returns the root, and where the shoulders and neck are. */
function body(o: { hip: number; torso: number; width: number; legR: number; pants: THREE.Material; shirt: THREE.Material; shoes: THREE.Material }) {
  const root = new THREE.Group();
  for (const s of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(o.legR, o.hip - 2 * o.legR, 4, 8), o.pants);
    leg.position.set(s * o.width * 0.32, o.hip / 2, 0);
    root.add(leg);
    const shoe = box(o.legR * 2.4, 0.09, o.legR * 3.6, o.shoes, s * o.width * 0.32, 0.045, o.legR * 0.8);
    root.add(shoe);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(o.width / 2, o.torso - o.width, 4, 12), o.shirt);
  torso.scale.z = 0.75;
  torso.position.y = o.hip + o.torso / 2 - 0.05;
  root.add(torso);
  return { root, shoulder: o.hip + o.torso - o.width * 0.35, neck: o.hip + o.torso - 0.06 };
}

interface Boss {
  root: THREE.Group;
  update(dt: number, t: number, target: THREE.Vector3, talking: boolean): void;
}

/** Mr. Burns: thin, stooped, a hooked nose and a grey fringe, pointing. */
function buildBurns(): Boss {
  const skin = std(0xf3d46a, { roughness: 0.6 });
  const suit = std(0x56664c, { roughness: 0.8 });
  const b = body({ hip: 0.82, torso: 0.66, width: 0.3, legR: 0.06, pants: suit, shirt: suit, shoes: std(0x1e1a16) });
  const root = b.root;
  // A white shirt front and a red tie.
  const shirt = box(0.1, 0.36, 0.02, std(0xf2f2ee), 0, b.shoulder - 0.12, 0.12);
  shirt.rotation.x = -0.15;
  root.add(shirt);
  root.add(box(0.035, 0.26, 0.025, std(0xa3241f), 0, b.shoulder - 0.13, 0.135));
  const neck = new THREE.Group();
  neck.position.set(0, b.neck, 0.06);
  // The stoop: head well forward.
  neck.rotation.x = 0.35;
  const h = head(skin, 0.14, { nose: 'hook' });
  h.position.z = 0.05;
  neck.add(h);
  const fringe = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.03, 6, 16, Math.PI * 1.2), std(0x9a9a92));
  fringe.rotation.set(Math.PI / 2, 0, Math.PI * 0.9);
  fringe.position.set(0, 0.15, 0.04);
  neck.add(fringe);
  root.add(neck);
  const right = arm(0.62, 0.045, suit, skin, -0.17, b.shoulder);
  const left = arm(0.62, 0.045, suit, skin, 0.17, b.shoulder);
  root.add(right.pivot, left.pivot);
  root.rotation.y = 0;
  let steeple = 0;
  return {
    root,
    update(dt, t, target, talking) {
      // Turn toward the ball, within reason.
      const p = root.position;
      const want = Math.max(-1.25, Math.min(1.25, Math.atan2(target.x - p.x, target.z - p.z)));
      root.rotation.y += (want - root.rotation.y) * Math.min(1, dt * 3);
      steeple += ((talking ? 1 : 0) - steeple) * Math.min(1, dt * 6);
      neck.rotation.y = Math.sin(t * 0.7) * 0.06;
      if (steeple > 0.5) {
        // Excellent: fingertips together, tapping.
        const tap = Math.sin(t * 14) * 0.025;
        aim(right, root, -0.01 - tap, b.shoulder - 0.2, 0.3, true);
        aim(left, root, 0.01 + tap, b.shoulder - 0.2, 0.3, true);
        return;
      }
      root.updateMatrixWorld();
      right.pivot.lookAt(target.x, target.y + 0.6, target.z);
      right.pivot.scale.z = 1;
      aim(left, root, 0.22, b.shoulder - 0.62, 0.05);
    },
  };
}

interface Aide {
  root: THREE.Group;
  update(dt: number, t: number, bossYaw: number, writing: boolean): void;
}

/** Smithers: glasses, a neat parting, a clipboard; writes when Burns talks. */
function buildSmithers(): Aide {
  const skin = std(SKIN, { roughness: 0.6 });
  const suit = std(0x3e5f8a, { roughness: 0.75 });
  const b = body({ hip: 0.86, torso: 0.68, width: 0.34, legR: 0.065, pants: suit, shirt: suit, shoes: std(0x1e1a16) });
  const root = b.root;
  root.add(box(0.12, 0.34, 0.02, std(0xf4f4f0), 0, b.shoulder - 0.12, 0.13));
  const bow = box(0.12, 0.05, 0.03, std(0xb52a2a), 0, b.shoulder - 0.0, 0.14);
  root.add(bow);
  const neck = new THREE.Group();
  neck.position.set(0, b.neck, 0.02);
  const h = head(skin, 0.14);
  neck.add(h);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, 1.25), std(0x5a3a22));
  hair.scale.set(0.97, 1.2, 1.02);
  hair.position.set(0, 0.155, -0.01);
  hair.rotation.x = -0.3;
  neck.add(hair);
  const frame = std(0x1a1a1a, { roughness: 0.3 });
  for (const s of [1, -1]) {
    const g = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.008, 6, 16), frame);
    g.position.set(s * 0.042, 0.182, 0.165);
    neck.add(g);
  }
  root.add(neck);
  // The clipboard, held against the chest by the left hand.
  const board = new THREE.Group();
  board.add(box(0.28, 0.36, 0.02, std(0x8a5a2b)));
  board.add(box(0.24, 0.3, 0.005, std(0xf8f8f2), 0, -0.01, 0.013));
  board.position.set(0.02, b.shoulder - 0.32, 0.3);
  board.rotation.x = -0.6;
  root.add(board);
  const left = arm(0.62, 0.05, suit, skin, 0.19, b.shoulder);
  const right = arm(0.62, 0.05, suit, skin, -0.19, b.shoulder);
  root.add(left.pivot, right.pivot);
  aim(left, root, 0.12, b.shoulder - 0.4, 0.3, true);
  let yaw = 0;
  return {
    root,
    update(dt, t, bossYaw, writing) {
      // Follows where the boss looks, a beat behind.
      yaw += (bossYaw * 0.8 - yaw) * Math.min(1, dt * 2);
      root.rotation.y = yaw;
      neck.rotation.x = writing ? 0.4 : 0;
      if (writing) aim(right, root, -0.02 + Math.sin(t * 9) * 0.06, b.shoulder - 0.3 + Math.sin(t * 17) * 0.02, 0.35, true);
      else aim(right, root, -0.24, b.shoulder - 0.64, 0.02);
      aim(left, root, 0.12, b.shoulder - 0.4, 0.3, true);
    },
  };
}

interface Worker {
  root: THREE.Group;
  cheer(): void;
  update(dt: number, t: number): void;
}

/** Lenny, Carl, or a worker in a radiation suit; arms up when someone scores. */
function buildWorker(who: 'lenny' | 'carl' | 'suit'): Worker {
  const suit = who === 'suit';
  const skin = std(who === 'carl' ? 0x6b4428 : SKIN, { roughness: 0.6 });
  const white = std(suit ? 0xe9e6d2 : 0xf3f3ee, { roughness: 0.8 });
  const pants = suit ? white : std(who === 'carl' ? 0x3a3f4a : 0x4a4e57);
  const b = body({ hip: 0.84, torso: 0.66, width: 0.42, legR: 0.08, pants, shirt: white, shoes: std(suit ? 0xc9c4ad : 0x1e1a16) });
  const root = b.root;
  const neck = new THREE.Group();
  neck.position.set(0, b.neck, 0);
  if (suit) {
    // Hood and a dark visor.
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), white);
    hood.scale.set(1, 1.15, 1);
    hood.position.y = 0.17;
    neck.add(hood);
    const visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 10, -0.9, 1.8, 0.9, 0.9),
      std(0x1d2a30, { roughness: 0.1, metalness: 0.6 }),
    );
    visor.position.y = 0.17;
    visor.scale.set(1.04, 1.16, 1.04);
    neck.add(visor);
    // A radiation badge.
    root.add(box(0.1, 0.1, 0.02, std(0xe8b417), 0.1, b.shoulder - 0.12, 0.17));
  } else {
    neck.add(head(skin, 0.15, { overbite: true }));
    const hair = std(0x1a1715);
    if (who === 'lenny') {
      // Short black hair in spikes.
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, 1.15), hair);
      cap.scale.set(0.97, 1.2, 1.02);
      cap.position.y = 0.168;
      cap.rotation.x = -0.25;
      neck.add(cap);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 5), hair);
        sp.position.set(Math.cos(a) * 0.1, 0.36, Math.sin(a) * 0.1 - 0.02);
        sp.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
        neck.add(sp);
      }
    } else {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, 1.0), hair);
      cap.scale.set(0.97, 1.2, 1.02);
      cap.position.y = 0.168;
      cap.rotation.x = -0.35;
      neck.add(cap);
    }
    // Short sleeves, a pocket and a pen.
    root.add(box(0.09, 0.09, 0.02, std(0xe0e0da), 0.1, b.shoulder - 0.12, 0.165));
    root.add(box(0.015, 0.08, 0.015, std(0x2d5bd1), 0.12, b.shoulder - 0.08, 0.175));
  }
  root.add(neck);
  const sleeve = suit ? white : skin;
  const right = arm(0.6, 0.06, sleeve, suit ? std(0xd8c46a) : skin, -0.25, b.shoulder);
  const left = arm(0.6, 0.06, sleeve, suit ? std(0xd8c46a) : skin, 0.25, b.shoulder);
  if (!suit) {
    // The short sleeves themselves.
    for (const a of [right, left]) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.2, 10), white);
      s.rotation.x = Math.PI / 2;
      s.position.z = 0.08;
      a.pivot.add(s);
    }
  }
  root.add(right.pivot, left.pivot);
  let joy = 0;
  const phase = Math.random() * 6;
  return {
    root,
    cheer() {
      joy = 2.2 + Math.random() * 0.4;
    },
    update(dt, t) {
      joy = Math.max(0, joy - dt);
      if (joy > 0) {
        const pump = Math.sin(t * 12 + phase) * 0.08;
        aim(right, root, -0.3, b.shoulder + 0.6 + pump, 0.05);
        aim(left, root, 0.3, b.shoulder + 0.6 - pump, 0.05);
        root.position.y = Math.abs(Math.sin(t * 10 + phase)) * 0.12 * Math.min(1, joy);
      } else {
        // Arms folded-ish, idling.
        const sway = Math.sin(t * 1.3 + phase) * 0.02;
        aim(right, root, -0.3, b.shoulder - 0.6, 0.06 + sway);
        aim(left, root, 0.3, b.shoulder - 0.6, 0.06 - sway);
        root.position.y = 0;
      }
    },
  };
}

/** Burns' speech bubble: a sprite that pops up with a line and fades. */
function speechBubble(): { sprite: THREE.Sprite; say(line: string): void; update(dt: number, talk: number): void } {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 200;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: false }));
  sprite.renderOrder = 10;
  // Anchored at the tail's tip, by his mouth.
  sprite.center.set(10 / 640, 1 - 6 / 200);
  sprite.visible = false;
  // The same size on screen however far the camera is.
  const W = 0.28;
  return {
    sprite,
    say(line) {
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 640, 200);
      ctx.font = 'bold 54px "Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
      // The body down and to the right, the tail up to his mouth at the top-left corner.
      const w = Math.min(600, ctx.measureText(line).width + 70);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.roundRect(34, 56, w, 134, 60);
      ctx.moveTo(70, 62);
      ctx.lineTo(10, 6);
      ctx.lineTo(118, 60);
      ctx.fill();
      ctx.stroke();
      // Cover the outline where the tail joins.
      ctx.beginPath();
      ctx.moveTo(74, 66);
      ctx.lineTo(112, 64);
      ctx.lineTo(80, 50);
      ctx.fill();
      ctx.fillStyle = '#111111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(line, 34 + w / 2, 125, w - 50);
      tex.needsUpdate = true;
      sprite.visible = true;
    },
    update(_dt, talk) {
      if (talk <= 0) {
        sprite.visible = false;
        return;
      }
      // Pops in, fades out over the last half second.
      const pop = Math.min(1, (2.8 - talk) * 8);
      const s = W * (0.6 + 0.4 * pop);
      sprite.scale.set(s, (s * 200) / 640, 1);
      sprite.material.opacity = Math.min(1, talk * 2);
    },
  };
}
