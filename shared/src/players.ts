import {
  BALL_RADIUS,
  COURT,
  DEFENSE_SET_SPEED,
  DT,
  GRAVITY,
  HOOP,
  PLAYER_RADIUS,
  attackHoop,
  isThreePoint,
} from './constants';
import { chargeFoul, commonFoul, onFreeThrowRelease, shootingFoul } from './fouls';
import { activePlay, cohesionOf, passOffChance } from './plays';
import { nextRandom } from './rng';
import {
  DUNK_DISTANCE,
  DUNK_METER_TIME,
  FREE_METER_TIME,
  JUMPER_METER_TIME,
  LAYUP_DISTANCE,
  LAYUP_METER_TIME,
  METER_MAX,
  SHOT_SWEET,
  baseMakeChance,
  contestMultiplier,
  dunkChance,
  freeThrowChance,
  gradeTiming,
  makeChance,
} from './shot';
import type { GameState, PlayerInput, PlayerState, ShotKind, Vec3 } from './types';

const MOVE_RESPONSE = 10;
const PASS_SPEED_BASE = 11;
/** Shortest pass flight (s): even a hand-off takes a moment to travel. */
const MIN_PASS_FLIGHT = 0.24;
/** After catching a pass, how long before the ball can be passed on (s). */
export const CATCH_HOLD = 0.3;

export const hdist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * How well a defender can defend right now: 1 when set (standing or sliding at
 * a normal pace), down to 0.6 when running flat out (5.5 m/s and up).
 */
export function defenderSet(p: PlayerState): number {
  const run = Math.min(1, Math.max(0, (Math.hypot(p.vel.x, p.vel.z) - DEFENSE_SET_SPEED) / 2.5));
  return 1 - 0.4 * run;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function baseRunSpeed(p: PlayerState): number {
  return 4.2 + p.info.ratings.speed * 0.025;
}

/** 0..1: how rested a player is for performance purposes (full effect above 75% energy). */
export function freshness(p: PlayerState): number {
  return Math.min(1, p.energy / 0.75);
}

export function runSpeed(p: PlayerState): number {
  return baseRunSpeed(p) * (0.88 + 0.12 * freshness(p));
}

/** Vertical speed at take-off for a normal jump. */
export function jumpSpeed(p: PlayerState): number {
  return (3.0 + p.info.ratings.jump * 0.014) * (0.93 + 0.07 * freshness(p));
}

const DUNK_JUMP_BONUS = 0.25;

/** Highest point a player's hands reach on a dunk attempt. */
export function dunkReach(p: PlayerState): number {
  const vy = jumpSpeed(p) + DUNK_JUMP_BONUS;
  return p.info.heightM * 1.33 + (vy * vy) / (2 * GRAVITY);
}

export function canDunk(p: PlayerState): boolean {
  return dunkReach(p) >= HOOP.rimHeight + 0.45;
}

export function hasBall(state: GameState, p: PlayerState): boolean {
  return state.ball.mode === 'held' && state.ball.holderId === p.id;
}

export function isInbounder(state: GameState, p: PlayerState): boolean {
  return state.phase === 'inbound' && state.inbound?.passerId === p.id;
}

export function teammates(state: GameState, p: PlayerState): PlayerState[] {
  return state.players.filter((o) => o.team === p.team && o.id !== p.id);
}

/** Icon-pass order: teammates by lineup slot, so each keeps a stable number. */
export function passIcons(state: GameState, p: PlayerState): PlayerState[] {
  return teammates(state, p).sort((a, b) => a.slot - b.slot);
}

export function opponents(state: GameState, team: 0 | 1): PlayerState[] {
  return state.players.filter((o) => o.team !== team);
}

export function updatePlayer(state: GameState, p: PlayerState, inp: PlayerInput): void {
  const ball = state.ball;
  const mine = hasBall(state, p);
  const inbounder = isInbounder(state, p);
  const canPlay = state.phase === 'live' || state.settings.mode === 'practice';
  const shootPressed = inp.shoot && !p.lastShoot;
  const shootReleased = !inp.shoot && p.lastShoot;
  const jumpPressed = inp.jump && !p.lastJump;
  const passPressed = inp.pass && !p.lastPass;
  p.lastShoot = inp.shoot;
  p.lastJump = inp.jump;
  p.lastPass = inp.pass;
  p.pickupCooldown = Math.max(0, p.pickupCooldown - DT);
  p.stealCooldown = Math.max(0, p.stealCooldown - DT);
  p.contactCooldown = Math.max(0, p.contactCooldown - DT);
  p.catchHold = Math.max(0, p.catchHold - DT);
  // A pass pressed a moment early (ball still coming, or just caught) is kept, not lost.
  const incoming = ball.mode === 'pass' && ball.pass?.targetId === p.id && !ball.pass.intercepted;
  if (passPressed && (incoming || (mine && p.catchHold > 0))) p.queuedPass = inp.passTarget ?? -2;
  if ((!mine && !incoming) || shootPressed) p.queuedPass = -1;
  const passNow = passPressed || p.queuedPass !== -1;
  p.intenseD = inp.intenseD && !mine && canPlay;
  const ft = state.phase === 'freeThrow' ? state.freeThrow : null;
  const ftShooter = !!ft && ft.shooterId === p.id && mine && !ft.released && ft.timer > 0.5;
  // Free throws and inbounds are taken standing still.
  const planted = inbounder || state.phase === 'freeThrow';
  let hanging = false;

  if (p.action === 'shooting') {
    // Release uses the meter the player saw when letting go, before advancing it.
    if (shootReleased) {
      releaseShot(state, p);
    } else {
      p.shotTimer += DT;
      p.shotMeter = p.shotTimer / METER_TIME[p.shotKind];
      if (!p.shotJumped && p.shotMeter >= JUMP_AT[p.shotKind]) launchShotJump(state, p);
      if (p.shotMeter >= METER_MAX) releaseShot(state, p);
    }
  } else if (p.action === 'release') {
    p.shotTimer += DT;
    // Hang on the rim for a moment after a made dunk.
    const shot = ball.shot;
    hanging = p.shotKind === 'dunk' && p.shotTimer < 0.4 && p.pos.y > 0.25 && !!shot && shot.shooterId === p.id && shot.scored;
    if (p.onGround && p.shotTimer > 0.2) p.action = 'normal';
  } else if (ftShooter) {
    if (shootPressed) startShot(state, p, inp);
  } else if (mine && passNow && (canPlay || inbounder) && p.catchHold <= 0) {
    const chosen = passPressed ? inp.passTarget : p.queuedPass >= 0 ? p.queuedPass : undefined;
    p.queuedPass = -1;
    const explicit = chosen !== undefined ? state.players[chosen] : undefined;
    const valid = explicit && explicit.team === p.team && explicit.id !== p.id;
    const target = valid ? explicit.id : choosePassTarget(state, p, inp);
    if (target >= 0) releasePass(state, p, target);
  } else if (mine && shootPressed && p.onGround && canPlay && !inbounder) {
    startShot(state, p, inp);
  } else if (!mine && passPressed && canPlay) {
    if (!callForBall(state, p)) attemptSteal(state, p);
  } else if (jumpPressed && p.onGround && !planted) {
    p.vel.y = jumpSpeed(p);
    p.onGround = false;
    // Leaving the floor with the ball ends the dribble: no dribbling again once you land.
    if (mine) p.dribbleDead = true;
  }

  // A dead dribble may pivot, pass or shoot, but walking with it would be a travel.
  const pivotOnly = mine && p.dribbleDead;
  if (planted || hanging) {
    p.vel.x = 0;
    p.vel.z = 0;
  } else if (p.onGround && p.action === 'normal' && !pivotOnly) {
    let mx = inp.moveX;
    let mz = inp.moveZ;
    if (p.intenseD) {
      // Slide to the spot between your man and the rim; the stick only nudges.
      const t = intenseTarget(state, p);
      if (t) {
        const dx = t.x - p.pos.x;
        const dz = t.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        const k = d > 0.05 ? Math.min(1, d / 0.5) / d : 0;
        mx = dx * k + mx * 0.35;
        mz = dz * k + mz * 0.35;
      }
    }
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const pressured = mine && state.players.some((o) => o.team !== p.team && o.intenseD && hdist(o.pos, p.pos) < 1.3);
    const speed =
      runSpeed(p) * (inp.sprint ? 1.3 : 1) * (mine ? 0.92 : 1) * (pressured ? 0.88 : 1) * (p.intenseD ? 0.95 : 1);
    const k = Math.min(1, MOVE_RESPONSE * DT);
    p.vel.x += (mx * speed - p.vel.x) * k;
    p.vel.z += (mz * speed - p.vel.z) * k;
  } else if (p.onGround) {
    const k = Math.min(1, 14 * DT);
    p.vel.x -= p.vel.x * k;
    p.vel.z -= p.vel.z * k;
  }

  p.pos.x += p.vel.x * DT;
  p.pos.z += p.vel.z * DT;
  if (hanging) {
    p.vel.y = 0;
  } else if (!p.onGround) {
    p.vel.y -= GRAVITY * DT;
    p.pos.y += p.vel.y * DT;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
      if (pivotOnly) state.events.push({ type: 'deadDribble', playerId: p.id });
    }
  }
  const limX = COURT.halfLength + 1.2;
  const limZ = COURT.halfWidth + 1.2;
  // Street courts end a step past the half-court line.
  p.pos.x = Math.max(state.settings.street ? -1.2 : -limX, Math.min(limX, p.pos.x));
  p.pos.z = Math.max(-limZ, Math.min(limZ, p.pos.z));

  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  let targetFacing = p.facing;
  if (p.action !== 'normal') targetFacing = Math.atan2(attackHoop(state, p.team) - p.pos.x, -p.pos.z);
  else if (inbounder) targetFacing = Math.atan2(-p.pos.x, -p.pos.z);
  else if (pivotOnly && Math.hypot(inp.moveX, inp.moveZ) > 0.3) targetFacing = Math.atan2(inp.moveX, inp.moveZ);
  else if (p.intenseD) targetFacing = Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  else if (hSpeed > 1.5 || (mine && hSpeed > 0.3)) targetFacing = Math.atan2(p.vel.x, p.vel.z);
  else if (!mine) targetFacing = Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  p.facing = lerpAngle(p.facing, targetFacing, Math.min(1, 12 * DT));

  // Hand-checking while pressuring the ball can draw a whistle.
  if (p.intenseD && state.phase === 'live' && ball.mode === 'held') {
    const h = state.players[ball.holderId];
    if (h.team !== p.team && hdist(h.pos, p.pos) < 1.1 && nextRandom(state) < 0.0012) commonFoul(state, p, h, 'contact');
  }

  if (mine && p.action === 'normal' && !planted && !p.dribbleDead) {
    const before = Math.floor(p.dribblePhase / Math.PI);
    p.dribblePhase += DT * Math.PI * (1.8 + hSpeed * 0.3);
    if (Math.floor(p.dribblePhase / Math.PI) !== before && p.onGround) {
      state.events.push({ type: 'dribble', pos: { x: p.pos.x, y: 0, z: p.pos.z } });
    }
  }
}

/**
 * Intense defence spot: tight between the ball handler (if close) or your
 * assigned man and the rim they attack.
 */
function intenseTarget(state: GameState, p: PlayerState): { x: number; z: number } | null {
  const b = state.ball;
  const holder = b.mode === 'held' ? state.players[b.holderId] : null;
  let man: PlayerState | null = null;
  if (holder && holder.team !== p.team && hdist(holder.pos, p.pos) < 4.5) man = holder;
  else if (state.assign[p.id] >= 0) man = state.players[state.assign[p.id]];
  if (!man) return null;
  const hx = attackHoop(state, man.team);
  const dx = hx - man.pos.x;
  const dz = -man.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  const gap = man === holder ? 0.95 : 1.4;
  return { x: man.pos.x + (dx / l) * gap, z: man.pos.z + (dz / l) * gap };
}

/** Pushes overlapping players apart; the one moving into the other gives way more. */
export function resolveCollisions(state: GameState): void {
  const ps = state.players;
  const min = PLAYER_RADIUS * 2;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i];
      const b = ps[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const overlap = min - d;
      checkContact(state, a, b, nx, nz);
      const aLocked = isInbounder(state, a);
      const bLocked = isInbounder(state, b);
      const sa = Math.hypot(a.vel.x, a.vel.z) + 0.1;
      const sb = Math.hypot(b.vel.x, b.vel.z) + 0.1;
      let wa = aLocked ? 0 : bLocked ? 1 : sa / (sa + sb);
      let wb = bLocked ? 0 : aLocked ? 1 : sb / (sa + sb);
      if (aLocked && bLocked) wa = wb = 0;
      a.pos.x -= nx * overlap * wa;
      a.pos.z -= nz * overlap * wa;
      b.pos.x += nx * overlap * wb;
      b.pos.z += nz * overlap * wb;
      // Kill the velocity component driving into the other player.
      const va = a.vel.x * nx + a.vel.z * nz;
      if (va > 0) {
        a.vel.x -= va * nx * 0.6;
        a.vel.z -= va * nz * 0.6;
      }
      const vb = b.vel.x * nx + b.vel.z * nz;
      if (vb < 0) {
        b.vel.x -= vb * nx * 0.6;
        b.vel.z -= vb * nz * 0.6;
      }
    }
  }
}

/**
 * Ball handler running into a defender: a charge if the defender had set up
 * (still, facing the play, outside the restricted area), otherwise a block.
 */
function checkContact(state: GameState, a: PlayerState, b: PlayerState, nx: number, nz: number): void {
  const ball = state.ball;
  if (state.phase !== 'live' || ball.mode !== 'held' || !state.settings.rules.fouls) return;
  let h: PlayerState;
  let d: PlayerState;
  let sign: number;
  if (ball.holderId === a.id) [h, d, sign] = [a, b, 1];
  else if (ball.holderId === b.id) [h, d, sign] = [b, a, -1];
  else return;
  if (d.team === h.team) return;
  // Only the first moment of a collision can draw a call; leaning on each other keeps it quiet.
  const fresh = h.contactCooldown <= 0 && d.contactCooldown <= 0;
  h.contactCooldown = 0.5;
  d.contactCooldown = 0.5;
  if (!fresh || !h.onGround) return;
  // Handler's speed into the defender.
  const vn = (h.vel.x * nx + h.vel.z * nz) * sign;
  if (vn < 3.4) return;
  if (nextRandom(state) >= Math.min(0.12, 0.025 + (vn - 3.4) * 0.05)) return;
  const toH = Math.atan2(h.pos.x - d.pos.x, h.pos.z - d.pos.z);
  const facing = Math.cos(toH - d.facing) > 0.3;
  const hx = attackHoop(state, h.team);
  const restricted = Math.hypot(d.pos.x - hx, d.pos.z) < COURT.restrictedRadius;
  const set = d.onGround && Math.hypot(d.vel.x, d.vel.z) < 1.3 && facing && !restricted;
  if (set) chargeFoul(state, h, d);
  else commonFoul(state, d, h, 'block');
}

// -------------------------------------------------------------- shooting

const METER_TIME: Record<ShotKind, number> = {
  jumper: JUMPER_METER_TIME,
  layup: LAYUP_METER_TIME,
  dunk: DUNK_METER_TIME,
  free: FREE_METER_TIME,
};
const JUMP_AT: Record<ShotKind, number> = { jumper: 0.38, layup: 0.05, dunk: 0.05, free: 0.5 };

function startShot(state: GameState, p: PlayerState, inp: PlayerInput): void {
  const hx = attackHoop(state, p.team);
  const dist = Math.hypot(hx - p.pos.x, p.pos.z);
  const toHoopX = (hx - p.pos.x) / Math.max(dist, 1e-6);
  const toHoopZ = -p.pos.z / Math.max(dist, 1e-6);
  const drivingSpeed = p.vel.x * toHoopX + p.vel.z * toHoopZ;
  const layup = dist < LAYUP_DISTANCE || (dist < 3.5 && drivingSpeed > 3);
  // Sprint + shoot near the rim dunks if you can get up there; bigs flush it from point-blank anyway.
  const dunk = dist < DUNK_DISTANCE && canDunk(p) && (inp.sprint || dist < 1.2);
  p.action = 'shooting';
  p.shotKind = state.phase === 'freeThrow' ? 'free' : dunk ? 'dunk' : layup ? 'layup' : 'jumper';
  p.shotTimer = 0;
  p.shotMeter = 0;
  p.shotJumped = false;
  p.shotFrom = { x: p.pos.x, y: 0, z: p.pos.z };
}

function launchShotJump(state: GameState, p: PlayerState): void {
  p.shotJumped = true;
  p.onGround = false;
  if (p.shotKind === 'free') {
    p.vel.y = 0.9;
  } else if (p.shotKind === 'dunk') {
    p.vel.y = jumpSpeed(p) + DUNK_JUMP_BONUS;
    const hx = attackHoop(state, p.team);
    const dx = hx - p.pos.x;
    const dz = -p.pos.z;
    const d = Math.hypot(dx, dz);
    // Arrive just in front of the rim at the top of the jump.
    const speed = Math.min(4.5, Math.max(0, d - 0.5) / (p.vel.y / GRAVITY));
    p.vel.x = (dx / Math.max(d, 1e-6)) * speed;
    p.vel.z = (dz / Math.max(d, 1e-6)) * speed;
  } else if (p.shotKind === 'layup') {
    p.vel.y = 3.6;
    const hx = attackHoop(state, p.team);
    const dx = hx - p.pos.x;
    const dz = -p.pos.z;
    const d = Math.hypot(dx, dz);
    // Glide toward the rim but stop short of it.
    const speed = Math.min(3, Math.max(0, d - 0.6) / 0.7);
    p.vel.x = (dx / Math.max(d, 1e-6)) * speed;
    p.vel.z = (dz / Math.max(d, 1e-6)) * speed;
  } else {
    p.vel.y = 2.75;
  }
}

/**
 * How well defenders bother a shot from `pos`: 0 = wide open, 1 = smothered.
 * Closer, in-front, taller and airborne defenders contest more.
 */
export function contestAt(state: GameState, team: 0 | 1, pos: { x: number; z: number }, shooterHeight: number): number {
  return topContest(state, team, pos, shooterHeight).contest;
}

/** Strongest contest on a shot and the defender providing it. */
function topContest(
  state: GameState,
  team: 0 | 1,
  pos: { x: number; z: number },
  shooterHeight: number,
): { contest: number; by: PlayerState | null } {
  const hx = attackHoop(state, team);
  const ux = hx - pos.x;
  const uz = -pos.z;
  const ul = Math.hypot(ux, uz) || 1;
  let best = 0;
  let by: PlayerState | null = null;
  for (const o of state.players) {
    if (o.team === team) continue;
    const vx = o.pos.x - pos.x;
    const vz = o.pos.z - pos.z;
    const d = Math.hypot(vx, vz);
    if (d > 2.2) continue;
    const cos = d > 1e-6 ? (vx * ux + vz * uz) / (d * ul) : 1;
    const front = cos > 0.2 ? 1 : 0.45;
    const closeness = Math.min(1, (2.2 - d) / 1.6);
    const height = Math.max(0.5, Math.min(1.3, 0.8 + (o.info.heightM - shooterHeight) * 0.8 + (o.onGround ? 0 : 0.25)));
    const c = closeness * front * height * (0.7 + o.info.ratings.defense * 0.004) * (o.intenseD ? 1.2 : 1) * defenderSet(o);
    if (c > best) {
      best = c;
      by = o;
    }
  }
  return { contest: Math.min(1, best), by };
}

/** Expected points of a well-timed shot by `p` from `pos` given current defence. */
export function shotValue(state: GameState, p: PlayerState, pos: { x: number; z: number } = p.pos): number {
  const hx = attackHoop(state, p.team);
  const dist = Math.hypot(hx - pos.x, pos.z);
  if (dist > 9) return 0;
  const layup = dist < LAYUP_DISTANCE;
  const three = !layup && isThreePoint(pos.x, pos.z, hx);
  const chance = baseMakeChance(p.info.ratings, dist, three, layup) * contestMultiplier(contestAt(state, p.team, pos, p.info.heightM));
  // In AI value units an inside shot is 2: street long shots are worth double that.
  return chance * (state.settings.street ? (three ? 3.5 : 2) : three ? 3 : 2);
}

/** Street counts 1 and 2 instead of 2 and 3. */
export function shotPoints(state: GameState, three: boolean): 1 | 2 | 3 {
  if (state.settings.street) return three ? 2 : 1;
  return three ? 3 : 2;
}

function releaseShot(state: GameState, p: PlayerState): void {
  const ball = state.ball;
  const hx = attackHoop(state, p.team);
  const meter = p.shotMeter;
  const kind = p.shotKind;
  const free = kind === 'free';
  const layup = kind === 'layup';
  const dunk = kind === 'dunk';
  const from = p.shotFrom;
  const dist = Math.hypot(hx - from.x, from.z);
  const three = kind === 'jumper' && isThreePoint(from.x, from.z, hx);
  const { contest, by } = free ? { contest: 0, by: null } : topContest(state, p.team, p.pos, p.info.heightM);
  const release = heldBallPosition(state, p);
  // No dunk if the hands never got above the rim (let go too early).
  const reached = !dunk || release.y > HOOP.rimHeight + 0.05;

  // Contact on the shot: closer, more aggressive contests on drives foul more often.
  let fouler: PlayerState | null = null;
  if (by && contest > 0.15 && state.settings.rules.fouls && state.settings.mode === 'game') {
    const rate = (layup || dunk ? 0.2 : 0.08) * (by.intenseD ? 1.5 : 1) * (1.2 - by.info.ratings.defense * 0.004);
    if (nextRandom(state) < contest * rate) fouler = by;
  }
  const tired = free ? 0.92 + 0.08 * freshness(p) : 0.85 + 0.15 * freshness(p);
  let chance = free
    ? freeThrowChance(p.info.ratings, meter)
    : dunk
      ? dunkChance(p.info.ratings, meter, contest)
      : makeChance(p.info.ratings, dist, three, layup, meter, contest);
  chance *= tired * (fouler ? 0.5 : 1) * (reached ? 1 : 0.3);
  const willMake = nextRandom(state) < chance;
  const { quality } = gradeTiming(meter);
  const points = free ? 1 : shotPoints(state, three);

  let target: Vec3;
  let flightTime: number | undefined;
  if (willMake && dunk) {
    // Hammer it straight down through the ring from just in front of it.
    const ox = release.x - hx;
    const oz = release.z;
    const ol = Math.hypot(ox, oz) || 1;
    release.x = hx + (ox / ol) * 0.12;
    release.z = (oz / ol) * 0.12;
    release.y = HOOP.rimHeight + 0.22;
    target = { x: hx, y: HOOP.rimHeight - 0.3, z: 0 };
    flightTime = 0.1;
  } else if (willMake) {
    target = { x: hx + (nextRandom(state) - 0.5) * 0.06, y: HOOP.rimHeight, z: (nextRandom(state) - 0.5) * 0.06 };
  } else {
    // Miss toward the front or back rim, biased short when early and long when late.
    const ux = hx - release.x;
    const uz = -release.z;
    const ul = Math.hypot(ux, uz) || 1;
    const longBias = quality === 'late' ? 0.75 : quality === 'early' ? 0.25 : 0.5;
    const sign = nextRandom(state) < longBias ? 1 : -1;
    const spread = (nextRandom(state) - 0.5) * 1.4;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    const dx = ((ux * cos - uz * sin) / ul) * sign;
    const dz = ((ux * sin + uz * cos) / ul) * sign;
    const off = HOOP.rimRadius + 0.02 + nextRandom(state) * 0.08;
    target = { x: hx + dx * off, y: HOOP.rimHeight + 0.02, z: dz * off };
  }
  const hd = Math.hypot(target.x - release.x, target.z - release.z);
  flightTime ??= dunk ? 0.22 : layup ? 0.45 + hd * 0.12 : 0.8 + hd * 0.065;

  ball.mode = 'flight';
  ball.holderId = -1;
  ball.pass = null;
  ball.lastTouchTeam = p.team;
  ball.pos = release;
  ball.vel = {
    x: (target.x - release.x) / flightTime,
    y: (target.y - release.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
    z: (target.z - release.z) / flightTime,
  };
  ball.shot = {
    shooterId: p.id,
    team: p.team,
    hoopX: hx,
    kind,
    points,
    willMake,
    quality,
    chance,
    releaseTick: state.tick,
    touchedRim: false,
    scored: false,
    blocked: false,
    blockChecked: [],
    fouledBy: -1,
  };

  if (free) p.stats.fta++;
  else p.stats.fga++;
  if (three) p.stats.tpa++;
  p.action = 'release';
  p.shotTimer = 0;
  p.shotMeter = -1;
  p.pickupCooldown = 0.5;
  p.dribbleDead = false;
  state.events.push({ type: 'shot', playerId: p.id, kind, quality, points, chance });
  if (free) onFreeThrowRelease(state);
  else if (fouler) shootingFoul(state, ball.shot, fouler);
}

// --------------------------------------------------------------- passing

/** Human passing: aim with the stick, otherwise the nearest teammate. */
export function choosePassTarget(state: GameState, p: PlayerState, inp: PlayerInput): number {
  const mates = teammates(state, p);
  if (!mates.length) return -1;
  const aim = Math.hypot(inp.moveX, inp.moveZ);
  let best = mates[0];
  let bestScore = -Infinity;
  for (const m of mates) {
    const dx = m.pos.x - p.pos.x;
    const dz = m.pos.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const score = aim > 0.3 ? (dx * inp.moveX + dz * inp.moveZ) / (d * aim) - d * 0.01 : -d;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best.id;
}

export function releasePass(state: GameState, p: PlayerState, targetId: number): void {
  const ball = state.ball;
  const t = state.players[targetId];
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  const from: Vec3 = { x: p.pos.x + fx * 0.3, y: p.pos.y + p.info.heightM * 0.7, z: p.pos.z + fz * 0.3 };
  const speed = PASS_SPEED_BASE + p.info.ratings.pass * 0.04;
  // Lead the receiver by where they will be when the ball arrives. A person
  // may stop or turn at any moment, so their lead is short (the pass bends a
  // little toward them in flight instead).
  const lead = state.controlled[t.team] === t.id ? 0.3 : 1;
  let flight = Math.max(MIN_PASS_FLIGHT, hdist(from, t.pos) / speed);
  let to: Vec3 = { x: t.pos.x + t.vel.x * flight * lead, y: t.info.heightM * 0.62, z: t.pos.z + t.vel.z * flight * lead };
  flight = Math.max(MIN_PASS_FLIGHT, hdist(from, to) / speed);
  to = { x: t.pos.x + t.vel.x * flight * lead, y: t.info.heightM * 0.62, z: t.pos.z + t.vel.z * flight * lead };
  // The pass to a play's man: a team that knows each other less sometimes throws it off target.
  const play = activePlay(state, p.team);
  if (play && targetId === play.targetId && nextRandom(state) < passOffChance(cohesionOf(state, p.team))) {
    const ex = -(to.z - from.z);
    const ez = to.x - from.x;
    const el = Math.hypot(ex, ez) || 1;
    const sgn = nextRandom(state) < 0.5 ? -1 : 1;
    to = { ...to, x: to.x + (ex / el) * 1.1 * sgn, z: to.z + (ez / el) * 1.1 * sgn };
  }

  let receiver = targetId;
  let intercepted = false;
  // Inbound passes are lobbed over the defence: much harder to jump.
  const inbound = isInbounder(state, p) ? 0.35 : 1;
  // Defenders near the passing lane may jump it.
  const lx = to.x - from.x;
  const lz = to.z - from.z;
  const ll = Math.hypot(lx, lz) || 1;
  const lanes = opponents(state, p.team)
    .map((o) => {
      const u = ((o.pos.x - from.x) * lx + (o.pos.z - from.z) * lz) / (ll * ll);
      const px = from.x + lx * u;
      const pz = from.z + lz * u;
      return { o, u, d: Math.hypot(o.pos.x - px, o.pos.z - pz) };
    })
    .filter((c) => c.u > 0.2 && c.u < 0.92 && c.d < 0.7)
    .sort((a, b) => a.u - b.u);
  for (const c of lanes) {
    const chance =
      (1 - c.d / 0.7) * (0.06 + c.o.info.ratings.steal * 0.0025) * (ll > 6 ? 1.3 : 1) * defenderSet(c.o) * inbound;
    if (nextRandom(state) < chance) {
      receiver = c.o.id;
      intercepted = true;
      break;
    }
  }

  ball.mode = 'pass';
  ball.holderId = -1;
  ball.shot = null;
  ball.pass = { passerId: p.id, targetId: receiver, team: p.team, intercepted };
  ball.lastTouchTeam = p.team;
  ball.pos = from;
  ball.vel = {
    x: (to.x - from.x) / flight,
    y: (to.y - from.y + 0.5 * GRAVITY * flight * flight) / flight,
    z: (to.z - from.z) / flight,
  };
  p.pickupCooldown = 0.35;
  p.dribbleDead = false;
  state.events.push({ type: 'pass', playerId: p.id, targetId });
}

// ---------------------------------------------------------------- steals

/** Solo games: pass without the ball while a teammate has it = "give me the ball". */
function callForBall(state: GameState, p: PlayerState): boolean {
  const b = state.ball;
  if (state.settings.solo === undefined || state.controlled[p.team] !== p.id || b.mode !== 'held') return false;
  const h = state.players[b.holderId];
  if (h.team !== p.team) return false;
  state.ballCall = { playerId: p.id, timer: 1.5 };
  state.events.push({ type: 'call', kind: 'ball', playerId: p.id, ok: true });
  return true;
}

function attemptSteal(state: GameState, d: PlayerState): void {
  const ball = state.ball;
  if (d.stealCooldown > 0 || ball.mode !== 'held') return;
  const h = state.players[ball.holderId];
  if (h.team === d.team || h.action === 'shooting' || isInbounder(state, h)) return;
  d.stealCooldown = 0.9;
  state.events.push({ type: 'reach', playerId: d.id });
  const dist = hdist(d.pos, ball.pos);
  if (dist > 1.4) return;
  const chance =
    Math.min(
      0.4,
      Math.max(
        0.03,
        0.1 + (d.info.ratings.steal - h.info.ratings.handle) * 0.004 + (1.4 - dist) * 0.08 + (d.intenseD ? 0.05 : 0),
      ),
    ) * defenderSet(d);
  if (nextRandom(state) >= chance) {
    // A missed swipe sometimes catches the arm instead.
    const foul = 0.07 + (d.intenseD ? 0.05 : 0) + (1.4 - dist) * 0.05 - d.info.ratings.steal * 0.0005;
    if (nextRandom(state) < foul) commonFoul(state, d, h, 'reach');
    return;
  }
  const dx = d.pos.x - ball.pos.x;
  const dz = d.pos.z - ball.pos.z;
  const l = Math.hypot(dx, dz) || 1;
  ball.mode = 'loose';
  ball.holderId = -1;
  ball.vel = { x: (dx / l) * 2.2, y: 1.5, z: (dz / l) * 2.2 };
  ball.lastTouchTeam = d.team;
  ball.strippedBy = d.id;
  ball.strippedFrom = h.id;
  h.pickupCooldown = 0.6;
}

// ------------------------------------------------------------------ ball

export function heldBallPosition(state: GameState, p: PlayerState): Vec3 {
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  const h = p.info.heightM;
  if (p.action === 'shooting' && p.shotKind === 'dunk') {
    // Cocked back, then up over the head toward the rim.
    const t = Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET);
    return { x: p.pos.x + fx * (0.15 + 0.25 * t), y: p.pos.y + h * (0.75 + 0.55 * t), z: p.pos.z + fz * (0.15 + 0.25 * t) };
  }
  if (p.action === 'shooting' || !p.onGround) {
    const t = p.action === 'shooting' ? Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET) : 0.3;
    return { x: p.pos.x + fx * 0.25, y: p.pos.y + h * (0.7 + 0.45 * t), z: p.pos.z + fz * 0.25 };
  }
  if (p.dribbleDead) {
    // Both hands on the ball at the chest.
    return { x: p.pos.x + fx * 0.3, y: h * 0.62, z: p.pos.z + fz * 0.3 };
  }
  if (isInbounder(state, p)) {
    // Matches the overhead-hold pose: hands end up ~1.12 x height, just in front of the face.
    return { x: p.pos.x + fx * 0.12, y: h * 1.17, z: p.pos.z + fz * 0.12 };
  }
  const rx = -fz;
  const rz = fx;
  const bounce = Math.abs(Math.sin(p.dribblePhase));
  return {
    x: p.pos.x + rx * 0.32 + fx * 0.28,
    y: BALL_RADIUS + bounce * (h * 0.45 - BALL_RADIUS),
    z: p.pos.z + rz * 0.32 + fz * 0.28,
  };
}
