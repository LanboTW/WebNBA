import { COURT, DT, attackHoop } from './constants';
import { hdist, isInbounder, opponents, teammates } from './players';
import { nextRandom } from './rng';
import type { GameState, PlayKind, PlayState, PlayerState } from './types';

/**
 * Called plays (戰術): pick-and-roll, pick-and-pop, handoff, a screen away
 * from the ball for a shooter, and a post-up. Calling one gives teammates
 * roles (ai.ts runs them); this module starts, advances and ends plays.
 *
 * Cohesion (0-100, how well the five know each other) decides how fast the
 * screener gets there, how often the screen catches the defender, and how
 * often the pass to the play's target comes late or off target.
 */

export const PLAY_KINDS: PlayKind[] = ['pnr', 'pnp', 'handoff', 'offscreen', 'post'];
export const PLAY_NAME: Record<PlayKind, string> = {
  pnr: '擋拆切入',
  pnp: '擋拆外彈',
  handoff: '手遞手',
  offscreen: '無球掩護',
  post: '低位單打',
};
/** Seconds a play has to happen before it is dropped. */
export const PLAY_TIME = 8;
/** How long a caught defender is stuck. */
export const STUCK_TIME = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const cohesionOf = (state: GameState, team: 0 | 1): number => clamp(state.settings.cohesion?.[team] ?? 70, 0, 100);
/** Chance a set screen catches the defender: 35% at cohesion 30, 75% at 100. */
export const screenCatch = (c: number): number => clamp(0.35 + ((c - 30) * 0.4) / 70, 0.2, 0.8);
/** Seconds the screener waits before going (none for a team that knows each other). */
export const setupWait = (c: number): number => (1 - c / 100) * 0.8;
/** Chance the pass to the play's man comes off target (and, a little more often, late). */
export const passOffChance = (c: number): number => (1 - c / 100) * 0.25;

export const activePlay = (state: GameState, team: 0 | 1): PlayState | null => state.plays?.[team] ?? null;

/** The play that `p` has a part in (and the part), if any. */
export function roleIn(state: GameState, p: PlayerState): PlayState | null {
  const play = activePlay(state, p.team);
  return play && (play.handlerId === p.id || play.screenerId === p.id || play.targetId === p.id) ? play : null;
}

function rate(p: PlayerState, k: keyof PlayerState['info']['ratings']): number {
  return p.info.ratings[k];
}

/** The best of `list` by `score` (null when empty). */
function best(list: PlayerState[], score: (p: PlayerState) => number): PlayerState | null {
  let out: PlayerState | null = null;
  for (const p of list) if (!out || score(p) > score(out)) out = p;
  return out;
}

/**
 * Starts a play for `team`. `caller` is the person's player when a person
 * called it: off the ball, the play is run for them (they get the handoff,
 * come off the screen, post up); pick plays need the ball. Returns whether
 * it could start.
 */
export function startPlay(state: GameState, team: 0 | 1, kind: PlayKind, caller: PlayerState | null = null): boolean {
  const b = state.ball;
  if (state.phase !== 'live' || b.mode !== 'held') return false;
  const holder = state.players[b.holderId];
  if (!holder || holder.team !== team || isInbounder(state, holder)) return false;
  if (state.settings.street && !state.frontcourt) return false;
  const forMe = caller && caller !== holder ? caller : null;
  const mates = teammates(state, holder);
  if (!mates.length) return false;
  const bigFirst = (p: PlayerState) => p.slot * 10 - hdist(p.pos, holder.pos);
  let screener: PlayerState | null = null;
  let target: PlayerState | null = null;

  switch (kind) {
    case 'pnr':
    case 'pnp': {
      if (forMe) return false;
      const pool = mates.filter((m) => hdist(m.pos, holder.pos) < 14);
      screener = kind === 'pnp' ? best(pool, (m) => rate(m, 'three') + m.slot * 2) : best(pool, bigFirst);
      target = screener;
      break;
    }
    case 'handoff':
      target = forMe ?? best(mates, (m) => rate(m, 'speed') + rate(m, 'handle') - Math.max(0, hdist(m.pos, holder.pos) - 8) * 3);
      break;
    case 'offscreen': {
      target = forMe ?? best(mates, (m) => rate(m, 'three'));
      const shooter = target;
      screener = best(
        mates.filter((m) => m !== shooter),
        (m) => m.slot * 6 - hdist(m.pos, shooter!.pos) * 2,
      );
      if (!screener) return false;
      break;
    }
    case 'post':
      target = forMe ?? best(mates, (m) => rate(m, 'close') + rate(m, 'rebound') * 0.3 + m.info.heightM * 20);
      break;
  }
  if (!target) return false;
  const c = cohesionOf(state, team);
  // Anyone already in another play's part lets it go.
  endPlay(state, team);
  const play: PlayState = {
    kind,
    handlerId: holder.id,
    screenerId: screener?.id ?? -1,
    targetId: target.id,
    stage: 0,
    timer: PLAY_TIME,
    wait: setupWait(c),
    late: false,
  };
  state.plays[team] = play;
  if (screener) {
    screener.ai.mode = 'screen';
    screener.ai.modeTimer = 3.5 + play.wait;
    screener.ai.arrived = false;
    const victim = kind === 'offscreen' ? target : holder;
    screener.ai.screenSide = Math.sign(screener.pos.z - victim.pos.z) || 1;
  }
  if (kind === 'handoff') {
    target.ai.mode = 'handoff';
    target.ai.modeTimer = PLAY_TIME;
  } else if (kind === 'offscreen') {
    target.ai.mode = 'curl';
    target.ai.modeTimer = PLAY_TIME;
    // Come off the screen toward the other wing.
    target.ai.screenSide = -(Math.sign(target.pos.z) || 1);
  } else if (kind === 'post') {
    target.ai.mode = 'post';
    target.ai.modeTimer = PLAY_TIME;
    target.ai.arrived = false;
    target.ai.screenSide = Math.sign(holder.pos.z) || 1;
  }
  return true;
}

/** Ends a team's play; those still waiting on it go back to their spots. */
export function endPlay(state: GameState, team: 0 | 1): void {
  const play = activePlay(state, team);
  if (!play) return;
  state.plays[team] = null;
  for (const id of [play.screenerId, play.targetId]) {
    const p = state.players[id];
    if (!p) continue;
    if (p.ai.mode === 'handoff' || p.ai.mode === 'curl' || (p.ai.mode === 'post' && !(state.ball.mode === 'held' && state.ball.holderId === p.id))) {
      p.ai.mode = 'none';
    }
    if (p.ai.mode === 'screen' && play.stage === 0) p.ai.mode = 'none';
    p.ai.arrived = false;
  }
}

/**
 * The screen is set beside `victim`: he may be caught (stuck for a moment).
 * Rolled once per screen; returns whether he was.
 */
export function screenCaught(state: GameState, screener: PlayerState, victim: PlayerState | undefined): boolean {
  if (!victim) return false;
  const caught = hdist(victim.pos, screener.pos) < 1.4 && nextRandom(state) < screenCatch(cohesionOf(state, screener.team));
  // A person defending keeps their own feet (the screener's body still gets in the way).
  if (caught && state.controlled[victim.team] !== victim.id) victim.ai.stuck = STUCK_TIME;
  state.events.push({ type: 'screen', team: screener.team, screenerId: screener.id, caught });
  return caught;
}

/** The defender guarding `p`. */
export const defenderOf = (state: GameState, p: PlayerState): PlayerState | undefined => state.players.find((o) => state.assign[o.id] === p.id);

/** Each tick: plays run down, end when the ball changes hands, and see their man get the ball. */
export function updatePlays(state: GameState): void {
  for (const team of [0, 1] as const) {
    const play = activePlay(state, team);
    if (!play) continue;
    const b = state.ball;
    const holder = b.mode === 'held' ? state.players[b.holderId] : null;
    const ours = (holder && holder.team === team) || (b.mode === 'pass' && b.pass?.team === team && !b.pass.intercepted);
    play.timer -= DT;
    if (state.phase !== 'live' || !ours || play.timer <= 0) {
      endPlay(state, team);
      continue;
    }
    if (holder && holder.id === play.targetId && play.stage < 2 && play.kind !== 'pnr' && play.kind !== 'pnp') {
      play.stage = 2;
      play.timer = Math.min(play.timer, play.kind === 'post' ? 3 : 1.2);
      if (play.kind === 'handoff') {
        // The handler's body is the screen: the receiver's man may get hung up on it.
        const passer = state.players[play.handlerId];
        screenCaught(state, passer, defenderOf(state, holder));
        if (state.controlled[team] !== holder.id) {
          holder.ai.mode = 'drive';
          holder.ai.modeTimer = 1.4;
          holder.ai.screenSide = Math.sign(holder.pos.z) || 1;
        } else holder.ai.mode = 'none';
      } else if (play.kind === 'post') {
        holder.ai.mode = 'post';
        holder.ai.modeTimer = 2.8;
      } else holder.ai.mode = 'none';
    }
  }
}

/** Where the post man seals: the low block on the ball's side. */
export function postSpot(state: GameState, p: PlayerState): { x: number; z: number } {
  const hx = attackHoop(state, p.team);
  return { x: hx - Math.sign(hx) * 1.9, z: p.ai.screenSide * (COURT.keyWidth / 2 + 0.25) };
}

/** Where a shooter comes off a screen: the wing beyond the arc on `side`. */
export function curlSpot(state: GameState, p: PlayerState): { x: number; z: number } {
  const hx = attackHoop(state, p.team);
  return { x: hx - Math.sign(hx) * 5.4, z: p.ai.screenSide * 5.6 };
}

/** Where a pick-and-pop screener pops to: beyond the arc on his side. */
export function popSpot(state: GameState, p: PlayerState): { x: number; z: number } {
  const hx = attackHoop(state, p.team);
  return { x: hx - Math.sign(hx) * 6.7, z: p.ai.screenSide * 3.4 };
}

/** An AI ball handler's choice of play, from what his teammates do best. */
export function choosePlay(state: GameState, holder: PlayerState): PlayKind {
  const mates = teammates(state, holder);
  const top = (k: keyof PlayerState['info']['ratings']) => Math.max(0, ...mates.map((m) => m.info.ratings[k]));
  const bigs = mates.filter((m) => m.slot >= 3);
  const weights: [PlayKind, number][] = [
    ['pnr', 3],
    ['pnp', bigs.some((m) => m.info.ratings.three >= 74) ? 2 : 0.5],
    ['handoff', 1.5],
    ['offscreen', top('three') >= 78 ? 2 : 0.8],
    ['post', top('close') >= 78 ? 2 : 0.6],
  ];
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = nextRandom(state) * total;
  for (const [k, w] of weights) {
    r -= w;
    if (r <= 0) return k;
  }
  return 'pnr';
}

/** Whether `p` stands well guarded by two (a double team on the post). */
export function doubled(state: GameState, p: PlayerState): boolean {
  return opponents(state, p.team).filter((o) => hdist(o.pos, p.pos) < 1.6).length >= 2;
}
