import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import path from 'path';

const SITE_PROXY_TARGET = 'http://localhost:4300';

/**
 * Proxies non-SPA routes to the ant-site Next.js dev server (port 4300).
 * Uses configureServer so it runs BEFORE Vite's base middleware
 * (which strips the /app/ prefix and would break regex-based proxy matching).
 */
function antSiteProxy(): PluginOption {
  return {
    name: 'ant-site-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url === '/app') {
          res.writeHead(301, { Location: '/app/' });
          return res.end();
        }
        if (
          url.startsWith('/app') ||
          url.startsWith('/api') ||
          url.startsWith('/ide') ||
          url.startsWith('/realtime') ||
          url.startsWith('/@') ||
          url.startsWith('/__') ||
          url.startsWith('/node_modules') ||
          url.startsWith('/src')
        ) {
          return next();
        }
        const target = new URL(SITE_PROXY_TARGET);
        const proxyReq = http.request(
          { hostname: target.hostname, port: target.port, path: url, method: req.method, headers: { ...req.headers, host: target.host } },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
          },
        );
        proxyReq.on('error', () => {
          if (!res.headersSent) next();
        });
        req.pipe(proxyReq);
      });
    },
  };
}

export default defineConfig({
  base: '/app/',
  plugins: [antSiteProxy(), react()],
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
      // Note: preview는 별도 호스트 (VITE_PREVIEW_HOST)로 직접 호출
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