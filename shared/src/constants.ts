// World units are metres. x runs along the court length, z across it, y is up.
// Team 0 attacks the +x hoop in the first half and the -x hoop in the second.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const GRAVITY = 9.81;
export const BALL_RADIUS = 0.12;
export const PLAYER_RADIUS = 0.36;

export const SHOT_CLOCK = 24;
export const OREB_SHOT_CLOCK = 14;

export const COURT = {
  halfLength: 14.325,
  halfWidth: 7.62,
  keyWidth: 4.88,
  freeThrowFromBaseline: 5.8,
  centerCircleRadius: 1.83,
  restrictedRadius: 1.22,
  threeRadius: 7.24,
  threeCornerZ: 6.71,
} as const;

export const HOOP = {
  rimHeight: 3.05,
  rimRadius: 0.2286,
  rimTube: 0.012,
  fromBaseline: 1.575,
  boardFromBaseline: 1.22,
  boardHalfWidth: 0.915,
  boardBottom: 2.9,
  boardTop: 3.97,
} as const;

export const HOOP_X = COURT.halfLength - HOOP.fromBaseline;
export const BOARD_X = COURT.halfLength - HOOP.boardFromBaseline;
/** Distance along x from the hoop centre where the corner-three straight line meets the arc. */
export const THREE_CORNER_DX = Math.sqrt(COURT.threeRadius ** 2 - COURT.threeCornerZ ** 2);

/** Teams switch ends at halftime; overtime keeps the second-half ends. */
export function attackHoopX(team: 0 | 1, period = 1): number {
  const firstHalf = period <= 2;
  return (team === 0) === firstHalf ? HOOP_X : -HOOP_X;
}

export function isThreePoint(x: number, z: number, hoopX: number): boolean {
  if (Math.abs(hoopX - x) <= THREE_CORNER_DX) return Math.abs(z) >= COURT.threeCornerZ;
  return Math.hypot(x - hoopX, z) >= COURT.threeRadius;
}

export function isInBounds(x: number, z: number): boolean {
  return Math.abs(x) <= COURT.halfLength && Math.abs(z) <= COURT.halfWidth;
}

/** Defenders moving faster than this (m/s) are running, not set: they start to lose effectiveness. */
export const DEFENSE_SET_SPEED = 3;
