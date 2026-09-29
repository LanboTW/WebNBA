import {
  BALL_RADIUS,
  BOARD_X,
  COURT,
  DT,
  GRAVITY,
  HOOP,
  HOOP_X,
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
  gradeTiming,
  makeChance,
} from './shot';
import {
  NO_INPUT,
  type GameState,
  type PlayerInfo,
  type PlayerInput,
  type PlayerState,
  type Vec3,
} from './types';

export interface PlayerSetup {
  info: PlayerInfo;
  team: 0 | 1;
  pos: { x: number; z: number };
}

export interface GameSetup {
  players: PlayerSetup[];
  seed?: number;
  ballHolder?: number;
}

const BALL_SUBSTEPS = 4;
const PICKUP_RADIUS = 0.65;
const MOVE_RESPONSE = 10;
const WALL_MARGIN = 3;

export function createGame(setup: GameSetup): GameState {
  const players: PlayerState[] = setup.players.map((s, id) => ({
    id,
    team: s.team,
    info: s.info,
    pos: { x: s.pos.x, y: 0, z: s.pos.z },
    vel: { x: 0, y: 0, z: 0 },
    facing: s.team === 0 ? Math.PI / 2 : -Math.PI / 2,
    onGround: true,
    action: 'normal',
    shotKind: 'jumper',
    shotTimer: 0,
    shotMeter: -1,
    shotJumped: false,
    shotFrom: { x: 0, y: 0, z: 0 },
    dribblePhase: 0,
    pickupCooldown: 0,
    lastShoot: false,
    lastJump: false,
    stats: { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0 },
  }));
  const state: GameState = {
    tick: 0,
    rng: setup.seed ?? 20260930,
    players,
    ball: { pos: { x: 0, y: BALL_RADIUS, z: 0 }, vel: { x: 0, y: 0, z: 0 }, mode: 'loose', holderId: -1, shot: null },
    score: [0, 0],
    events: [],
  };
  if (setup.ballHolder !== undefined) giveBall(state, setup.ballHolder);
  return state;
}

export function giveBall(state: GameState, playerId: number): void {
  const b = state.ball;
  b.mode = 'held';
  b.holderId = playerId;
  b.shot = null;
  b.vel = { x: 0, y: 0, z: 0 };
  updateHeldBall(state);
}

export function step(state: GameState, inputs: Record<number, PlayerInput>): void {
  state.events = [];
  state.tick++;
  for (const p of state.players) updatePlayer(state, p, inputs[p.id] ?? NO_INPUT);
  if (state.ball.mode === 'held') updateHeldBall(state);
  else updateFreeBall(state);
  if (state.ball.mode === 'loose') tryPickup(state);
}

// ---------------------------------------------------------------- players

function updatePlayer(state: GameState, p: PlayerState, inp: PlayerInput): void {
  const ball = state.ball;
  const hasBall = ball.mode === 'held' && ball.holderId === p.id;
  const shootPressed = inp.shoot && !p.lastShoot;
  const shootReleased = !inp.shoot && p.lastShoot;
  const jumpPressed = inp.jump && !p.lastJump;
  p.lastShoot = inp.shoot;
  p.lastJump = inp.jump;
  p.pickupCooldown = Math.max(0, p.pickupCooldown - DT);

  if (p.action === 'shooting') {
    // Release uses the meter the player saw when letting go, before advancing it.
    if (shootReleased) {
      releaseShot(state, p);
    } else {
      p.shotTimer += DT;
      const meterTime = p.shotKind === 'layup' ? LAYUP_METER_TIME : JUMPER_METER_TIME;
      p.shotMeter = p.shotTimer / meterTime;
      const jumpAt = p.shotKind === 'layup' ? 0.05 : 0.38;
      if (!p.shotJumped && p.shotMeter >= jumpAt) launchShotJump(p);
      if (p.shotMeter >= METER_MAX) releaseShot(state, p);
    }
  } else if (p.action === 'release') {
    p.shotTimer += DT;
    if (p.onGround && p.shotTimer > 0.2) p.action = 'normal';
  } else if (hasBall && shootPressed && p.onGround) {
    startShot(p);
  } else if (jumpPressed && p.onGround) {
    p.vel.y = 3.0 + p.info.ratings.jump * 0.014;
    p.onGround = false;
  }

  if (p.onGround && p.action === 'normal') {
    let mx = inp.moveX;
    let mz = inp.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const speed = runSpeed(p) * (inp.sprint ? 1.3 : 1) * (hasBall ? 0.92 : 1);
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
  if (p.action !== 'normal') targetFacing = Math.atan2(attackHoopX(p.team) - p.pos.x, -p.pos.z);
  else if (hSpeed > 0.3) targetFacing = Math.atan2(p.vel.x, p.vel.z);
  p.facing = lerpAngle(p.facing, targetFacing, Math.min(1, 12 * DT));

  if (hasBall && p.action === 'normal') {
    const before = Math.floor(p.dribblePhase / Math.PI);
    p.dribblePhase += DT * Math.PI * (1.8 + hSpeed * 0.3);
    if (Math.floor(p.dribblePhase / Math.PI) !== before && p.onGround) {
      state.events.push({ type: 'dribble', pos: { x: p.pos.x, y: 0, z: p.pos.z } });
    }
  }
}

export function runSpeed(p: PlayerState): number {
  return 4.2 + p.info.ratings.speed * 0.025;
}

function startShot(p: PlayerState): void {
  const hx = attackHoopX(p.team);
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

function launchShotJump(p: PlayerState): void {
  p.shotJumped = true;
  p.onGround = false;
  if (p.shotKind === 'layup') {
    p.vel.y = 3.6;
    const hx = attackHoopX(p.team);
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

function releaseShot(state: GameState, p: PlayerState): void {
  const ball = state.ball;
  const hx = attackHoopX(p.team);
  const meter = p.shotMeter;
  const layup = p.shotKind === 'layup';
  const from = p.shotFrom;
  const dist = Math.hypot(hx - from.x, from.z);
  const three = !layup && isThreePoint(from.x, from.z, hx);
  const chance = makeChance(p.info.ratings, dist, three, layup, meter);
  const willMake = nextRandom(state) < chance;
  const { quality } = gradeTiming(meter);
  const points: 2 | 3 = three ? 3 : 2;

  const release = heldBallPosition(p);
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
  ball.pos = release;
  ball.vel = {
    x: (target.x - release.x) / flightTime,
    y: (target.y - release.y + 0.5 * GRAVITY * flightTime * flightTime) / flightTime,
    z: (target.z - release.z) / flightTime,
  };
  ball.shot = { shooterId: p.id, team: p.team, hoopX: hx, points, willMake, quality, chance, touchedRim: false, scored: false };

  p.stats.fga++;
  if (three) p.stats.tpa++;
  p.action = 'release';
  p.shotTimer = 0;
  p.shotMeter = -1;
  p.pickupCooldown = 0.5;
  state.events.push({ type: 'shot', playerId: p.id, quality, points, chance });
}

// ------------------------------------------------------------------- ball

export function heldBallPosition(p: PlayerState): Vec3 {
  const fx = Math.sin(p.facing);
  const fz = Math.cos(p.facing);
  const h = p.info.heightM;
  if (p.action === 'shooting' || !p.onGround) {
    const t = p.action === 'shooting' ? Math.min(1, Math.max(0, p.shotMeter) / SHOT_SWEET) : 0.3;
    return { x: p.pos.x + fx * 0.25, y: p.pos.y + h * (0.7 + 0.45 * t), z: p.pos.z + fz * 0.25 };
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

function updateHeldBall(state: GameState): void {
  const holder = state.players[state.ball.holderId];
  state.ball.pos = heldBallPosition(holder);
  state.ball.vel = { ...holder.vel };
}

function updateFreeBall(state: GameState): void {
  const b = state.ball;
  const h = DT / BALL_SUBSTEPS;
  for (let i = 0; i < BALL_SUBSTEPS; i++) {
    b.vel.y -= GRAVITY * h;
    const prevY = b.pos.y;
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    b.pos.z += b.vel.z * h;
    collideFloorAndWalls(state, h);
    collideHoop(state, HOOP_X, prevY);
    collideHoop(state, -HOOP_X, prevY);
  }
}

function becomeLoose(state: GameState): void {
  if (state.ball.mode === 'flight') state.ball.mode = 'loose';
}

function collideFloorAndWalls(state: GameState, h: number): void {
  const b = state.ball;
  if (b.pos.y < BALL_RADIUS) {
    b.pos.y = BALL_RADIUS;
    if (b.vel.y < 0) {
      const speed = -b.vel.y;
      b.vel.y = speed < 0.5 ? 0 : speed * 0.78;
      b.vel.x *= 0.92;
      b.vel.z *= 0.92;
      if (speed > 0.8) state.events.push({ type: 'bounce', pos: { ...b.pos }, speed });
    }
    becomeLoose(state);
  }
  if (b.pos.y <= BALL_RADIUS + 1e-3 && b.vel.y === 0) {
    const f = Math.max(0, 1 - 1.2 * h);
    b.vel.x *= f;
    b.vel.z *= f;
  }
  const wx = COURT.halfLength + WALL_MARGIN;
  const wz = COURT.halfWidth + WALL_MARGIN;
  if (Math.abs(b.pos.x) > wx) {
    b.pos.x = Math.sign(b.pos.x) * wx;
    b.vel.x *= -0.5;
  }
  if (Math.abs(b.pos.z) > wz) {
    b.pos.z = Math.sign(b.pos.z) * wz;
    b.vel.z *= -0.5;
  }
}

function collideHoop(state: GameState, hoopX: number, prevY: number): void {
  const b = state.ball;
  const shot = b.shot;
  const s = Math.sign(hoopX);
  const cleanMake = !!shot && shot.willMake && !shot.scored && shot.hoopX === hoopX;

  // Backboard front face is the plane x = s * BOARD_X, facing the court.
  const faceX = s * BOARD_X;
  const depth = s * (b.pos.x - faceX) + BALL_RADIUS;
  if (
    depth > 0 &&
    depth < 0.3 &&
    s * b.vel.x > 0 &&
    Math.abs(b.pos.z) < HOOP.boardHalfWidth + 0.05 &&
    b.pos.y > HOOP.boardBottom - 0.05 &&
    b.pos.y < HOOP.boardTop + 0.05
  ) {
    b.pos.x -= s * depth;
    const speed = Math.abs(b.vel.x);
    b.vel.x = -b.vel.x * 0.55;
    state.events.push({ type: 'board', pos: { ...b.pos }, speed });
    becomeLoose(state);
  }

  // Rim: collide with the nearest point on the ring.
  if (!cleanMake) {
    const dx = b.pos.x - hoopX;
    const dz = b.pos.z;
    const hd = Math.hypot(dx, dz) || 1e-6;
    const nx = b.pos.x - (hoopX + (dx / hd) * HOOP.rimRadius);
    const ny = b.pos.y - HOOP.rimHeight;
    const nz = b.pos.z - (dz / hd) * HOOP.rimRadius;
    const d = Math.hypot(nx, ny, nz);
    const minD = BALL_RADIUS + HOOP.rimTube;
    if (d < minD && d > 1e-6) {
      const ux = nx / d;
      const uy = ny / d;
      const uz = nz / d;
      b.pos.x += ux * (minD - d);
      b.pos.y += uy * (minD - d);
      b.pos.z += uz * (minD - d);
      const vn = b.vel.x * ux + b.vel.y * uy + b.vel.z * uz;
      if (vn < 0) {
        b.vel.x = (b.vel.x - 1.55 * vn * ux) * 0.9;
        b.vel.y = (b.vel.y - 1.55 * vn * uy) * 0.9;
        b.vel.z = (b.vel.z - 1.55 * vn * uz) * 0.9;
        if (-vn > 0.4) state.events.push({ type: 'rim', pos: { ...b.pos }, speed: -vn });
        if (shot) shot.touchedRim = true;
        becomeLoose(state);
      }
    }
  }

  // Ball centre passing down through the ring.
  const ringDist = Math.hypot(b.pos.x - hoopX, b.pos.z);
  if (prevY >= HOOP.rimHeight && b.pos.y < HOOP.rimHeight && b.vel.y < 0 && ringDist < HOOP.rimRadius) {
    if (cleanMake && shot) {
      scoreBasket(state);
    } else if (!shot?.scored) {
      // Misses (and stray loose balls) are not allowed to drop in: pop out over the rim.
      const a = nextRandom(state) * Math.PI * 2;
      const ox = ringDist > 0.02 ? (b.pos.x - hoopX) / ringDist : Math.cos(a);
      const oz = ringDist > 0.02 ? b.pos.z / ringDist : Math.sin(a);
      b.pos.y = HOOP.rimHeight;
      b.vel.y = Math.abs(b.vel.y) * 0.35 + 0.8;
      b.vel.x = ox * 1.3;
      b.vel.z = oz * 1.3;
      state.events.push({ type: 'rim', pos: { ...b.pos }, speed: 1.5 });
      if (shot) shot.touchedRim = true;
      becomeLoose(state);
    }
  }
}

function scoreBasket(state: GameState): void {
  const b = state.ball;
  const shot = b.shot!;
  shot.scored = true;
  state.score[shot.team] += shot.points;
  const shooter = state.players[shot.shooterId];
  shooter.stats.pts += shot.points;
  shooter.stats.fgm++;
  if (shot.points === 3) shooter.stats.tpm++;
  b.vel.x *= 0.15;
  b.vel.z *= 0.15;
  b.vel.y = Math.min(b.vel.y, -1);
  b.mode = 'loose';
  state.events.push({
    type: 'score',
    playerId: shot.shooterId,
    team: shot.team,
    points: shot.points,
    swish: !shot.touchedRim,
    hoopX: shot.hoopX,
  });
}

function tryPickup(state: GameState): void {
  const b = state.ball;
  let best: PlayerState | null = null;
  let bestD = PICKUP_RADIUS;
  for (const p of state.players) {
    if (p.pickupCooldown > 0 || p.action === 'shooting') continue;
    if (b.pos.y > p.pos.y + p.info.heightM * 1.3) continue;
    const d = Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (!best) return;
  const rebound = !!b.shot && !b.shot.scored;
  if (rebound) best.stats.reb++;
  best.dribblePhase = 0;
  giveBall(state, best.id);
  state.events.push({ type: 'pickup', playerId: best.id, rebound });
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
