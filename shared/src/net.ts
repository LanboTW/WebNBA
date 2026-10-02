import { ROSTER_VERSION } from './roster';
import { nearestToBall } from './rules';
import type { Difficulty, GameEvent, GameState, PlayerInput, RuleToggles, TeamInfo } from './types';

/**
 * Wire format version plus the roster fingerprint: a page left open across a
 * roster update is told to reload instead of joining with mismatched players.
 */
export const PROTOCOL_VERSION = `3-${ROSTER_VERSION}`;
export const SNAPSHOT_HZ = 20;
/** A disconnected player's seat is held this long; the AI plays meanwhile. */
export const REJOIN_SECONDS = 60;
export const ROOM_CODE_LENGTH = 6;
/** No look-alike characters (0/O, 1/I/L). */
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Settings the host picks when creating a room. */
export interface RoomSettings {
  quarterSeconds: number;
  difficulty: Difficulty;
  rules: RuleToggles;
}

export interface SeatInfo {
  /** Team abbreviation this player picked (both may pick the same team). */
  abbr: string;
  name: string;
  /** Somebody holds the seat (connected, or within the rejoin window). */
  taken: boolean;
  connected: boolean;
  /** Seconds left to rejoin while disconnected. */
  rejoinLeft: number;
}

export interface RoomInfo {
  code: string;
  settings: RoomSettings;
  /** Seat 0 is the host and the home team. */
  seats: [SeatInfo, SeatInfo];
  started: boolean;
}

export type ClientMessage =
  | { t: 'create'; v: string; name: string; abbr: string; settings: RoomSettings }
  | { t: 'join'; v: string; code: string; name: string; abbr?: string; token?: string }
  | { t: 'pickTeam'; abbr: string }
  | { t: 'start' }
  | { t: 'input'; seq: number; input: PlayerInput }
  | { t: 'sub'; slotId: number; rosterIdx: number }
  | { t: 'cancelSub'; slotId: number }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'joined'; code: string; seat: 0 | 1; token: string; room: RoomInfo }
  | { t: 'room'; room: RoomInfo }
  | { t: 'start'; seat: 0 | 1; teams: [string, string]; state: string; room: RoomInfo }
  | {
      t: 'snap';
      tick: number;
      /** Last input sequence number the server applied for this client. */
      ack: number;
      state: string;
      /** Latest input the server holds for each team (to predict the other human). */
      inputs: [PlayerInput | null, PlayerInput | null];
      events: GameEvent[];
    }
  | { t: 'error'; msg: string }
  | { t: 'closed'; msg: string };

/**
 * Full state for the wire. Player and bench `info` is dropped (the receiver
 * rebuilds it from the roster by rosterIdx) along with the per-tick events.
 * Plain JSON round-trips numbers exactly, so a decoded state steps identically.
 */
export function encodeState(state: GameState): string {
  return JSON.stringify(state, (key, value) => (key === 'info' || key === 'events' ? undefined : value));
}

export function decodeState(json: string, teams: [TeamInfo, TeamInfo]): GameState {
  const state = JSON.parse(json) as GameState;
  state.events = [];
  for (const p of state.players) p.info = teams[p.team].players[p.rosterIdx];
  for (const team of [0, 1] as const) {
    for (const b of state.bench[team]) b.info = teams[team].players[b.rosterIdx];
  }
  return state;
}

/** Hand a team to a human (rejoin) or to the AI (disconnect). */
export function setHuman(state: GameState, team: 0 | 1, human: boolean): void {
  const humans = state.settings.humanTeams.filter((t) => t !== team);
  if (human) humans.push(team);
  state.settings.humanTeams = humans.sort();
  state.switchLatch[team] = false;
  state.timeoutLatch[team] = false;
  if (state.timeout) state.timeout.ready = state.timeout.ready.filter((t) => t !== team);
  const current = state.players[state.controlled[team]];
  if (current) current.lastShoot = current.lastJump = current.lastPass = false;
  state.controlled[team] = human && state.players.some((p) => p.team === team) ? nearestToBall(state, team).id : -1;
}

export function randomRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_CHARS[Math.floor(random() * ROOM_CODE_CHARS.length)];
  return code;
}

export function normaliseRoomCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}
