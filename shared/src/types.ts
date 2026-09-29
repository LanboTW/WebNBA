export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0–100 scale. */
export interface Ratings {
  speed: number;
  jump: number;
  close: number;
  mid: number;
  three: number;
  handle: number;
}

export interface PlayerInfo {
  name: string;
  number: number;
  heightM: number;
  position: string;
  ratings: Ratings;
}

export interface PlayerStats {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  reb: number;
}

export type PlayerAction = 'normal' | 'shooting' | 'release';
export type ShotKind = 'jumper' | 'layup';
export type ShotQuality = 'perfect' | 'good' | 'early' | 'late';

export interface PlayerState {
  id: number;
  team: 0 | 1;
  info: PlayerInfo;
  pos: Vec3;
  vel: Vec3;
  facing: number;
  onGround: boolean;
  action: PlayerAction;
  shotKind: ShotKind;
  shotTimer: number;
  /** 0..~1.15 while shooting; the sweet spot is SHOT_SWEET. -1 when not shooting. */
  shotMeter: number;
  shotJumped: boolean;
  shotFrom: Vec3;
  dribblePhase: number;
  pickupCooldown: number;
  lastShoot: boolean;
  lastJump: boolean;
  stats: PlayerStats;
}

export interface ShotInfo {
  shooterId: number;
  team: 0 | 1;
  hoopX: number;
  points: 2 | 3;
  willMake: boolean;
  quality: ShotQuality;
  chance: number;
  touchedRim: boolean;
  scored: boolean;
}

export type BallMode = 'held' | 'flight' | 'loose';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  mode: BallMode;
  holderId: number;
  shot: ShotInfo | null;
}

export type GameEvent =
  | { type: 'dribble'; pos: Vec3 }
  | { type: 'bounce'; pos: Vec3; speed: number }
  | { type: 'rim'; pos: Vec3; speed: number }
  | { type: 'board'; pos: Vec3; speed: number }
  | { type: 'shot'; playerId: number; quality: ShotQuality; points: 2 | 3; chance: number }
  | { type: 'score'; playerId: number; team: 0 | 1; points: 2 | 3; swish: boolean; hoopX: number }
  | { type: 'pickup'; playerId: number; rebound: boolean };

export interface GameState {
  tick: number;
  rng: number;
  players: PlayerState[];
  ball: BallState;
  score: [number, number];
  events: GameEvent[];
}

export interface PlayerInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  shoot: boolean;
  jump: boolean;
}

export const NO_INPUT: PlayerInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false, jump: false };
