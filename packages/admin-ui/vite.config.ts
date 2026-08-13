import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin SPA served under the same host at `/admin/` (customer app is `/app/`).
 * Same-origin ⇒ cookies shared, `/api` is relative (no CORS, no split-host).
 * Dev proxies `/api` to the local API server (4100), same as ant-ui.
 */
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 4250,
    proxy: {
      '/api': { target: 'http://localhost:4100', changeOrigin: true },
    },
  },
  preview: { port: 4250 },
});
