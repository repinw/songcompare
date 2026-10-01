import { defineConfig } from 'vite';

// GitHub Pages serves the site under /songcompare/; the dev server stays at /.
// Spotify only accepts loopback IPs (not "localhost") as http redirect URIs.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/songcompare/' : '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
