import { BALL_RADIUS, BOARD_X, COURT, DT, GRAVITY, HOOP, HOOP_X, OREB_SHOT_CLOCK } from './constants';
import { shootingFoul } from './fouls';
import { CATCH_HOLD, hdist, heldBallPosition } from './players';
import { nextRandom } from './rng';
import { onGainBall, onMadeBasket } from './rules';
import type { GameState, PlayerState } from './types';

const BALL_SUBSTEPS = 4;
const PICKUP_RADIUS = 0.65;
const WALL_MARGIN = 3;

export function giveBall(state: GameState, playerId: number): void {
  const b = state.ball;
  b.mode = 'held';
  b.holderId = playerId;
  b.shot = null;
  b.pass = null;
  b.strippedBy = -1;
  b.strippedFrom = -1;
  b.vel = { x: 0, y: 0, z: 0 };
  const p = state.players[playerId];
  p.dribbleDead = false;
  b.lastTouchTeam = p.team;
  b.pos = heldBallPosition(state, p);
}

export function updateBall(state: GameState): void {
  const b = state.ball;
  if (b.mode === 'held') {
    const holder = state.players[b.holderId];
    b.pos = heldBallPosition(state, holder);
    b.vel = { ...holder.vel };
    return;
  }
  if (b.mode === 'pass') homePass(state);
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
  if (b.mode === 'pass') tryCatch(state);
  else if (b.mode === 'flight' && state.phase === 'live') checkBlocks(state);
  if (b.mode === 'loose' || b.mode === 'flight') rollOffRim(state);
  if (b.mode === 'loose' && (state.phase === 'live' || state.settings.mode === 'practice')) tryPickup(state);
}

/**
 * A pass bends toward where its receiver actually is (he may have changed
 * direction since it was thrown), keeping its pace, so passes don't sail out
 * of bounds past a receiver who cut the other way.
 */
function homePass(state: GameState): void {
  const b = state.ball;
  const r = state.players[b.pass!.targetId];
  const dx = r.pos.x - b.pos.x;
  const dz = r.pos.z - b.pos.z;
  const d = Math.hypot(dx, dz);
  const v = Math.hypot(b.vel.x, b.vel.z);
  if (d < 0.05 || v < 0.1) return;
  // Only while it is still on its way: a ball that has gone past him must not turn back.
  if (b.vel.x * dx + b.vel.z * dz <= 0) return;
  const k = Math.min(1, 6 * DT);
  const vx = b.vel.x + ((dx / d) * v - b.vel.x) * k;
  const vz = b.vel.z + ((dz / d) * v - b.vel.z) * k;
  const l = Math.hypot(vx, vz) || 1;
  b.vel.x = (vx / l) * v;
  b.vel.z = (vz / l) * v;
}

/**
 * A ball that comes to rest on top of the rim would sit there forever:
 * nudge it off, away from the middle of the hoop.
 */
function rollOffRim(state: GameState): void {
  const b = state.ball;
  // A shot on its way in is left alone, however slowly it rolls.
  if (b.shot?.willMake && !b.shot.scored && b.mode === 'flight') return;
  if (Math.hypot(b.vel.x, b.vel.y, b.vel.z) > 0.8) return;
  for (const hoopX of [HOOP_X, -HOOP_X]) {
    const dx = b.pos.x - hoopX;
    const ring = Math.hypot(dx, b.pos.z);
    if (Math.abs(ring - HOOP.rimRadius) > BALL_RADIUS + HOOP.rimTube + 0.03) continue;
    if (b.pos.y < HOOP.rimHeight || b.pos.y > HOOP.rimHeight + BALL_RADIUS + HOOP.rimTube + 0.05) continue;
    const a = ring > 0.02 ? Math.atan2(b.pos.z, dx) : nextRandom(state) * Math.PI * 2;
    // Off the outside of the rim, so it can't drop in as a basket.
    b.vel.x = Math.cos(a) * 1.4;
    b.vel.z = Math.sin(a) * 1.4;
    b.vel.y = Math.max(b.vel.y, 0.6);
    if (ring < HOOP.rimRadius) b.pos.y = Math.max(b.pos.y, HOOP.rimHeight + BALL_RADIUS + HOOP.rimTube + 0.01);
    becomeLoose(state);
    return;
  }
}

function becomeLoose(state: GameState): void {
  const b = state.ball;
  if (b.mode === 'flight' || b.mode === 'pass') {
    b.mode = 'loose';
    b.pass = null;
  }
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
  const cleanMake = !!shot && shot.willMake && !shot.scored && shot.hoopX === hoopX && b.mode === 'flight';

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
        touchRim(state);
        becomeLoose(state);
      }
    }
  }

  // Ball centre passing down through the ring.
  const ringDist = Math.hypot(b.pos.x - hoopX, b.pos.z);
  if (prevY >= HOOP.rimHeight && b.pos.y < HOOP.rimHeight && b.vel.y < 0 && ringDist < HOOP.rimRadius) {
    if (cleanMake) {
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
      touchRim(state);
      becomeLoose(state);
    }
  }
}

function touchRim(state: GameState): void {
  const shot = state.ball.shot;
  if (!shot || shot.touchedRim) return;
  shot.touchedRim = true;
  // The shot clock stops on a rim touch and is reset when someone secures the ball.
  if (state.settings.mode === 'game') state.shotClockOn = false;
}

function scoreBasket(state: GameState): void {
  const b = state.ball;
  b.shot!.scored = true;
  b.vel.x *= 0.15;
  b.vel.z *= 0.15;
  b.vel.y = Math.min(b.vel.y, -1);
  b.mode = 'loose';
  onMadeBasket(state);
}

function checkBlocks(state: GameState): void {
  const b = state.ball;
  const shot = b.shot;
  if (!shot || shot.blocked || state.tick - shot.releaseTick > 14) return;
  const shooter = state.players[shot.shooterId];
  for (const o of state.players) {
    if (o.team === shot.team || o.onGround || shot.blockChecked.includes(o.id)) continue;
    if (hdist(o.pos, b.pos) > 0.75) continue;
    if (b.pos.y > o.pos.y + o.info.heightM * 1.33 + 0.15) continue;
    shot.blockChecked.push(o.id);
    const chance =
      Math.min(0.6, Math.max(0.03, 0.05 + o.info.ratings.block * 0.004 + (o.info.heightM - shooter.info.heightM) * 0.3)) *
      (shot.kind === 'dunk' ? 0.5 : 1);
    if (nextRandom(state) >= chance) {
      // Went for the block and got arm instead.
      if (nextRandom(state) < 0.08) {
        shootingFoul(state, shot, o);
        return;
      }
      continue;
    }
    shot.blocked = true;
    shot.willMake = false;
    const dx = b.pos.x - shot.hoopX;
    const dz = b.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const side = (nextRandom(state) - 0.5) * 2;
    b.vel = { x: (dx / l) * 3 - (dz / l) * side, y: -1, z: (dz / l) * 3 + (dx / l) * side };
    b.mode = 'loose';
    b.lastTouchTeam = o.team;
    o.stats.blk++;
    state.events.push({ type: 'block', playerId: o.id, shooterId: shooter.id });
    return;
  }
}

function tryCatch(state: GameState): void {
  const b = state.ball;
  const pass = b.pass!;
  const r = state.players[pass.targetId];
  const radius = pass.intercepted ? 1.0 : 0.8;
  if (hdist(b.pos, r.pos) > radius) return;
  // The intended receiver reaches up for a pass a little high rather than letting it sail.
  const reach = pass.intercepted ? 1.3 : 1.5;
  if (b.pos.y > r.pos.y + r.info.heightM * reach || b.pos.y < 0.2) return;
  if (r.action === 'shooting') return;
  const passer = state.players[pass.passerId];
  const prevTouch = b.lastTouchTeam;
  giveBall(state, r.id);
  r.dribblePhase = 0;
  r.catchHold = CATCH_HOLD;
  if (pass.intercepted) {
    r.stats.stl++;
    passer.stats.tov++;
    state.events.push({ type: 'steal', playerId: r.id, fromId: passer.id });
    state.events.push({ type: 'turnover', team: passer.team, reason: 'intercept', playerId: passer.id });
  } else {
    b.assist = { passerId: passer.id, receiverId: r.id, tick: state.tick };
  }
  onGainBall(state, r, prevTouch);
}

function tryPickup(state: GameState): void {
  const b = state.ball;
  let best: PlayerState | null = null;
  let bestScore = PICKUP_RADIUS;
  for (const p of state.players) {
    if (p.pickupCooldown > 0 || p.action === 'shooting') continue;
    if (b.pos.y > p.pos.y + p.info.heightM * 1.3) continue;
    const d = hdist(b.pos, p.pos);
    if (d > PICKUP_RADIUS) continue;
    // Better rebounders and players in the air win close contests.
    const score = d - p.info.ratings.rebound * 0.003 - (p.onGround ? 0 : 0.15);
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return;
  const shot = b.shot;
  const rebound = !!shot && !shot.scored;
  if (rebound) {
    if (best.team === shot.team) best.stats.oreb++;
    else best.stats.dreb++;
  }
  const stripper = b.strippedBy >= 0 ? state.players[b.strippedBy] : null;
  const stripped = b.strippedFrom >= 0 ? state.players[b.strippedFrom] : null;
  if (stripper && stripped && best.team === stripper.team) {
    stripper.stats.stl++;
    stripped.stats.tov++;
    state.events.push({ type: 'steal', playerId: stripper.id, fromId: stripped.id });
    state.events.push({ type: 'turnover', team: stripped.team, reason: 'steal', playerId: stripped.id });
  }
  const offensiveReset = rebound && shot.touchedRim && best.team === shot.team;
  const prevTouch = b.lastTouchTeam;
  best.dribblePhase = 0;
  giveBall(state, best.id);
  state.events.push({ type: 'pickup', playerId: best.id, rebound });
  onGainBall(state, best, prevTouch);
  if (offensiveReset && state.settings.mode === 'game') state.shotClock = Math.max(state.shotClock, OREB_SHOT_CLOCK);
}
