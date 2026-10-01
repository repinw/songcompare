import { defineConfig } from 'vite';

// Spotify only accepts loopback IPs (not "localhost") as http redirect URIs.
export default defineConfig({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
