import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  // One .env at the repo root. Only VITE_ variables (the public Supabase URL and
  // publishable key) reach the page; tool keys there have no prefix and stay out.
  envDir: '..',
  server: {
    // The preview tools hand out a free port through PORT; 5173 otherwise.
    port: Number(process.env.PORT) || 5173,
    host: true,
  },
});
