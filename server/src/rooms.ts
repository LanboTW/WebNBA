import { randomUUID } from 'node:crypto';
import {
  DT,
  NO_INPUT,
  PROTOCOL_VERSION,
  REJOIN_SECONDS,
  SNAPSHOT_HZ,
  TEAMS,
  cancelSub,
  createGame,
  encodeState,
  findTeam,
  normaliseRoomCode,
  randomRoomCode,
  requestSub,
  setHuman,
  step,
  type ClientMessage,
  type Difficulty,
  type GameEvent,
  type GameState,
  type PlayerInput,
  type RoomInfo,
  type RoomSettings,
  type ServerMessage,
  type TeamInfo,
} from '@webnba/shared';

/** One client connection, however it is transported. */
export interface Conn {
  send(msg: ServerMessage): void;
  close(): void;
}

/** Inputs the server holds before dropping the oldest (caps added latency). */
const MAX_QUEUE = 6;
/** Stop repeating a silent client's last input after this many ticks. */
const IDLE_TICKS = 10;
/** Finished games linger this long for the final box score, then close. */
const FINAL_LINGER = 300;

interface Seat {
  token: string | null;
  conn: Conn | null;
  name: string;
  abbr: string;
  /** Seconds since the socket dropped (while `token` still holds the seat). */
  awayFor: number;
  queue: { seq: number; input: PlayerInput }[];
  lastSeq: number;
  ack: number;
  last: PlayerInput;
  idle: number;
}

const emptySeat = (abbr: string): Seat => ({
  token: null,
  conn: null,
  name: '',
  abbr,
  awayFor: 0,
  queue: [],
  lastSeq: 0,
  ack: 0,
  last: NO_INPUT,
  idle: 0,
});

export class Room {
  readonly seats: [Seat, Seat];
  state: GameState | null = null;
  teams: [TeamInfo, TeamInfo] | null = null;
  private events: GameEvent[] = [];
  private finalFor = 0;

  constructor(
    readonly code: string,
    readonly settings: RoomSettings,
    hostAbbr: string,
  ) {
    this.seats = [emptySeat(hostAbbr), emptySeat(hostAbbr)];
  }

  info(): RoomInfo {
    return {
      code: this.code,
      settings: this.settings,
      started: !!this.state,
      seats: this.seats.map((s) => ({
        abbr: s.abbr,
        name: s.name,
        taken: !!s.token,
        connected: !!s.conn,
        rejoinLeft: s.token && !s.conn ? Math.max(0, Math.ceil(REJOIN_SECONDS - s.awayFor)) : 0,
      })) as RoomInfo['seats'],
    };
  }

  get empty(): boolean {
    return this.seats.every((s) => !s.token);
  }

  broadcastRoom(): void {
    const room = this.info();
    for (const s of this.seats) s.conn?.send({ t: 'room', room });
  }

  /** Put a connection in a seat, fresh or reclaimed. */
  seat(i: 0 | 1, conn: Conn, name: string, token?: string): void {
    const s = this.seats[i];
    if (s.conn && s.conn !== conn) s.conn.close();
    s.conn = conn;
    s.token = token ?? randomUUID();
    s.name = name;
    s.awayFor = 0;
    s.queue = [];
    s.idle = 0;
    conn.send({ t: 'joined', code: this.code, seat: i, token: s.token, room: this.info() });
    if (this.state) {
      setHuman(this.state, i, true);
      this.sendStart(i);
    }
    this.broadcastRoom();
  }

  /** Socket dropped: the AI plays this team until the player comes back. */
  disconnect(i: 0 | 1): void {
    const s = this.seats[i];
    s.conn = null;
    s.awayFor = 0;
    s.queue = [];
    if (this.state) setHuman(this.state, i, false);
    this.broadcastRoom();
  }

  /** Player left on purpose: free the seat straight away. */
  leave(i: 0 | 1): void {
    this.disconnect(i);
    this.seats[i].token = null;
    this.broadcastRoom();
  }

  start(): boolean {
    if (this.state || !this.seats[1].conn || !this.seats[0].conn) return false;
    this.teams = [findTeam(this.seats[0].abbr), findTeam(this.seats[1].abbr)];
    this.state = createGame({
      teams: this.teams,
      settings: {
        mode: 'game',
        humanTeams: [0, 1],
        quarterSeconds: this.settings.quarterSeconds,
        difficulty: this.settings.difficulty,
        rules: this.settings.rules,
        seed: (Math.random() * 2 ** 31) | 0,
      },
    });
    for (const i of [0, 1] as const) {
      this.seats[i].lastSeq = this.seats[i].ack = 0;
      if (this.seats[i].conn) this.sendStart(i);
    }
    this.broadcastRoom();
    return true;
  }

  private sendStart(i: 0 | 1): void {
    const s = this.seats[i];
    if (!this.state || !s.conn) return;
    // A rejoining client restarts its sequence numbers.
    s.lastSeq = s.ack = 0;
    s.conn.send({
      t: 'start',
      seat: i,
      teams: [this.seats[0].abbr, this.seats[1].abbr],
      state: encodeState(this.state),
      room: this.info(),
    });
  }

  input(i: 0 | 1, seq: number, input: PlayerInput): void {
    const s = this.seats[i];
    if (!Number.isInteger(seq) || seq <= s.lastSeq) return;
    s.lastSeq = seq;
    s.queue.push({ seq, input: sanitize(input) });
    if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - MAX_QUEUE);
  }

  sub(i: 0 | 1, slotId: number, rosterIdx: number): void {
    if (this.state && Number.isInteger(slotId) && Number.isInteger(rosterIdx)) requestSub(this.state, i, slotId, rosterIdx);
  }

  cancelSub(i: 0 | 1, slotId: number): void {
    if (this.state && Number.isInteger(slotId)) cancelSub(this.state, i, slotId);
  }

  /** One 30 Hz tick. Returns false once the room can be deleted. */
  tick(): boolean {
    for (const s of this.seats) {
      if (s.token && !s.conn) {
        s.awayFor += DT;
        if (s.awayFor >= REJOIN_SECONDS) {
          s.token = null;
          this.broadcastRoom();
        } else if (Math.ceil(REJOIN_SECONDS - s.awayFor) !== Math.ceil(REJOIN_SECONDS - s.awayFor + DT)) {
          this.broadcastRoom(); // countdown for the other player
        }
      }
    }
    if (this.empty) return false;
    const state = this.state;
    if (!state) return true;

    const inputs: Partial<Record<0 | 1, PlayerInput>> = {};
    for (const i of [0, 1] as const) {
      const s = this.seats[i];
      if (!s.conn) continue;
      const next = s.queue.shift();
      if (next) {
        s.last = next.input;
        s.ack = next.seq;
        s.idle = 0;
      } else if (++s.idle > IDLE_TICKS) {
        s.last = NO_INPUT;
      }
      inputs[i] = s.last;
    }
    step(state, inputs);
    this.events.push(...state.events);

    if (state.phase === 'final') {
      this.finalFor += DT;
      if (this.finalFor > FINAL_LINGER) return false;
    }
    const perSnap = 30 / SNAPSHOT_HZ;
    if (Math.floor(state.tick / perSnap) !== Math.floor((state.tick - 1) / perSnap)) this.snapshot();
    return true;
  }

  private snapshot(): void {
    const state = this.state!;
    const json = encodeState(state);
    const inputs: [PlayerInput | null, PlayerInput | null] = [
      this.seats[0].conn ? this.seats[0].last : null,
      this.seats[1].conn ? this.seats[1].last : null,
    ];
    for (const s of this.seats) {
      s.conn?.send({ t: 'snap', tick: state.tick, ack: s.ack, state: json, inputs, events: this.events });
    }
    this.events = [];
  }

  close(msg: string): void {
    for (const s of this.seats) {
      s.conn?.send({ t: 'closed', msg });
      s.conn?.close();
      s.conn = null;
    }
  }
}

function sanitize(inp: PlayerInput): PlayerInput {
  const axis = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const out: PlayerInput = {
    moveX: axis(inp?.moveX),
    moveZ: axis(inp?.moveZ),
    sprint: !!inp?.sprint,
    shoot: !!inp?.shoot,
    jump: !!inp?.jump,
    pass: !!inp?.pass,
    switchPlayer: !!inp?.switchPlayer,
    intenseD: !!inp?.intenseD,
    timeout: !!inp?.timeout,
  };
  if (Number.isInteger(inp?.passTarget) && inp.passTarget! >= 0 && inp.passTarget! < 10) out.passTarget = inp.passTarget;
  return out;
}

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

function cleanSettings(s: RoomSettings | undefined): RoomSettings {
  const q = Number(s?.quarterSeconds);
  return {
    quarterSeconds: Number.isFinite(q) ? Math.max(30, Math.min(720, Math.round(q))) : 180,
    difficulty: DIFFICULTIES.includes(s?.difficulty as Difficulty) ? s!.difficulty : 'normal',
    rules: { fouls: s?.rules?.fouls !== false, violations: s?.rules?.violations !== false, fatigue: s?.rules?.fatigue !== false },
  };
}

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, 16) : '') || '玩家';
const validAbbr = (abbr: unknown): abbr is string => typeof abbr === 'string' && TEAMS.some((t) => t.abbr === abbr);

/** Every room on this server, plus routing of client messages to them. */
export class Lobby {
  readonly rooms = new Map<string, Room>();
  private readonly where = new Map<Conn, { room: Room; seat: 0 | 1 }>();

  constructor(private readonly random: () => number = Math.random) {}

  handle(conn: Conn, msg: ClientMessage): void {
    const at = this.where.get(conn);
    switch (msg?.t) {
      case 'create': {
        if (msg.v !== PROTOCOL_VERSION) return conn.send({ t: 'error', msg: '版本不同（遊戲或名單已更新），請重新整理頁面' });
        if (at) this.drop(conn, true);
        let code = randomRoomCode(this.random);
        while (this.rooms.has(code)) code = randomRoomCode(this.random);
        const room = new Room(code, cleanSettings(msg.settings), validAbbr(msg.abbr) ? msg.abbr : 'GSW');
        this.rooms.set(code, room);
        this.where.set(conn, { room, seat: 0 });
        room.seat(0, conn, cleanName(msg.name));
        return;
      }
      case 'join': {
        if (msg.v !== PROTOCOL_VERSION) return conn.send({ t: 'error', msg: '版本不同（遊戲或名單已更新），請重新整理頁面' });
        const room = this.rooms.get(normaliseRoomCode(String(msg.code ?? '')));
        if (!room) return conn.send({ t: 'error', msg: '找不到這個房間' });
        if (at) this.drop(conn, true);
        let found = room.seats.findIndex((x) => !!msg.token && x.token === msg.token);
        if (found < 0) found = room.seats.findIndex((x) => !x.token);
        if (found < 0) return conn.send({ t: 'error', msg: '房間已滿' });
        const seat = found as 0 | 1;
        const s = room.seats[seat];
        if (!s.token && !room.state && validAbbr(msg.abbr)) s.abbr = msg.abbr;
        const old = s.conn;
        if (old && old !== conn) this.where.delete(old);
        this.where.set(conn, { room, seat });
        room.seat(seat, conn, cleanName(msg.name), s.token ?? undefined);
        return;
      }
      case 'pickTeam':
        if (at && !at.room.state && validAbbr(msg.abbr)) {
          at.room.seats[at.seat].abbr = msg.abbr;
          at.room.broadcastRoom();
        }
        return;
      case 'start':
        if (at?.seat === 0 && !at.room.start()) conn.send({ t: 'error', msg: '等對手加入後才能開始' });
        return;
      case 'input':
        at?.room.input(at.seat, msg.seq, msg.input);
        return;
      case 'sub':
        at?.room.sub(at.seat, msg.slotId, msg.rosterIdx);
        return;
      case 'cancelSub':
        at?.room.cancelSub(at.seat, msg.slotId);
        return;
      case 'leave':
        this.drop(conn, true);
        return;
    }
  }

  /** Socket closed (`leaving` = on purpose, which frees the seat). */
  drop(conn: Conn, leaving = false): void {
    const at = this.where.get(conn);
    if (!at) return;
    this.where.delete(conn);
    if (at.room.seats[at.seat].conn !== conn) return;
    if (leaving) at.room.leave(at.seat);
    else at.room.disconnect(at.seat);
    if (at.room.empty) this.rooms.delete(at.room.code);
  }

  tick(): void {
    for (const [code, room] of this.rooms) {
      if (!room.tick()) {
        room.close('房間已關閉');
        for (const [c, at] of this.where) if (at.room === room) this.where.delete(c);
        this.rooms.delete(code);
      }
    }
  }
}
