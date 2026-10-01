import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  NO_INPUT,
  PROTOCOL_VERSION,
  decodeState,
  findTeam,
  type ClientMessage,
  type RoomSettings,
  type ServerMessage,
} from '@webnba/shared';
import { startServer, type GameServer } from '../src/index';

const SETTINGS: RoomSettings = { quarterSeconds: 60, difficulty: 'normal', rules: { fouls: true, violations: true, fatigue: true } };

/** Minimal test client that records every message. */
class Client {
  readonly ws: WebSocket;
  /** Messages nobody has waited for yet. */
  private readonly got: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; ok: (m: ServerMessage) => void }[] = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      const w = this.waiters.find((x) => x.pred(m));
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.ok(m);
      } else {
        this.got.push(m);
      }
    });
  }

  open(): Promise<void> {
    return new Promise((ok) => this.ws.once('open', () => ok()));
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const match = (m: ServerMessage) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>);
    const early = this.got.findIndex(match);
    if (early >= 0) return Promise.resolve(this.got.splice(early, 1)[0] as Extract<ServerMessage, { t: T }>);
    return new Promise<Extract<ServerMessage, { t: T }>>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timed out waiting for ${t}`)), 4000);
      this.waiters.push({
        pred: match,
        ok: (m) => {
          clearTimeout(timer);
          ok(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }
}

let server: GameServer | null = null;
const clients: Client[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.close());
  await server?.close();
  server = null;
});

async function connect(): Promise<Client> {
  const c = new Client(server!.port());
  clients.push(c);
  await c.open();
  return c;
}

async function twoPlayerRoom() {
  server = await startServer(0);
  const host = await connect();
  host.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Host', abbr: 'GSW', settings: SETTINGS });
  const created = await host.next('joined');
  const guest = await connect();
  guest.send({ t: 'join', v: PROTOCOL_VERSION, code: created.code.toLowerCase(), name: 'Guest', abbr: 'GSW' });
  const joined = await guest.next('joined');
  return { host, guest, code: created.code, hostToken: created.token, guestToken: joined.token };
}

describe('game server', () => {
  it('creates a room, seats a guest and plays a synced game', async () => {
    const { host, guest, code } = await twoPlayerRoom();
    const room = await host.next('room', (m) => m.room.seats[1].connected);
    expect(room.room.code).toBe(code);
    expect(room.room.seats.map((s) => s.name)).toEqual(['Host', 'Guest']);
    // Same team on both sides is allowed.
    expect(room.room.seats.map((s) => s.abbr)).toEqual(['GSW', 'GSW']);

    guest.send({ t: 'pickTeam', abbr: 'LAL' });
    await host.next('room', (m) => m.room.seats[1].abbr === 'LAL');
    host.send({ t: 'start' });
    const [hs, gs] = await Promise.all([host.next('start'), guest.next('start')]);
    expect(hs.seat).toBe(0);
    expect(gs.seat).toBe(1);
    expect(gs.teams).toEqual(['GSW', 'LAL']);

    for (let seq = 1; seq <= 20; seq++) guest.send({ t: 'input', seq, input: { ...NO_INPUT, moveX: -1 } });
    const snap = await guest.next('snap', (m) => m.ack === 20);
    const state = decodeState(snap.state, [findTeam('GSW'), findTeam('LAL')]);
    expect(state.settings.humanTeams).toEqual([0, 1]);
    expect(state.players[state.controlled[1]].team).toBe(1);
    expect(snap.inputs[1]?.moveX).toBe(-1);
  });

  it('lets only the host start, and only with an opponent', async () => {
    server = await startServer(0);
    const host = await connect();
    host.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Host', abbr: 'BOS', settings: SETTINGS });
    await host.next('joined');
    host.send({ t: 'start' });
    expect((await host.next('error')).msg).toContain('對手');
  });

  it('rejects unknown rooms, full rooms and old clients', async () => {
    const { code } = await twoPlayerRoom();
    const third = await connect();
    third.send({ t: 'join', v: PROTOCOL_VERSION, code: 'ZZZZZZ', name: 'X' });
    expect((await third.next('error')).msg).toBe('找不到這個房間');
    third.send({ t: 'join', v: PROTOCOL_VERSION, code, name: 'X' });
    expect((await third.next('error')).msg).toBe('房間已滿');
    third.send({ t: 'join', v: '1-old', code, name: 'X' });
    expect((await third.next('error')).msg).toContain('版本');
  });

  it('gives a dropped team to the AI and lets the player rejoin with their token', async () => {
    const { host, guest, code, guestToken } = await twoPlayerRoom();
    host.send({ t: 'start' });
    await guest.next('start');
    guest.ws.close();
    const away = await host.next('room', (m) => m.room.started && !m.room.seats[1].connected);
    expect(away.room.seats[1].taken).toBe(true);
    expect(away.room.seats[1].rejoinLeft).toBeGreaterThan(55);
    const aiSnap = await host.next('snap', (m) => m.inputs[1] === null);
    expect(decodeState(aiSnap.state, [findTeam('GSW'), findTeam('GSW')]).settings.humanTeams).toEqual([0]);

    // A stranger cannot take the held seat...
    const stranger = await connect();
    stranger.send({ t: 'join', v: PROTOCOL_VERSION, code, name: 'X' });
    expect((await stranger.next('error')).msg).toBe('房間已滿');

    // ...but the original player can, and gets the running game back.
    const back = await connect();
    back.send({ t: 'join', v: PROTOCOL_VERSION, code, name: 'Guest', token: guestToken });
    expect((await back.next('joined')).seat).toBe(1);
    const restart = await back.next('start');
    expect(decodeState(restart.state, [findTeam('GSW'), findTeam('GSW')]).settings.humanTeams).toEqual([0, 1]);
  });

  it('closes the room once everyone has left', async () => {
    const { host, guest, code } = await twoPlayerRoom();
    guest.send({ t: 'leave' });
    await host.next('room', (m) => !m.room.seats[1].taken);
    host.send({ t: 'leave' });
    await new Promise((r) => setTimeout(r, 100));
    expect(server!.lobby.rooms.has(code)).toBe(false);
  });

  it('applies substitutions requested by a player', async () => {
    const { host, guest } = await twoPlayerRoom();
    host.send({ t: 'start' });
    await guest.next('start');
    guest.send({ t: 'sub', slotId: 5, rosterIdx: 5 });
    // Guest must not be able to queue subs for the other team.
    guest.send({ t: 'sub', slotId: 0, rosterIdx: 5 });
    const snap = await host.next('snap', (m) => m.state.includes('"subQueue":[{'));
    const state = decodeState(snap.state, [findTeam('GSW'), findTeam('GSW')]);
    expect(state.subQueue).toEqual([{ team: 1, slotId: 5, rosterIdx: 5 }]);
  });
});
