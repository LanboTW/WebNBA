import type { Ratings, ShotQuality } from './types';

/** Meter value at the ideal release point (top of the jump). */
export const SHOT_SWEET = 0.85;
export const PERFECT_WINDOW = 0.04;
export const GOOD_WINDOW = 0.1;
/** Seconds for the meter to go from 0 to 1. */
export const JUMPER_METER_TIME = 0.6;
export const LAYUP_METER_TIME = 0.45;
export const DUNK_METER_TIME = 0.5;
export const FREE_METER_TIME = 0.6;
/** The meter auto-releases here (very late). */
export const METER_MAX = 1.15;
export const LAYUP_DISTANCE = 1.8;
/** Within this distance a player who can reach the rim may dunk. */
export const DUNK_DISTANCE = 2.6;

export function gradeTiming(meter: number): { quality: ShotQuality; factor: number } {
  const diff = meter - SHOT_SWEET;
  const abs = Math.abs(diff);
  if (abs <= PERFECT_WINDOW) return { quality: 'perfect', factor: 1 };
  if (abs <= GOOD_WINDOW) return { quality: 'good', factor: 1 };
  const factor = Math.max(0.3, 1 - (abs - GOOD_WINDOW) * 3);
  return { quality: diff < 0 ? 'early' : 'late', factor };
}

/** Make chance for an uncontested, well-timed shot. */
export function baseMakeChance(r: Ratings, dist: number, three: boolean, layup: boolean): number {
  if (layup) return 0.55 + r.close * 0.004;
  if (three) return 0.1 + r.three * 0.0035 - Math.max(0, dist - 7.6) * 0.06;
  if (dist < 3) return 0.45 + r.close * 0.0035;
  return 0.3 + r.mid * 0.0035 - (dist - 3) * 0.015;
}

/** contest: 0 = wide open, 1 = smothered. */
export function contestMultiplier(contest: number): number {
  return 1 - 0.5 * Math.min(1, Math.max(0, contest));
}

export function makeChance(
  r: Ratings,
  dist: number,
  three: boolean,
  layup: boolean,
  meter: number,
  contest = 0,
): number {
  const base = baseMakeChance(r, dist, three, layup);
  const { quality, factor } = gradeTiming(meter);
  const timed = quality === 'perfect' ? base + 0.3 : base * factor;
  return Math.min(0.97, Math.max(0.02, timed * contestMultiplier(contest)));
}

/** Dunks barely care about timing and shrug off most of a contest. */
export function dunkChance(r: Ratings, meter: number, contest = 0): number {
  const base = 0.9 + r.close * 0.0007;
  const { quality, factor } = gradeTiming(meter);
  const timed = quality === 'perfect' || quality === 'good' ? base : base * (0.75 + 0.25 * factor);
  return Math.min(0.99, Math.max(0.3, timed * (1 - 0.25 * Math.min(1, Math.max(0, contest)))));
}

export function freeThrowChance(r: Ratings, meter: number): number {
  const base = 0.3 + r.ft * 0.0062;
  const { quality, factor } = gradeTiming(meter);
  const timed = quality === 'perfect' ? base + 0.08 : base * factor;
  return Math.min(0.98, Math.max(0.05, timed));
}
