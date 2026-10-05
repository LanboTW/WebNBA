import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

/** The version shown in the game: client/package.json's. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * The content editor's saves (npm run dev only, from this machine only):
 * special-cards.json, myteam.json and card pictures. The built site has none
 * of this.
 */
function contentEditor(): Plugin {
  const data = new URL('../shared/data/', import.meta.url);
  const cards = new URL('./public/cards/', import.meta.url);
  const logos = new URL('./public/logos/', import.meta.url);
  const files: Record<string, string> = { special: 'special-cards.json', myteam: 'myteam.json', custom: 'custom-teams.json' };
  const local = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const images = () => (existsSync(cards) ? readdirSync(cards).filter((f) => !f.startsWith('.')) : []);
  /** Every picture under logos/, as the paths custom-teams.json names them (custom/abc.webp). */
  const logoFiles = () => (existsSync(logos) ? (readdirSync(logos, { recursive: true }) as string[]).map((f) => f.replace(/\\/g, '/')).filter((f) => /\.(png|webp|svg)$/i.test(f)) : []);
  const logoName = /^custom\/[a-z0-9][a-z0-9-]*\.webp$/;
  return {
    name: 'webnba-content-editor',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__content', (req: IncomingMessage, res: ServerResponse) => {
        // The dev server listens on the network too: saving stays on this machine.
        if (!local.has(req.socket.remoteAddress ?? '')) return send(res, 403, { error: '只能在本機使用' });
        if (req.method === 'GET' && req.url === '/images') return send(res, 200, images());
        if (req.method === 'GET' && req.url === '/logos') return send(res, 200, logoFiles());
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk;
          if (body.length > 4_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const msg = JSON.parse(body) as { file?: string; text?: string; name?: string; data?: string };
            if (req.url === '/save') {
              const name = files[msg.file ?? ''];
              if (!name || typeof msg.text !== 'string') throw new Error('壞掉的存檔要求');
              JSON.parse(msg.text);
              writeFileSync(new URL(name, data), msg.text);
              return send(res, 200, { ok: true });
            }
            if (req.url === '/image') {
              const prefix = 'data:image/webp;base64,';
              if (!/^[a-z0-9][a-z0-9-]*\.webp$/.test(msg.name ?? '') || !msg.data?.startsWith(prefix)) throw new Error('圖片名稱或格式不對');
              mkdirSync(cards, { recursive: true });
              writeFileSync(new URL(msg.name!, cards), Buffer.from(msg.data.slice(prefix.length), 'base64'));
              return send(res, 200, { ok: true, images: images() });
            }
            if (req.url === '/unimage') {
              // A deleted special card's picture.
              if (!/^[a-z0-9][a-z0-9-]*\.webp$/.test(msg.name ?? '')) throw new Error('圖片名稱不對');
              rmSync(new URL(msg.name!, cards), { force: true });
              return send(res, 200, { ok: true, images: images() });
            }
            if (req.url === '/logo') {
              // A custom team's logo: client/public/logos/custom/<name>.webp.
              const prefix = 'data:image/webp;base64,';
              if (!logoName.test(msg.name ?? '') || !msg.data?.startsWith(prefix)) throw new Error('隊徽名稱或格式不對');
              mkdirSync(new URL('custom/', logos), { recursive: true });
              writeFileSync(new URL(msg.name!, logos), Buffer.from(msg.data.slice(prefix.length), 'base64'));
              return send(res, 200, { ok: true });
            }
            if (req.url === '/unlogo') {
              if (!logoName.test(msg.name ?? '')) throw new Error('隊徽名稱不對');
              rmSync(new URL(msg.name!, logos), { force: true });
              return send(res, 200, { ok: true });
            }
            send(res, 404, { error: 'unknown' });
          } catch (e) {
            send(res, 400, { error: String((e as Error).message ?? e) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  // One .env at the repo root. Only VITE_ variables (the public Supabase URL and
  // publishable key) reach the page; tool keys there have no prefix and stay out.
  envDir: '..',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [contentEditor()],
  server: {
    // The preview tools hand out a free port through PORT; 5173 otherwise.
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
});
