import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  server: {
    port: 5173,
    host: true,
    // `npm run server` hosts rooms on 8787; the dev page reaches it through /ws.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
