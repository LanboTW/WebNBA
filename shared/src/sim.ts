import { aiInput, callScreen } from './ai';
import { PLAY_KINDS, startPlay, updatePlays } from './plays';
import { giveBall, updateBall } from './ball';
import { updateEnergy } from './bench';
import { BALL_RADIUS, DT, SHOT_CLOCK, attackHoop } from './constants';
import { hdist, resolveCollisions, updatePlayer } from './players';
import { TIMEOUTS_PER_GAME, handleTimeoutInput, isHuman, startPeriod, updateRules } from './rules';
import {
  NO_INPUT,
  type GameSettings,
  type GameState,
  type PlayerInput,
  type PlayerState,
  type TeamInfo,
} from './types';

export { giveBall } from './ball';
export { RESTED, TIRED, cancelSub, overall, requestSub } from './bench';
export { FOUL_OUT, fouledOut, inBonus, startFreeThrows } from './fouls';
export { canDunk, choosePassTarget, heldBallPosition, passIcons, runSpeed } from './players';
export { TIMEOUT_SECONDS, TIMEOUTS_PER_GAME, canCallTimeout, callTimeout, inPaint } from './rules';

export interface GameSetup {
  teams: [TeamInfo, TeamInfo];
  settings?: Partial<GameSettings>;
  /** Players on court per team (default 5). Practice drills use fewer. */
  playersPerTeam?: [number, number];
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'game',
  quarterSeconds: 180,
  difficulty: 'normal',
  humanTeams: [0],
  seed: 20260930,
  rules: { fouls: true, violations: true, fatigue: true },
};

const emptyStats = (): PlayerState['stats'] => ({
  secs: 0,
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  oreb: 0,
  dreb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  ftm: 0,
  fta: 0,
  pf: 0,
});

function newPlayer(id: number, team: 0 | 1, slot: number, info: TeamInfo['players'][number]): PlayerState {
  return {
    id,
    team,
    slot,
    info,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    facing: team === 0 ? Math.PI / 2 : -Math.PI / 2,
    onGround: true,
    action: 'normal',
    shotKind: 'jumper',
    shotTimer: 0,
    shotMeter: -1,
    shotJumped: false,
    shotFrom: { x: 0, y: 0, z: 0 },
    dribblePhase: 0,
    dribbleDead: false,
    intenseD: false,
    pickupCooldown: 0,
    stealCooldown: 0,
    lastShoot: false,
    lastJump: false,
    lastPass: false,
    ai: { mode: 'none', modeTimer: 0, decisionTimer: 0, shotTarget: 0.85, screenSide: 1, arrived: false },
    stats: emptyStats(),
    rosterIdx: slot,
    energy: 1,
    paintTime: 0,
    contactCooldown: 0,
    catchHold: 0,
    queuedPass: -1,
  };
}

export function createGame(setup: GameSetup): GameState {
  const settings: GameSettings = {
    ...DEFAULT_SETTINGS,
    ...setup.settings,
    rules: { ...DEFAULT_SETTINGS.rules, ...setup.settings?.rules },
  };
  const counts = setup.playersPerTeam ?? [5, 5];
  const players: PlayerState[] = [];
  ([0, 1] as const).forEach((team) => {
    setup.teams[team].players.slice(0, counts[team]).forEach((info, slot) => {
      players.push(newPlayer(players.length, team, slot, info));
    });
  });
  const bench = ([0, 1] as const).map((team) =>
    counts[team] >= 5
      ? setup.teams[team].players.slice(counts[team]).map((info, i) => ({
          rosterIdx: counts[team] + i,
          info,
          stats: emptyStats(),
          energy: 1,
        }))
      : [],
  ) as GameState['bench'];
  // Everyone guards the opponent in the same lineup slot.
  const assign = players.map((p) => players.find((o) => o.team !== p.team && o.slot === p.slot)?.id ?? -1);

  const state: GameState = {
    tick: 0,
    rng: settings.seed,
    settings,
    teamAbbr: [setup.teams[0].abbr, setup.teams[1].abbr],
    players,
    ball: {
      pos: { x: 0, y: BALL_RADIUS, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      mode: 'loose',
      holderId: -1,
      shot: null,
      pass: null,
      lastTouchTeam: 0,
      assist: null,
      strippedBy: -1,
      strippedFrom: -1,
    },
    score: [0, 0],
    period: 1,
    gameClock: settings.quarterSeconds,
    shotClock: SHOT_CLOCK,
    shotClockOn: false,
    possession: 0,
    phase: 'live',
    phaseTimer: 0,
    inbound: null,
    pendingInbound: null,
    pendingFT: null,
    freeThrow: null,
    timeout: null,
    timeoutsLeft: [TIMEOUTS_PER_GAME, TIMEOUTS_PER_GAME],
    teamFouls: [0, 0],
    lateFouls: [0, 0],
    bench,
    subQueue: [],
    frontcourt: false,
    backcourtTimer: 0,
    clockHold: false,
    run: { team: 0, pts: 0 },
    timeoutLatch: [false, false],
    pendingEnd: false,
    tipWinner: 0,
    controlled: [-1, -1],
    switchLatch: [false, false],
    assign,
    ballCall: null,
    plays: [null, null],
    events: [],
  };
  for (const team of [0, 1] as const) {
    const first = players.find((p) => p.team === team);
    if (isHuman(state, team) && first) state.controlled[team] = first.id;
  }

  if (settings.mode === 'practice') {
    const first = players[0];
    if (first) giveBall(state, first.id);
  } else {
    startPeriod(state, 1);
  }
  return state;
}

/** Place a player for drills and tests. */
export function placePlayer(state: GameState, id: number, x: number, z: number): void {
  const p = state.players[id];
  p.pos = { x, y: 0, z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.facing = Math.atan2(attackHoop(state, p.team) - x, -z);
  if (state.ball.mode === 'held' && state.ball.holderId === id) giveBall(state, id);
}

/**
 * Advance one fixed tick. `inputs` is keyed by team: each human team's input
 * drives whichever player that team currently controls.
 */
export function step(state: GameState, inputs: Partial<Record<0 | 1, PlayerInput>>): void {
  state.events = [];
  state.tick++;
  lockSolo(state);
  if (soloHuman(state)) handleSoloCalls(state, inputs[0]);
  else handleSwitching(state, inputs);
  handlePlayCalls(state, inputs);
  updatePlays(state);
  if (state.ballCall && (state.ballCall.timer -= DT) <= 0) state.ballCall = null;
  if (state.settings.mode === 'game') handleTimeoutInput(state, inputs);

  const frozen =
    state.phase === 'tipoff' || state.phase === 'periodEnd' || state.phase === 'final' || state.phase === 'timeout';
  const ftShooter = state.phase === 'freeThrow' ? state.freeThrow?.shooterId : undefined;
  for (const p of state.players) {
    let inp: PlayerInput;
    // Only the shooter acts during free throws; everyone else waits on the lane.
    if (frozen || (ftShooter !== undefined && p.id !== ftShooter)) inp = NO_INPUT;
    else if (state.controlled[p.team] === p.id) inp = humanInput(state, p, inputs[p.team] ?? NO_INPUT);
    else inp = aiInput(state, p);
    updatePlayer(state, p, inp);
  }
  resolveCollisions(state);
  updateBall(state);
  updateRules(state);
  updateEnergy(state);
  lockSolo(state);
}

/** A person is playing the solo player (a played-out game keeps his minutes plan but not the lock). */
function soloHuman(state: GameState): boolean {
  return state.settings.solo !== undefined && state.settings.humanTeams.includes(0);
}

/**
 * A pass on its way to the person's player: he goes to meet it on his own
 * (as AI receivers do), so passes don't get past him. A pass pressed meanwhile
 * still counts (it is thrown on the catch).
 */
function humanInput(state: GameState, p: PlayerState, inp: PlayerInput): PlayerInput {
  const pass = state.ball.mode === 'pass' ? state.ball.pass : null;
  if (!pass || pass.targetId !== p.id || pass.intercepted) return inp;
  return { ...aiInput(state, p), pass: inp.pass, timeout: inp.timeout, switchPlayer: inp.switchPlayer };
}

/** Solo games: the controls stay on your player (none while he sits). */
function lockSolo(state: GameState): void {
  const solo = state.settings.solo;
  if (solo === undefined || !soloHuman(state)) return;
  state.controlled[0] = state.players.find((p) => p.team === 0 && p.rosterIdx === solo)?.id ?? -1;
}

/** Your player alone has the switch button: with the ball it calls a pick, on defence a switch. */
function handleSoloCalls(state: GameState, inp: PlayerInput | undefined): void {
  const pressed = !!inp?.switchPlayer;
  const edge = pressed && !state.switchLatch[0];
  state.switchLatch[0] = pressed;
  const me = state.players[state.controlled[0]];
  if (!edge || !me || state.phase !== 'live') return;
  const b = state.ball;
  const holder = b.mode === 'held' ? state.players[b.holderId] : null;
  if (holder === me) {
    state.events.push({ type: 'call', kind: 'pick', playerId: me.id, ok: callScreen(state, me) });
  } else if (holder && holder.team !== me.team) {
    state.events.push({ type: 'call', kind: 'switch', playerId: me.id, ok: callSwitch(state, me) });
  }
}

/** A person calls a play (1-5): run around the ball, or for them when they are off it. */
function handlePlayCalls(state: GameState, inputs: Partial<Record<0 | 1, PlayerInput>>): void {
  for (const team of state.settings.humanTeams) {
    const kind = PLAY_KINDS[(inputs[team]?.play ?? 0) - 1];
    if (!kind) continue;
    const me = state.players[state.controlled[team]] ?? null;
    const ok = startPlay(state, team, kind, me);
    state.events.push({ type: 'call', kind: 'play', playerId: me?.id ?? -1, ok, play: kind });
  }
}

/** Trade men with the teammate whose man is closest to you. */
function callSwitch(state: GameState, me: PlayerState): boolean {
  const mine = state.assign[me.id];
  let best: PlayerState | null = null;
  let bestD = Infinity;
  for (const t of state.players) {
    if (t.team !== me.team || t === me) continue;
    const man = state.players[state.assign[t.id]];
    if (!man || man.id === mine) continue;
    const d = hdist(man.pos, me.pos);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (!best || bestD > 4) return false;
  state.assign[me.id] = state.assign[best.id];
  state.assign[best.id] = mine;
  return true;
}

/** Switch button: jump to the teammate nearest the ball (next nearest if already there). */
function handleSwitching(state: GameState, inputs: Partial<Record<0 | 1, PlayerInput>>): void {
  for (const team of state.settings.humanTeams) {
    const pressed = !!inputs[team]?.switchPlayer;
    const edge = pressed && !state.switchLatch[team];
    state.switchLatch[team] = pressed;
    if (!edge) continue;
    const b = state.ball;
    if (b.mode === 'held' && state.players[b.holderId].team === team) continue;
    const current = state.controlled[team];
    const ranked = state.players
      .filter((p) => p.team === team)
      .sort((a, c) => hdist(a.pos, b.pos) - hdist(c.pos, b.pos));
    if (!ranked.length) continue;
    const next = ranked[0].id === current && ranked[1] ? ranked[1] : ranked[0];
    // Hand the old player back to the AI cleanly.
    const old = state.players[current];
    if (old) {
      old.lastShoot = old.lastJump = old.lastPass = false;
    }
    state.controlled[team] = next.id;
  }
}
