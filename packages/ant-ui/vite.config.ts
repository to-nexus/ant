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
    proxy: {
      // Local dev: route /api/* to ant-api service
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
      // Local dev: route /ide/* to ant-api service (IDE proxy)
      '/ide': {
        target: 'http://localhost:4100',
        changeOrigin: true,
        ws: true,  // WebSocket support for IDE terminal
      },
      // Local dev: route /preview/* to ant-preview service
      '/preview': {
        target: 'http://localhost:4102',
        changeOrigin: true,
      },
      // Local dev: route /realtime/* to ant-realtime service
      '/realtime': {
        target: 'http://localhost:4101',
        changeOrigin: true,
      },
    },
  },
  preview: {
    open: false,  // 브라우저 자동 열기 방지
  },
})