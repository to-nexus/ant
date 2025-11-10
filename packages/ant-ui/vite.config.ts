import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
      '@/presentation': '/src/presentation',
      '@/application': '/src/application',
      '@/domain': '/src/domain',
      '@/infrastructure': '/src/infrastructure',
      '@/shared': '/src/shared',
    },
  },
  server: {
    port: 4200,
    open: false,  // 브라우저 자동 열기 방지
  },
})