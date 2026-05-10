import { defineConfig, type PluginOption, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import path from 'path';

const SITE_PROXY_TARGET = 'http://localhost:4300';

/**
 * Backend service proxy table — single source of truth for both `vite dev`
 * (server.proxy) and `vite preview` (preview.proxy). Production build +
 * `pnpm start:ui` (vite preview) used to lose these proxies, breaking the
 * `pnpm build:ui:local` workflow where the dist must hit the local BE
 * through relative URLs.
 */
const PROXY_TABLE = {
  '/api': {
    target: 'http://localhost:4100',
    changeOrigin: true,
  },
  '/ide': {
    target: 'http://localhost:4100',
    changeOrigin: true,
    ws: true,
  },
  '/realtime': {
    target: 'http://localhost:4101',
    changeOrigin: true,
  },
} as const;

/**
 * Proxies non-SPA routes to the ant-site Next.js dev server (port 4300).
 * Hooks into both dev (`configureServer`) and preview (`configurePreviewServer`)
 * so the integrated origin works whether the user runs `pnpm dev:ui` or
 * `pnpm start:ui` (vite preview against a built dist).
 */
function antSiteProxy(): PluginOption {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
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
  };
  return {
    name: 'ant-site-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
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
    open: false,
    proxy: PROXY_TABLE,
  },
  preview: {
    port: 4200,
    open: false,
    proxy: PROXY_TABLE,
  },
})
