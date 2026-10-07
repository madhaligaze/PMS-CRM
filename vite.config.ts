import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// API в разработке - отдельный процесс (backend/, порт 4000). Прокси держит
// веб и API на одном origin: refresh-cookie остаётся SameSite=Strict.
const API = process.env.VITE_DEV_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
  preview: {
    port: 8080,
    proxy: { '/api': { target: API, changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
});
