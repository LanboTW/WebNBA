export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 0-100 scale. Order matches RATING_KEYS in the roster JSON. */
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
  /** Menu group for custom teams (historical, Taiwan, fun...); NBA teams have none. */
  group?: string;
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
  ftm: number;
  fta: number;
  /** Personal fouls. */
  pf: number;
}

export type PlayerAction = 'normal' | 'shooting' | 'release';
export type ShotKind = 'jumper' | 'layup' | 'dunk' | 'free';
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
  /** Lineup slot 0-4 (PG, SG, SF, PF, C). */
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
  /** Picked up the dribble (jumped with the ball): may pivot, pass or shoot, but not move or dribble. */
  dribbleDead: boolean;
  /** Holding the intense-defence button this tick. */
  intenseD: boolean;
  pickupCooldown: number;
  stealCooldown: number;
  lastShoot: boolean;
  lastJump: boolean;
  lastPass: boolean;
  ai: PlayerAi;
  stats: PlayerStats;
  /** Index into the team's roster (court slots keep their id when players are substituted). */
  rosterIdx: number;
  /** 0..1; drains while playing, recovers on the bench. */
  energy: number;
  /** Time spent in the painted area (offensive and defensive three seconds). */
  paintTime: number;
  /** Stops one collision from being called as several fouls. */
  contactCooldown: number;
}

/** A player on the bench: everything that follows a person when they sub in. */
export interface BenchPlayer {
  rosterIdx: number;
  info: PlayerInfo;
  stats: PlayerStats;
  energy: number;
}

export interface ShotInfo {
  shooterId: number;
  team: 0 | 1;
  hoopX: number;
  kind: ShotKind;
  points: 1 | 2 | 3;
  willMake: boolean;
  quality: ShotQuality;
  chance: number;
  releaseTick: number;
  touchedRim: boolean;
  scored: boolean;
  blocked: boolean;
  /** Defenders who already had their block roll on this shot. */
  blockChecked: number[];
  /** Defender who fouled the shooter (-1 if clean). */
  fouledBy: number;
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

export type Phase = 'tipoff' | 'live' | 'dead' | 'inbound' | 'freeThrow' | 'timeout' | 'periodEnd' | 'final';

export type TurnoverReason =
  | 'oob'
  | 'shotclock'
  | 'steal'
  | 'intercept'
  | 'offFoul'
  | 'threeSec'
  | 'eightSec'
  | 'backcourt'
  | 'fiveSec';

/** shooting / reach-in / blocking / charge (offensive) / illegal contact / defensive three seconds (technical). */
export type FoulKind = 'shooting' | 'reach' | 'block' | 'charge' | 'contact' | 'defThree';

export type GameEvent =
  | { type: 'dribble'; pos: Vec3 }
  | { type: 'bounce'; pos: Vec3; speed: number }
  | { type: 'rim'; pos: Vec3; speed: number }
  | { type: 'board'; pos: Vec3; speed: number }
  | { type: 'shot'; playerId: number; kind: ShotKind; quality: ShotQuality; points: 1 | 2 | 3; chance: number }
  | {
      type: 'score';
      playerId: number;
      team: 0 | 1;
      points: 1 | 2 | 3;
      kind: ShotKind;
      swish: boolean;
      hoopX: number;
      assistId: number;
    }
  | { type: 'pickup'; playerId: number; rebound: boolean }
  | { type: 'pass'; playerId: number; targetId: number }
  | { type: 'steal'; playerId: number; fromId: number }
  | { type: 'reach'; playerId: number }
  | { type: 'deadDribble'; playerId: number }
  | { type: 'block'; playerId: number; shooterId: number }
  | { type: 'turnover'; team: 0 | 1; reason: TurnoverReason; playerId: number }
  | { type: 'foul'; playerId: number; team: 0 | 1; onId: number; kind: FoulKind; shots: number; fouls: number; bonus: boolean }
  | { type: 'fouledOut'; team: 0 | 1; name: string }
  | { type: 'freeThrow'; shooterId: number; index: number; total: number }
  | { type: 'sub'; team: 0 | 1; slotId: number; inName: string; outName: string }
  | { type: 'timeout'; team: 0 | 1; left: number }
  | { type: 'timeoutEnd' }
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
  rules: RuleToggles;
}

/** Host-configurable rule groups. */
export interface RuleToggles {
  /** Fouls, free throws, bonus, fouling out. */
  fouls: boolean;
  /** Three seconds, eight seconds, backcourt, five-second inbound. */
  violations: boolean;
  /** Stamina drain and automatic substitutions. */
  fatigue: boolean;
}

export interface FreeThrowInfo {
  shooterId: number;
  team: 0 | 1;
  hoopX: number;
  total: number;
  /** 0-based attempt currently being taken. */
  index: number;
  timer: number;
  released: boolean;
  /** Technical free throws: the shooting team keeps the ball and inbounds here afterwards. */
  after: { team: 0 | 1; spot: Vec3 } | null;
}

/** What play resumes with once a timeout ends. */
export type Resume =
  | { kind: 'inbound'; team: 0 | 1; spot: Vec3 }
  | { kind: 'freeThrow'; shooterId: number; total: number; index: number; after: FreeThrowInfo['after'] };

export interface TimeoutInfo {
  team: 0 | 1;
  timer: number;
  limit: number;
  resume: Resume;
  /** Human teams that have pressed "continue". */
  ready: (0 | 1)[];
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
  /** Free throws awarded; taken once the ball is dead. */
  pendingFT: { shooterId: number; total: number; after: FreeThrowInfo['after'] } | null;
  freeThrow: FreeThrowInfo | null;
  timeout: TimeoutInfo | null;
  timeoutsLeft: [number, number];
  /** Team fouls this period, and those committed in the late-period window. */
  teamFouls: [number, number];
  lateFouls: [number, number];
  bench: [BenchPlayer[], BenchPlayer[]];
  /** Manual substitutions waiting for the next dead ball. */
  subQueue: { team: 0 | 1; slotId: number; rosterIdx: number }[];
  /** Offence has established the ball in the frontcourt (backcourt rule / 8 seconds). */
  frontcourt: boolean;
  backcourtTimer: number;
  /** Game clock waits for the ball to be touched (after a last free throw). */
  clockHold: boolean;
  /** Current unanswered scoring run, for AI timeouts. */
  run: { team: 0 | 1; pts: number };
  timeoutLatch: [boolean, boolean];
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
  /** Hold on defence: auto-shadow the ball handler (or your man) tightly. */
  intenseD: boolean;
  /** Call a timeout (or, during one, ready to continue). */
  timeout: boolean;
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
  intenseD: false,
  timeout: false,
};
