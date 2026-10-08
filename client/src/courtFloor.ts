import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { COURT, HOOP_X, THREE_CORNER_DX, mapColor, type MapDef, type MapFloor, type TeamInfo } from '@webnba/shared';
import { loadLogo, loadPicture } from './logos';

const PX_PER_M = 64;
/** Apron drawn into the texture past the boundary, so the edge line shows whole. */
const MARGIN = 0.6;

/** Each material's own colour (a map's `court` paints over it). */
export const FLOOR_COLOR: Record<MapFloor, string> = {
  maple: '#d6a268',
  darkwood: '#8b5a36',
  asphalt: '#3d3f43',
  concrete: '#9c9a94',
  sport: '#2f6b8a',
};
const ROUGHNESS: Record<MapFloor, number> = { maple: 0.4, darkwood: 0.45, asphalt: 0.88, concrete: 0.8, sport: 0.6 };
const WOOD = new Set<MapFloor>(['maple', 'darkwood']);

export interface Floor {
  mesh: THREE.Object3D;
  /** High quality on a wooden floor: a mirror under a slightly see-through court. */
  setReflection(on: boolean, r: THREE.WebGLRenderer): void;
}

/**
 * The court surface: material, colours and lines for the whole court or the
 * +x half (street games). The apron around it is the caller's.
 */
export function buildFloor(map: MapDef, home: TeamInfo, half: boolean): Floor {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const x0 = (half ? 0 : -L) - MARGIN;
  const x1 = L + MARGIN;
  const w = x1 - x0;
  const h = (W + MARGIN) * 2;
  const canvas = drawFloor(map, home, half, x0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const wood = WOOD.has(map.floor);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: ROUGHNESS[map.floor], metalness: wood ? 0.05 : 0 });
  const court = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  // Drawn first among see-through things so floor markers still show on top.
  court.renderOrder = -1;
  const group = new THREE.Group();
  group.position.x = x0 + w / 2;
  group.add(court);

  // The centre circle shows the abbreviation until the picture arrives (or for good if there is none).
  if (!half) {
    (map.logo ? loadPicture(`${import.meta.env.BASE_URL}${map.logo}`) : loadLogo(home)).then((img) => {
      if (!img) return;
      const ctx = canvas.getContext('2d')!;
      const r = (COURT.centerCircleRadius - 0.03) * PX_PER_M;
      const cx = (0 - x0) * PX_PER_M;
      const cy = canvas.height / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = mapColor(map.paint, home);
      ctx.fill();
      const size = r * 1.55;
      const s = Math.min(size / img.width, size / img.height);
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
      tex.needsUpdate = true;
    });
  }

  let mirror: Reflector | null = null;
  return {
    mesh: group,
    setReflection(on, r) {
      on &&= wood;
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
      mat.transparent = on;
      mat.opacity = on ? 0.82 : 1;
      mat.needsUpdate = true;
    },
  };
}

function drawFloor(map: MapDef, home: TeamInfo, half: boolean, x0: number, w: number, h: number): HTMLCanvasElement {
  const L = COURT.halfLength;
  const W = COURT.halfWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX_PER_M);
  canvas.height = Math.round(h * PX_PER_M);
  const ctx = canvas.getContext('2d')!;
  const u = (x: number) => (x - x0) * PX_PER_M;
  const v = (z: number) => (z + W + MARGIN) * PX_PER_M;
  const color = (c: string) => mapColor(c, home);
  const courtX0 = half ? 0 : -L;
  const sides: (1 | -1)[] = half ? [1] : [1, -1];
  const paint = color(map.paint);

  ctx.fillStyle = color(map.apron);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = map.court ? color(map.court) : FLOOR_COLOR[map.floor];
  ctx.fillRect(u(courtX0), v(-W), u(L) - u(courtX0), v(W) - v(-W));

  const kw = COURT.keyWidth / 2;
  const alpha = Math.asin(COURT.threeCornerZ / COURT.threeRadius);
  /** The three-point line of one end, baseline corner to baseline corner. */
  const threePath = (s: 1 | -1) => {
    const base = s * L;
    const hoop = s * HOOP_X;
    const cornerX = hoop - s * THREE_CORNER_DX;
    const pts: [number, number][] = [[base, -COURT.threeCornerZ], [cornerX, -COURT.threeCornerZ]];
    for (let i = 0; i <= 64; i++) {
      const a = -alpha + (2 * alpha * i) / 64;
      pts.push([hoop - s * Math.cos(a) * COURT.threeRadius, Math.sin(a) * COURT.threeRadius]);
    }
    pts.push([base, COURT.threeCornerZ]);
    return pts;
  };
  const path = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, z], i) => (i ? ctx.lineTo(u(x), v(z)) : ctx.moveTo(u(x), v(z))));
  };

  // Colours first, then the material's grain over all of them, then the lines.
  for (const s of sides) {
    if (map.arc) {
      path(threePath(s));
      ctx.closePath();
      ctx.fillStyle = color(map.arc);
      ctx.fill();
    }
    const base = s * L;
    const ft = s * (L - COURT.freeThrowFromBaseline);
    ctx.fillStyle = paint;
    ctx.fillRect(Math.min(u(base), u(ft)), v(-kw), Math.abs(u(base) - u(ft)), v(kw) - v(-kw));
  }
  if (!half) {
    ctx.beginPath();
    ctx.arc(u(0), v(0), COURT.centerCircleRadius * PX_PER_M, 0, Math.PI * 2);
    ctx.fillStyle = paint;
    ctx.fill();
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(u(courtX0), v(-W), u(L) - u(courtX0), v(W) - v(-W));
  ctx.clip();
  grain(ctx, map.floor, canvas.width, canvas.height);
  ctx.restore();

  ctx.lineWidth = 0.05 * PX_PER_M;
  ctx.strokeStyle = color(map.lines);
  const poly = (pts: [number, number][], close = false) => {
    path(pts);
    if (close) ctx.closePath();
    ctx.stroke();
  };
  const circle = (x: number, r: number, from = 0, to = Math.PI * 2) => {
    ctx.beginPath();
    ctx.arc(u(x), v(0), r * PX_PER_M, from, to);
    ctx.stroke();
  };
  for (const s of sides) {
    const base = s * L;
    const ft = s * (L - COURT.freeThrowFromBaseline);
    const hoop = s * HOOP_X;
    poly([[base, -kw], [ft, -kw], [ft, kw], [base, kw]]);
    circle(ft, COURT.centerCircleRadius);
    poly(threePath(s));
    const ra: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 32;
      ra.push([hoop - s * Math.cos(a) * COURT.restrictedRadius, Math.sin(a) * COURT.restrictedRadius]);
    }
    poly(ra);
  }
  if (half) circle(0, COURT.centerCircleRadius, -Math.PI / 2, Math.PI / 2);
  else {
    circle(0, COURT.centerCircleRadius);
    poly([[0, -W], [0, W]]);
    ctx.fillStyle = home.secondary;
    ctx.font = `bold ${0.9 * PX_PER_M}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(home.abbr, u(0), v(0));
  }
  ctx.lineWidth = 0.1 * PX_PER_M;
  poly([[courtX0, -W], [L, -W], [L, W], [courtX0, W]], true);
  return canvas;
}

/** The material's texture, drawn see-through over whatever colours are under it. */
function grain(ctx: CanvasRenderingContext2D, floor: MapFloor, width: number, height: number): void {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const speckle = (count: number, strength: number) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},${strength * (0.4 + rand())})`;
      const s = 1 + rand() * 3;
      ctx.fillRect(rand() * width, rand() * height, s, s);
    }
  };
  const area = width * height;
  if (WOOD.has(floor)) {
    // Planks running the length of the court.
    const plank = 0.12 * PX_PER_M;
    const dark = floor === 'darkwood';
    for (let y = 0; y < height; y += plank) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '90,50,20' : '255,235,200'},${(dark ? 0.06 : 0.04) + rand() * 0.06})`;
      ctx.fillRect(0, y, width, plank);
      ctx.fillStyle = `rgba(${dark ? '40,20,5,0.25' : '80,45,15,0.12'})`;
      ctx.fillRect(0, y, width, 1);
    }
    // Plank ends, staggered.
    ctx.fillStyle = 'rgba(70,40,15,0.12)';
    for (let y = 0; y < height; y += plank) for (let x = rand() * 2 * PX_PER_M; x < width; x += (1.8 + rand() * 1.4) * PX_PER_M) ctx.fillRect(x, y, 1, plank);
  } else if (floor === 'asphalt') speckle(area * 0.012, 0.05);
  else if (floor === 'concrete') {
    speckle(area * 0.008, 0.04);
    // Slab joints every 4 m.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < width; x += 4 * PX_PER_M) ctx.fillRect(x, 0, 2, height);
    for (let y = 0; y < height; y += 4 * PX_PER_M) ctx.fillRect(0, y, width, 2);
  } else {
    // Snap-together tiles about a third of a metre across.
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    const tile = (1 / 3) * PX_PER_M;
    for (let x = 0; x < width; x += tile) ctx.fillRect(x, 0, 1, height);
    for (let y = 0; y < height; y += tile) ctx.fillRect(0, y, width, 1);
    speckle(area * 0.002, 0.03);
  }
}
