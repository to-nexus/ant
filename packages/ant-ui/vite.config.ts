import { defineConfig, type PluginOption, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      url.startsWith('/dev-cases') ||
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

/**
 * Dev-only static server for the Aurora handoff HTML cases used by the
 * `/dev/aurora-cases` route (see `src/presentation/pages/dev/AuroraCases.tsx`).
 *
 * Files live at `<feature-root>/visual/ui/handoff/project/*.html` — OUTSIDE
 * `codebase/`, so they never enter the production bundle. This middleware
 * exposes them at `/dev-cases/<filename>` ONLY during `vite dev` (no
 * `configurePreviewServer`, no `buildStart`), guaranteeing dead-code
 * elimination in prod builds.
 *
 * Security:
 * - Resolves the canonical path and rejects any URL whose resolved path
 *   escapes the handoff base directory (path-traversal guard).
 * - Falls through to `next()` on ENOENT so unrelated requests are not
 *   shadowed.
 */
function auroraCasesDevStatic(): PluginOption {
  const HANDOFF_BASE = path.resolve(__dirname, '../../../visual/ui/handoff/project');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.jsx': 'application/javascript; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json; charset=utf-8',
  };
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith('/dev-cases/')) return next();
    // Strip prefix + query/hash, then decode.
    const stripped = rawUrl.slice('/dev-cases/'.length).split('?')[0].split('#')[0];
    let filename: string;
    try {
      filename = decodeURIComponent(stripped);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (!filename) return next();
    const resolved = path.resolve(HANDOFF_BASE, filename);
    // Path-traversal guard: resolved must stay inside HANDOFF_BASE.
    const baseWithSep = HANDOFF_BASE.endsWith(path.sep) ? HANDOFF_BASE : HANDOFF_BASE + path.sep;
    if (resolved !== HANDOFF_BASE && !resolved.startsWith(baseWithSep)) {
      res.writeHead(403);
      return res.end();
    }
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext];
    if (!contentType) return next();
    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) return next();
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');
      const stream = fs.createReadStream(resolved);
      stream.on('error', () => {
        if (!res.headersSent) next();
      });
      stream.pipe(res);
    });
  };
  return {
    name: 'aurora-cases-dev-static',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  base: '/app/',
  plugins: [antSiteProxy(), auroraCasesDevStatic(), react()],
  resolve: {
    alias: {
      '@': '/src',
      '@/presentation': '/src/presentation',
      '@/application': '/src/application',
      '@/domain': '/src/domain',
      '@/infrastructure': '/src/infrastructure',
      '@/shared': '/src/shared',
      // OSS / cloud seam: cloud-only FE source lives in the sibling @ant/cloud
      // package (resolved by absolute path — root-relative '/...' can't reach it).
      // Only referenced when VITE_INCLUDE_CLOUD pulls @ant/cloud/ui into the graph.
      '@cloud': path.resolve(__dirname, '../ant-cloud/src/ui'),
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
