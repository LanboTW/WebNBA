import { PROTOCOL_VERSION, REJOIN_SECONDS, type ClientMessage, type RoomSettings, type ServerMessage } from '@webnba/shared';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: NetStatus): void;
}

/** Where the game server lives: VITE_SERVER_URL, else /ws on this page's host. */
export function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

const tokenKey = (code: string) => `webnba.token.${code}`;

/** Seat tokens live per tab (two tabs keep separate seats) and survive a reload. */
function storeToken(code: string, token: string | null): void {
  try {
    if (token) sessionStorage.setItem(tokenKey(code), token);
    else sessionStorage.removeItem(tokenKey(code));
  } catch {
    // Storage unavailable: rejoining after a reload won't work, reconnects still will.
  }
}

export function storedToken(code: string): string | undefined {
  try {
    return sessionStorage.getItem(tokenKey(code)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * WebSocket to the game server. If the socket drops mid-room it keeps
 * reconnecting with the seat token for as long as the server holds the seat.
 */
export class NetClient {
  private ws: WebSocket | null = null;
  private code: string | null = null;
  private token: string | null = null;
  private name = '';
  private lostAt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** Sent create/join, no answer yet. */
  private awaitingJoin = false;
  /** Round trip in ms, measured from input acks. */
  ping = 0;

  constructor(private readonly handlers: NetHandlers) {}

  get roomCode(): string | null {
    return this.code;
  }

  create(name: string, abbr: string, settings: RoomSettings): void {
    this.name = name;
    this.connect({ t: 'create', v: PROTOCOL_VERSION, name, abbr, settings });
  }

  join(code: string, name: string, abbr: string): void {
    this.name = name;
    this.connect({ t: 'join', v: PROTOCOL_VERSION, code, name, abbr, token: storedToken(code) });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Leave the room for good (frees the seat). */
  leave(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.send({ t: 'leave' });
    if (this.code) storeToken(this.code, null);
    this.ws?.close();
    this.ws = null;
  }

  private connect(first: ClientMessage): void {
    this.handlers.onStatus(this.lostAt ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(serverUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.lostAt = 0;
      this.awaitingJoin = true;
      ws.send(JSON.stringify(first));
      this.handlers.onStatus('open');
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === 'error' && this.awaitingJoin && this.code) {
        // Could not get back into our room (it closed, or the seat expired).
        this.closed = true;
        ws.close();
        this.handlers.onMessage({ t: 'closed', msg: `無法回到房間：${msg.msg}` });
        return;
      }
      if (msg.t === 'joined') {
        this.awaitingJoin = false;
        this.code = msg.code;
        this.token = msg.token;
        storeToken(msg.code, msg.token);
      } else if (msg.t === 'closed') {
        this.closed = true;
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      // Never got into a room: nothing to rejoin.
      if (!this.code || !this.token) {
        this.handlers.onStatus('closed');
        return;
      }
      if (!this.lostAt) this.lostAt = performance.now();
      if (performance.now() - this.lostAt > REJOIN_SECONDS * 1000) {
        this.handlers.onStatus('closed');
        return;
      }
      this.handlers.onStatus('reconnecting');
      const code = this.code;
      this.retry = setTimeout(
        () => this.connect({ t: 'join', v: PROTOCOL_VERSION, code, name: this.name, token: this.token ?? undefined }),
        1500,
      );
    };
  }
}
