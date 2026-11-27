import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_PUBLIC_BASE unifica o prefixo do app em todos os lugares:
//   .env.production -> /anima/   (producao: dominio/anima)
//   .env.development -> /        (dev server na raiz)
// O valor chega no HTML via %VITE_PUBLIC_BASE% e no JS via import.meta.env.
export default defineConfig(({ mode }) => {
  const base = loadEnv(mode, __dirname, 'VITE_PUBLIC_BASE').VITE_PUBLIC_BASE || '/';

  return {
    plugins: [react()],
    base,
    server: {
      port: 5173,
      proxy: {
        // O iniciar.bat sobe o PHP em 127.0.0.1:8080 (nao em localhost, que pode cair no IPv6).
        '/api': 'http://127.0.0.1:8080',
        '/media': 'http://127.0.0.1:8080',
      },
    },
    build: {
      // O build cai direto no docroot do PHP (server/public).
      // emptyOutDir=false: um wipe apagaria index.php/.htaccess/robots.txt,
      // que existem apenas aqui (nao em app/public). Assets antigos ficam para
      // limpeza manual quando necessario.
      outDir: '../server/public',
      emptyOutDir: false,
      assetsDir: 'assets',
      sourcemap: false,
    },
  };
});