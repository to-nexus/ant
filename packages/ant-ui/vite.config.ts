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
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',  // Allow JSX in .js files
      },
    },
  },
  server: {
    port: 4200,
    open: false,  // 브라우저 자동 열기 방지
  },
  preview: {
    open: false,  // 브라우저 자동 열기 방지
  },
})