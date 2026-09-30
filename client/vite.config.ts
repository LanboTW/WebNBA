import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    // `npm run server` hosts rooms on 8787; the dev page reaches it through /ws.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
