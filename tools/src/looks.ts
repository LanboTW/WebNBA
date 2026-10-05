/**
 * Player looks: what the models wear and look like. Skin, hair and beard come
 * from the ESPN headshot (a transparent PNG of head and shoulders); the
 * accessories are rolled once from the name. Everything is written into the
 * JSON so it can be corrected by hand afterwards.
 */
import { PNG } from 'pngjs';
import { SHOE, SLEEVE, SOCKS } from '../../shared/src/teamFile';
import type { Look } from '../../shared/src/types';

export type { Look };

export { BEARD, HAIR, SHOE, SLEEVE, SOCKS, lookErrors } from '../../shared/src/teamFile';

/** CIE L* of the cheeks below which each skin level starts, from level 2 up to 6 (checked against ~50 photos). */
const SKIN_STEPS = [72, 64, 58, 51, 43];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Accessories rolled from the name, so a re-run gives the same result. */
export function rollAccessories(name: string): Pick<Look, 'headband' | 'sleeve' | 'kneepad' | 'shoe' | 'socks'> {
  let seed = hash(name) || 1;
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0), (seed % 10000) / 10000);
  const pick = <T>(options: readonly T[], weights: number[]): T => {
    let r = rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < options.length; i++) if ((r -= weights[i]) < 0) return options[i];
    return options[0];
  };
  return {
    headband: rand() < 0.15,
    sleeve: pick(SLEEVE, [60, 10, 15, 15]),
    kneepad: rand() < 0.15,
    shoe: pick(SHOE, [40, 30, 30]),
    socks: pick(SOCKS, [60, 40]),
  };
}

export function defaultLook(name: string): Look {
  return { skin: 3, hair: 'short', beard: 'none', ...rollAccessories(name) };
}

export type Analysis = Pick<Look, 'skin' | 'hair' | 'beard' | 'hairColor'>;

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
/** CIE L* (0-100) of an sRGB colour. */
const lightness = (r: number, g: number, b: number) => {
  const lin = (c: number) => ((c /= 255) > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
  const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * Reads skin tone, hair and beard from a headshot. The photo is a cut-out on a
 * transparent background, so the silhouette gives the head; colour samples
 * from the cheeks, the crown and the chin do the rest. Null if no head is found.
 */
export function analyzeHeadshot(png: { width: number; height: number; data: Uint8Array }): Analysis | null {
  const { width: W, height: H, data } = png;
  const at = (x: number, y: number) => (y * W + x) * 4;
  const solid = (x: number, y: number) => data[at(x, y) + 3] > 160;

  // Silhouette width per row, around the centre column.
  const left: number[] = [];
  const right: number[] = [];
  const cx0 = W >> 1;
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      if (Math.abs(x - cx0) > W * 0.3) continue;
      if (l < 0) l = x;
      r = x;
    }
    left.push(l);
    right.push(r);
  }
  const width = (y: number) => (left[y] < 0 ? 0 : right[y] - left[y] + 1);
  const top = left.findIndex((l, y) => l >= 0 && width(y) > W * 0.04);
  if (top < 0) return null;

  // Head width: widest row in the first stretch; the neck is the narrowest row below it.
  let headW = 0;
  for (let y = top; y < Math.min(H, top + H * 0.35); y++) headW = Math.max(headW, width(y));
  let neck = -1;
  let neckW = Infinity;
  for (let y = Math.round(top + headW * 0.9); y < Math.min(H, top + headW * 1.7); y++) {
    if (width(y) < neckW) {
      neckW = width(y);
      neck = y;
    }
    if (width(y) > headW * 1.6) break;
  }
  if (neck < 0 || headW < W * 0.12) return null;
  const headH = neck - top;
  const cx = Math.round((left[top + Math.round(headH * 0.5)] + right[top + Math.round(headH * 0.5)]) / 2);

  const sample = (x0: number, x1: number, y0: number, y1: number) => {
    const px: [number, number, number][] = [];
    for (let y = Math.round(y0); y <= Math.round(y1); y++)
      for (let x = Math.round(x0); x <= Math.round(x1); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !solid(x, y)) continue;
        const i = at(x, y);
        px.push([data[i], data[i + 1], data[i + 2]]);
      }
    return px;
  };

  // Skin: cheeks and nose.
  const cheeks = sample(cx - headW * 0.2, cx + headW * 0.2, top + headH * 0.5, top + headH * 0.66);
  if (cheeks.length < 20) return null;
  const skinRGB = [0, 1, 2].map((c) => median(cheeks.map((p) => p[c]))) as [number, number, number];
  const skinL = lum(...skinRGB);
  const cheekL = median(cheeks.map((p) => lightness(...p)));
  const skin = 1 + SKIN_STEPS.filter((s) => cheekL < s).length;
  const notSkin = (p: [number, number, number]) => {
    const d = Math.hypot(p[0] - skinRGB[0], p[1] - skinRGB[1], p[2] - skinRGB[2]);
    return d > 34 + skinL * 0.12 && lum(...p) < skinL - 6;
  };

  // Hair: how far down the crown stays non-skin, over a band of centre columns.
  const depths: number[] = [];
  const hairPx: [number, number, number][] = [];
  for (let x = Math.round(cx - headW * 0.15); x <= cx + headW * 0.15; x++) {
    // From this column's own top edge down to the first run of skin (a lone
    // shiny strand doesn't end the hair).
    let start = top;
    while (start < top + headH * 0.3 && !solid(x, start)) start++;
    let y = start;
    let skinRun = 0;
    while (y < start + headH * 0.5 && skinRun < 3) {
      if (notSkin(px(x, y))) {
        skinRun = 0;
        hairPx.push(px(x, y));
      } else skinRun++;
      y++;
    }
    depths.push(y - skinRun - start);
  }
  function px(x: number, y: number): [number, number, number] {
    const i = at(x, y);
    return [data[i], data[i + 1], data[i + 2]];
  }
  const depth = median(depths) / headH;
  // Hair hanging beside the face, below the ears: locs or long hair.
  let side = 0;
  let sideArea = 0;
  for (let y = Math.round(top + headH * 0.5); y < top + headH * 0.95; y++)
    for (const sign of [-1, 1])
      for (let d = headW * 0.42; d < headW * 0.75; d++) {
        const x = Math.round(cx + sign * d);
        if (x < 0 || x >= W) continue;
        sideArea++;
        if (solid(x, y) && notSkin(px(x, y))) side++;
      }
  const sideShare = side / Math.max(1, sideArea);
  let hair: Look['hair'];
  if (sideShare > 0.26) hair = 'long';
  else if (sideShare > 0.135) hair = 'dreads';
  else if (depth < 0.035) hair = 'bald';
  else if (depth < 0.1) hair = 'buzz';
  // Only a very deep crown counts as big hair; anything unsure stays 'short'.
  else if (depth > 0.34) hair = 'afro';
  else hair = 'short';

  // Beard: share of darker-than-skin pixels around the chin and jaw.
  const chin = sample(cx - headW * 0.22, cx + headW * 0.22, top + headH * 0.8, top + headH * 0.94);
  const share = chin.filter(notSkin).length / Math.max(1, chin.length);
  const beard: Look['beard'] = share > 0.35 ? 'full' : share > 0.2 ? 'stubble' : 'none';

  const result: Analysis = { skin, hair, beard };
  if (hair !== 'bald' && hairPx.length > 20) {
    const c = [0, 1, 2].map((i) => median(hairPx.map((p) => p[i])));
    // Only notably light hair (blond, dyed) is worth recording; dark is the default.
    if (lum(c[0], c[1], c[2]) > 95) result.hairColor = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  return result;
}

export function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}
