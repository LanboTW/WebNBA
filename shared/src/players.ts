import {
  BALL_RADIUS,
  COURT,
  DT,
  GRAVITY,
  HOOP,
  PLAYER_RADIUS,
  attackHoopX,
  isThreePoint,
} from './constants';
import { nextRandom } from './rng';
import {
  JUMPER_METER_TIME,
  LAYUP_DISTANCE,
  LAYUP_METER_TIME,
  METER_MAX,
  SHOT_SWEET,
  baseMakeChance,
  contestMultiplier,
  gradeTiming,
  makeChance,
} from './shot';
import type { GameState, PlayerInput, PlayerState, Vec3 } from './types';

const MOVE_RESPONSE = 10;
const PASS_SPEED_BASE = 11;

export const hdist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function runSpeed(p: PlayerState): number {
  return 4.2 + p.info.ratings.speed * 0.025;
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

  if (p.action === 'shooting') {
    // Release uses the meter the player saw when letting go, before advancing it.
    if (shootReleased) {
      releaseShot(state, p);
    } else {
      p.shotTimer += DT;
      const meterTime = p.shotKind === 'layup' ? LAYUP_METER_TIME : JUMPER_METER_TIME;
      p.shotMeter = p.shotTimer / meterTime;
      const jumpAt = p.shotKind === 'layup' ? 0.05 : 0.38;
      if (!p.shotJumped && p.shotMeter >= jumpAt) launchShotJump(state, p);
      if (p.shotMeter >= METER_MAX) releaseShot(state, p);
    }
  } else if (p.action === 'release') {
    p.shotTimer += DT;
    if (p.onGround && p.shotTimer > 0.2) p.action = 'normal';
  } else if (mine && passPressed && (canPlay || inbounder)) {
    const explicit = inp.passTarget !== undefined ? state.players[inp.passTarget] : undefined;
    const valid = explicit && explicit.team === p.team && explicit.id !== p.id;
    const target = valid ? explicit.id : choosePassTarget(state, p, inp);
    if (target >= 0) releasePass(state, p, target);
  } else if (mine && shootPressed && p.onGround && canPlay && !inbounder) {
    startShot(state, p);
  } else if (!mine && passPressed && canPlay) {
    attemptSteal(state, p);
  } else if (jumpPressed && p.onGround && !inbounder) {
    p.vel.y = 3.0 + p.info.ratings.jump * 0.014;
    p.onGround = false;
  }

  if (inbounder) {
    p.vel.x = 0;
    p.vel.z = 0;
  } else if (p.onGround && p.action === 'normal') {
    let mx = inp.moveX;
    let mz = inp.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = runSpeed(p) * (inp.sprint ? 1.3 : 1) * (mine ? 0.92 : 1);
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
  if (!p.onGround) {
    p.vel.y -= GRAVITY * DT;
    p.pos.y += p.vel.y * DT;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
    }
  }
  const limX = COURT.halfLength + 1.2;
  const limZ = COURT.halfWidth + 1.2;
  p.pos.x = Math.max(-limX, Math.min(limX, p.pos.x));
  p.pos.z = Math.max(-limZ, Math.min(limZ, p.pos.z));

  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  let targetFacing = p.facing;
  if (p.action !== 'normal') targetFacing = Math.atan2(attackHoopX(p.team, state.period) - p.pos.x, -p.pos.z);
  else if (inbounder) targetFacing = Math.atan2(-p.pos.x, -p.pos.z);
  else if (hSpeed > 1.5 || (mine && hSpeed > 0.3)) targetFacing = Math.atan2(p.vel.x, p.vel.z);
  else if (!mine) targetFacing = Math.atan2(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
  p.facing = lerpAngle(p.facing, targetFacing, Math.min(1, 12 * DT));

  if (mine && p.action === 'normal' && !inbounder) {
    const before = Math.floor(p.dribblePhase / Math.PI);
    p.dribblePhase += DT * Math.PI * (1.8 + hSpeed * 0.3);
    if (Math.floor(p.dribblePhase / Math.PI) !== before && p.onGround) {
      state.events.push({ type: 'dribble', pos: { x: p.pos.x, y: 0, z: p.pos.z } });
    }
  }
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

// -------------------------------------------------------------- shooting

function startShot(state: GameState, p: PlayerState): void {
  const hx = attackHoopX(p.team, state.period);
  const dist = Math.hypot(hx - p.pos.x, p.pos.z);
  const toHoopX = (hx - p.pos.x) / Math.max(dist, 1e-6);
  const toHoopZ = -p.pos.z / Math.max(dist, 1e-6);
  const drivingSpeed = p.vel.x * toHoopX + p.vel.z * toHoopZ;
  const layup = dist < LAYUP_DISTANCE || (dist < 3.5 && drivingSpeed > 3);
  p.action = 'shooting';
  p.shotKind = layup ? 'layup' : 'jumper';
  p.shotTimer = 0;
  p.shotMeter = 0;
  p.shotJumped = false;
  p.shotFrom = { x: p.pos.x, y: 0, z: p.pos.z };
}

function launchShotJump(state: GameState, p: PlayerState): void {
  p.shotJumped = true;
  p.onGround = false;
  if (p.shotKind === 'layup') {
    p.vel.y = 3.6;
    const hx = attackHoopX(p.team, state.period);
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
  const hx = attackHoopX(team, state.period);
  const ux = hx - pos.x;
  const uz = -pos.z;
  const ul = Math.hypot(ux, uz) || 1;
  let best = 0;
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
    const c = closeness * front * height * (0.7 + o.info.ratings.defense * 0.004);
    best = Math.max(best, c);
  }
  return Math.min(1, best);
}

/** Expected points of a well-timed shot by `p` from `pos` given current defence. */
export function shotValue(state: GameState, p: PlayerState, pos: { x: number; z: number } = p.pos): number {
  const hx = attackHoopX(p.team, state.period);
  const dist = Math.hypot(hx - pos.x, pos.z);
  if (dist > 9) return 0;
  const layup = dist < LAYUP_DISTANCE;
  const three = !layup && isThreePoint(pos.x, pos.z, hx);
  const chance = baseMakeChance(p.info.ratings, dist, three, layup) * contestMultiplier(contestAt(state, p.team, pos, p.info.heightM));
  return chance * (three ? 3 : 2);
}

function releaseShot(state: GameState, p: PlayerState): void {
  const ball = state.ball;
  const hx = attackHoopX(p.team, state.period);
  const meter = p.shotMeter;
  const layup = p.shotKind === 'layup';
  const from = p.shotFrom;
  const dist = Math.hypot(hx - from.x, from.z);
  const three = !layup && isThreePoint(from.x, from.z, hx);
  const contest = contestAt(state, p.team, p.pos, p.info.heightM);
  const chance = makeChance(p.info.ratings, dist, three, layup, meter, contest);
  const willMake = nextRandom(state) < chance;
  const { quality } = gradeTiming(meter);
  const points: 2 | 3 = three ? 3 : 2;

  const release = heldBallPosition(state, p);
  let target: Vec3;
  if (willMake) {
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
  const flightTime = layup ? 0.45 + hd * 0.12 : 0.8 + hd * 0.065;
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
    points,
    willMake,
    quality,
    chance,
    releaseTick: state.tick,
    touchedRim: false,
    scored: false,
    blocked: false,
    blockChecked: [],
  };

  p.stats.fga++;
  if (three) p.stats.tpa++;
  p.action = 'release';
  p.shotTimer = 0;
  p.shotMeter = -1;
  p.pickupCooldown = 0.5;
  state.events.push({ type: 'shot', playerId: p.id, quality, points, chance });
}

// --------------------------------------------------------------- passing

/** Human passing: aim with the stick, or pick the most open teammate. */
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
    const score =
      aim > 0.3
        ? (dx * inp.moveX + dz * inp.moveZ) / (d * aim) - d * 0.01
        : shotValue(state, m) + Math.min(3, openness(state, m)) * 0.15 - d * 0.02;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best.id;
}

/** Distance to the nearest opponent. */
export function openness(state: GameState, p: PlayerState): number {
  let best = Infinity;
  for (const o of state.players) if (o.team !== p.team) best = Math.min(best, hdist(o.pos, p.pos));
  return best;
}

export function releasePass(state: GameState, p: PlayerState, targetId: number): void {
  const ball = state.ball;
  const t = state.players[targetId];
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  const from: Vec3 = { x: p.pos.x + fx * 0.3, y: p.pos.y + p.info.heightM * 0.7, z: p.pos.z + fz * 0.3 };
  const speed = PASS_SPEED_BASE + p.info.ratings.pass * 0.04;
  // Lead the receiver by where they will be when the ball arrives.
  let flight = Math.max(0.15, hdist(from, t.pos) / speed);
  let to: Vec3 = { x: t.pos.x + t.vel.x * flight, y: t.info.heightM * 0.62, z: t.pos.z + t.vel.z * flight };
  flight = Math.max(0.15, hdist(from, to) / speed);
  to = { x: t.pos.x + t.vel.x * flight, y: t.info.heightM * 0.62, z: t.pos.z + t.vel.z * flight };

  let receiver = targetId;
  let intercepted = false;
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
    .filter((c) => c.u > 0.2 && c.u < 0.92 && c.d < 0.8)
    .sort((a, b) => a.u - b.u);
  for (const c of lanes) {
    const chance = (1 - c.d / 0.8) * (0.12 + c.o.info.ratings.steal * 0.004) * (ll > 6 ? 1.3 : 1);
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
  state.events.push({ type: 'pass', playerId: p.id, targetId });
}

// ---------------------------------------------------------------- steals

function attemptSteal(state: GameState, d: PlayerState): void {
  const ball = state.ball;
  if (d.stealCooldown > 0 || ball.mode !== 'held') return;
  const h = state.players[ball.holderId];
  if (h.team === d.team || h.action === 'shooting' || isInbounder(state, h)) return;
  d.stealCooldown = 0.9;
  state.events.push({ type: 'reach', playerId: d.id });
  const dist = hdist(d.pos, ball.pos);
  if (dist > 1.4) return;
  const chance = Math.min(
    0.4,
    Math.max(0.03, 0.1 + (d.info.ratings.steal - h.info.ratings.handle) * 0.004 + (1.4 - dist) * 0.08),
  );
  if (nextRandom(state) >= chance) return;
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
  if (p.action === 'shooting' || !p.onGround) {
    const t = p.action === 'shooting' ? Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET) : 0.3;
    return { x: p.pos.x + fx * 0.25, y: p.pos.y + h * (0.7 + 0.45 * t), z: p.pos.z + fz * 0.25 };
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
