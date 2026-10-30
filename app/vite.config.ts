import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5173,
    proxy: {
      // O iniciar.bat sobe o PHP em 127.0.0.1:8080 (nao em localhost, que pode cair no IPv6).
      '/api': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
    },
  },
  build: {
    // O build cai direto no docroot do PHP (server/public)
    outDir: '../server/public',
    emptyOutDir: false,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
