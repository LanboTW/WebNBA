import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DT, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '@webnba/shared';
import { Lobby, type Conn } from './rooms';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export interface GameServer {
  http: Server;
  lobby: Lobby;
  port(): number;
  close(): Promise<void>;
}

/**
 * HTTP + WebSocket game server. WebSockets live on /ws; any other path serves
 * the built client from `staticDir` (if it exists) so one process can host both.
 */
export function startServer(port: number, staticDir?: string): Promise<GameServer> {
  const lobby = new Lobby();
  const root = staticDir && existsSync(staticDir) ? resolve(staticDir) : null;

  const http = createServer((req, res) => {
    // Health check for the host, and the page's wake-up ping (free hosting sleeps when idle).
    if ((req.url ?? '').split('?')[0] === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION, rooms: lobby.rooms.size }));
      return;
    }
    if (!root) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`WebNBA server: ${lobby.rooms.size} room(s)`);
      return;
    }
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024, perMessageDeflate: true });
  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = {
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(),
    };
    ws.on('message', (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      lobby.handle(conn, msg);
    });
    ws.on('close', () => lobby.drop(conn));
  });

  // Fixed 30 Hz loop; catches up (a few ticks at most) if the timer runs late.
  let next = performance.now();
  let timer: NodeJS.Timeout;
  const loop = () => {
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 5) {
      lobby.tick();
      next += DT * 1000;
      n++;
    }
    if (now - next > 1000) next = now;
    timer = setTimeout(loop, Math.max(1, next - performance.now()));
  };
  loop();

  return new Promise((ok) => {
    http.listen(port, () =>
      ok({
        http,
        lobby,
        port: () => {
          const a = http.address();
          return typeof a === 'object' && a ? a.port : port;
        },
        close: () =>
          new Promise<void>((done) => {
            clearTimeout(timer);
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      }),
    );
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  startServer(port, dist).then(() => console.log(`WebNBA server on http://localhost:${port} (ws: /ws)`));
}
