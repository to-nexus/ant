import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin SPA served at `/admin/` (customer app is `/app/`).
 * Production is split-host: `VITE_CLOUD_BACKEND_BASE` names the API host, as
 * in ant-ui. Dev leaves it unset ⇒ relative `/api`, proxied to 4100 below.
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
