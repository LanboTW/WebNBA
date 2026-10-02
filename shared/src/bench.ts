import { DT } from './constants';
import { fouledOut } from './fouls';
import { humanCoach } from './rules';
import { baseRunSpeed } from './players';
import type { BenchPlayer, GameState, PlayerInfo, PlayerState, Position } from './types';

/** Energy below which a player asks out, and the minimum to come back in. */
export const TIRED = 0.68;
export const RESTED = 0.85;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Fatigue is tuned for 12-minute quarters; shorter games tire players proportionally faster. */
function timeScale(state: GameState): number {
  return Math.min(8, Math.max(1, 720 / state.settings.quarterSeconds));
}

function fatigueOn(state: GameState): boolean {
  return state.settings.rules.fatigue && state.settings.mode === 'game';
}

export function updateEnergy(state: GameState): void {
  if (!fatigueOn(state) || state.phase === 'final') return;
  const k = timeScale(state) * DT;
  const live = state.phase === 'live';
  for (const p of state.players) {
    if (live) {
      const effort = Math.min(1.4, Math.hypot(p.vel.x, p.vel.z) / baseRunSpeed(p));
      const drain =
        (0.0003 + effort * 0.00035 + (effort > 1.05 ? 0.0004 : 0) + (p.intenseD ? 0.0008 : 0)) *
        (1.45 - p.info.ratings.stamina * 0.009);
      p.energy = Math.max(0.05, p.energy - drain * k);
    } else {
      p.energy = Math.min(1, p.energy + 0.00015 * k);
    }
  }
  if (!live) return;
  for (const team of state.bench) for (const b of team) b.energy = Math.min(1, b.energy + 0.0016 * k);
}

/** Rough overall rating used to pick substitutes. */
export function overall(info: PlayerInfo): number {
  const r = info.ratings;
  return (r.speed + r.close + r.mid + r.three + r.handle + r.pass + r.defense + r.rebound + r.block + r.steal) / 10;
}

function positionFit(info: PlayerInfo, slot: number): number {
  const d = Math.abs(POSITIONS.indexOf(info.position) - slot);
  return d === 0 ? 6 : d === 1 ? 3 : 0;
}

/** Queue a manual substitution for the next dead ball. Returns false if it isn't allowed. */
export function requestSub(state: GameState, team: 0 | 1, slotId: number, rosterIdx: number): boolean {
  const p = state.players[slotId];
  const b = state.bench[team].find((x) => x.rosterIdx === rosterIdx);
  if (!p || p.team !== team || !b || (state.settings.rules.fouls && fouledOut(b))) return false;
  state.subQueue = state.subQueue.filter((q) => !(q.team === team && (q.slotId === slotId || q.rosterIdx === rosterIdx)));
  state.subQueue.push({ team, slotId, rosterIdx });
  return true;
}

export function cancelSub(state: GameState, team: 0 | 1, slotId: number): void {
  state.subQueue = state.subQueue.filter((q) => !(q.team === team && q.slotId === slotId));
}

function swap(state: GameState, p: PlayerState, benchIdx: number): void {
  const bench = state.bench[p.team];
  const b = bench[benchIdx];
  const out: BenchPlayer = { rosterIdx: p.rosterIdx, info: p.info, stats: p.stats, energy: p.energy };
  p.rosterIdx = b.rosterIdx;
  p.info = b.info;
  p.stats = b.stats;
  p.energy = b.energy;
  p.paintTime = 0;
  p.intenseD = false;
  p.dribbleDead = false;
  p.ai.mode = 'none';
  p.ai.arrived = false;
  bench[benchIdx] = out;
  state.events.push({ type: 'sub', team: p.team, slotId: p.id, inName: p.info.name, outName: out.info.name });
}

/**
 * Dead-ball substitutions: queued manual subs first, then fouled-out players,
 * then tired players. AI coaches also bring rested starters back.
 * `keep` lists court slots that must stay (e.g. the free-throw shooter).
 */
export function applySubs(state: GameState, keep: number[] = []): void {
  if (state.settings.mode !== 'game') return;
  const fouls = state.settings.rules.fouls;
  const eligible = (b: BenchPlayer) => !(fouls && fouledOut(b));
  const moved = new Set<number>();

  const queue = state.subQueue;
  state.subQueue = [];
  for (const q of queue) {
    if (keep.includes(q.slotId)) {
      state.subQueue.push(q);
      continue;
    }
    const idx = state.bench[q.team].findIndex((b) => b.rosterIdx === q.rosterIdx);
    const p = state.players[q.slotId];
    if (idx < 0 || !p || p.team !== q.team || !eligible(state.bench[q.team][idx])) continue;
    swap(state, p, idx);
    moved.add(p.id);
  }

  for (const p of state.players) {
    if (keep.includes(p.id) || moved.has(p.id)) continue;
    const bench = state.bench[p.team];
    const mustLeave = fouls && fouledOut(p);
    const tired = fatigueOn(state) && p.energy < TIRED;
    const ai = !humanCoach(state, p.team);
    let bestIdx = -1;
    let bestScore = -Infinity;
    bench.forEach((b, i) => {
      if (!eligible(b) || (!mustLeave && b.energy < RESTED)) return;
      const score = overall(b.info) + positionFit(b.info, p.slot) + b.energy * 10;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    });
    if (bestIdx < 0) continue;
    const current = overall(p.info) + positionFit(p.info, p.slot) + p.energy * 10;
    // Rested regulars come back for clearly weaker or fading replacements (AI coaches only).
    const upgrade = ai && fatigueOn(state) && p.energy < 0.9 && bestScore > current + 6;
    if (mustLeave || tired || upgrade) {
      swap(state, p, bestIdx);
      moved.add(p.id);
    }
  }
}
