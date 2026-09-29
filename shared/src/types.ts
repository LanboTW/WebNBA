export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0??00 scale. Order matches RATING_KEYS in the roster JSON. */
export interface Ratings {
  speed: number;
  jump: number;
  close: number;
  mid: number;
  three: number;
  ft: number;
  handle: number;
  pass: number;
  steal: number;
  block: number;
  defense: number;
  rebound: number;
  stamina: number;
}

export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';

export interface PlayerInfo {
  name: string;
  number: number;
  heightM: number;
  position: Position;
  ratings: Ratings;
}

export interface TeamInfo {
  abbr: string;
  name: string;
  primary: string;
  secondary: string;
  /** First five are the starters. */
  players: PlayerInfo[];
}

export interface PlayerStats {
  secs: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
}

export type PlayerAction = 'normal' | 'shooting' | 'release';
export type ShotKind = 'jumper' | 'layup';
export type ShotQuality = 'perfect' | 'good' | 'early' | 'late';
export type Difficulty = 'easy' | 'normal' | 'hard';

export type AiMode = 'none' | 'drive' | 'cut' | 'screen' | 'roll';

/** Per-player AI memory. Lives in the state so the sim stays serialisable and deterministic. */
export interface PlayerAi {
  mode: AiMode;
  modeTimer: number;
  decisionTimer: number;
  shotTarget: number;
  screenSide: number;
  /** Screener has reached the screen spot. */
  arrived: boolean;
}

export interface PlayerState {
  id: number;
  team: 0 | 1;
  /** Lineup slot 0?? (PG, SG, SF, PF, C). */
  slot: number;
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
  stealCooldown: number;
  lastShoot: boolean;
  lastJump: boolean;
  lastPass: boolean;
  ai: PlayerAi;
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
  releaseTick: number;
  touchedRim: boolean;
  scored: boolean;
  blocked: boolean;
  /** Defenders who already had their block roll on this shot. */
  blockChecked: number[];
}

export interface PassInfo {
  passerId: number;
  targetId: number;
  team: 0 | 1;
  intercepted: boolean;
}

export type BallMode = 'held' | 'flight' | 'pass' | 'loose';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  mode: BallMode;
  holderId: number;
  shot: ShotInfo | null;
  pass: PassInfo | null;
  lastTouchTeam: 0 | 1;
  /** Last completed pass, for assists. */
  assist: { passerId: number; receiverId: number; tick: number } | null;
  /** Defender who knocked the ball loose; credited with a steal if their team recovers. */
  strippedBy: number;
  strippedFrom: number;
}

export type Phase = 'tipoff' | 'live' | 'dead' | 'inbound' | 'periodEnd' | 'final';

export type TurnoverReason = 'oob' | 'shotclock' | 'steal' | 'intercept';

export type GameEvent =
  | { type: 'dribble'; pos: Vec3 }
  | { type: 'bounce'; pos: Vec3; speed: number }
  | { type: 'rim'; pos: Vec3; speed: number }
  | { type: 'board'; pos: Vec3; speed: number }
  | { type: 'shot'; playerId: number; quality: ShotQuality; points: 2 | 3; chance: number }
  | { type: 'score'; playerId: number; team: 0 | 1; points: 2 | 3; swish: boolean; hoopX: number; assistId: number }
  | { type: 'pickup'; playerId: number; rebound: boolean }
  | { type: 'pass'; playerId: number; targetId: number }
  | { type: 'steal'; playerId: number; fromId: number }
  | { type: 'block'; playerId: number; shooterId: number }
  | { type: 'turnover'; team: 0 | 1; reason: TurnoverReason }
  | { type: 'possession'; team: 0 | 1 }
  | { type: 'tipoff' }
  | { type: 'buzzer' }
  | { type: 'periodEnd'; period: number }
  | { type: 'final'; winner: 0 | 1 };

export interface GameSettings {
  /** 'practice' disables clocks, possession rules and inbounds. */
  mode: 'game' | 'practice';
  quarterSeconds: number;
  difficulty: Difficulty;
  /** Teams driven by a human input stream; the rest are fully AI. */
  humanTeams: (0 | 1)[];
  seed: number;
}

export interface InboundInfo {
  team: 0 | 1;
  spot: Vec3;
  passerId: number;
}

export interface GameState {
  tick: number;
  rng: number;
  settings: GameSettings;
  teamAbbr: [string, string];
  players: PlayerState[];
  ball: BallState;
  score: [number, number];
  period: number;
  gameClock: number;
  shotClock: number;
  shotClockOn: boolean;
  possession: 0 | 1;
  phase: Phase;
  phaseTimer: number;
  inbound: InboundInfo | null;
  pendingInbound: { team: 0 | 1; spot: Vec3 } | null;
  /** Clock hit zero with a shot in the air; end the period once it resolves. */
  pendingEnd: boolean;
  tipWinner: 0 | 1;
  /** Player each human team currently controls (-1 for AI-only teams). */
  controlled: [number, number];
  /** Edge detection for each human team's switch button. */
  switchLatch: [boolean, boolean];
  /** Defensive assignment: player id -> opponent id they guard. */
  assign: number[];
  events: GameEvent[];
}

export interface PlayerInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  shoot: boolean;
  jump: boolean;
  /** Pass on offense, steal attempt on defense. */
  pass: boolean;
  /** Switch controlled player (defence / loose ball). */
  switchPlayer: boolean;
  /** AI only: explicit pass receiver. */
  passTarget?: number;
}

export const NO_INPUT: PlayerInput = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  shoot: false,
  jump: false,
  pass: false,
  switchPlayer: false,
};
