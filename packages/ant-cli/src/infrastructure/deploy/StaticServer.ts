/**
 * StaticServer
 * 
 * Serves built static files for deployed projects.
 * - SPA (Vite, CRA, unknown): express.static + index.html fallback
 * - Next.js: `next start` child process
 */

import express, { Express } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../../utils/logger';
import type { DeployFramework } from '../../core/ports/portRegistry';

export interface StaticServerOptions {
  framework: DeployFramework;
  outputDir: string;
  port: number;
  basePath: string;
  workspacePath: string;
}

export interface StaticServerHandle {
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start a static file server for SPA frameworks (Vite, CRA, generic).
 * Uses express.static with index.html fallback for client-side routing.
 */
function startSpaServer(options: StaticServerOptions): Promise<StaticServerHandle> {
  const { outputDir, port, basePath } = options;
  const app: Express = express();

  // Serve static files under the basePath prefix
  app.use(basePath, express.static(outputDir, {
    maxAge: '1h',
    etag: true,
  }));

  // SPA fallback: serve index.html for any non-file request under basePath
  app.get(`${basePath}/*`, (_req, res) => {
    const indexPath = path.join(outputDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found');
    }
  });

  // Root redirect to basePath
  if (basePath !== '/') {
    app.get('/', (_req, res) => {
      res.redirect(basePath);
    });
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      logger.info(`[Deploy] SPA server started on port ${port} (basePath: ${basePath})`, { component: 'StaticServer' });
      resolve({
        port,
        stop: () => new Promise<void>((res) => {
          server.close(() => {
            logger.info(`[Deploy] SPA server stopped (port ${port})`, { component: 'StaticServer' });
            res();
          });
        }),
      });
    });

    server.on('error', (err) => {
      reject(new Error(`Failed to start SPA server on port ${port}: ${err.message}`));
    });
  });
}

/**
 * Start Next.js production server via `next start`.
 */
function startNextServer(options: StaticServerOptions): Promise<StaticServerHandle> {
  const { port, basePath, workspacePath } = options;

  return new Promise((resolve, reject) => {
    const nextBin = path.join(workspacePath, 'node_modules', '.bin', 'next');
    const cmd = fs.existsSync(nextBin) ? nextBin : 'npx';
    const args = cmd === nextBin
      ? ['start', '-p', String(port)]
      : ['next', 'start', '-p', String(port)];

    const child: ChildProcess = spawn(cmd, args, {
      cwd: workspacePath,
      env: {
        ...process.env,
        PORT: String(port),
        NEXT_PUBLIC_BASE_PATH: basePath === '/' ? '' : basePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        started = true;
        // Assume it started even if no ready message (some Next.js versions don't log it)
        resolve({
          port,
          stop: () => new Promise<void>((res) => {
            child.kill('SIGTERM');
            child.on('exit', () => res());
            setTimeout(() => { child.kill('SIGKILL'); res(); }, 5000);
          }),
        });
      }
    }, 30000);

    const checkReady = (data: Buffer) => {
      const text = data.toString();
      if (!started && (text.includes('Ready') || text.includes('started') || text.includes(`localhost:${port}`))) {
        started = true;
        clearTimeout(timeout);
        logger.info(`[Deploy] Next.js server started on port ${port}`, { component: 'StaticServer' });
        resolve({
          port,
          stop: () => new Promise<void>((res) => {
            child.kill('SIGTERM');
            child.on('exit', () => res());
            setTimeout(() => { child.kill('SIGKILL'); res(); }, 5000);
          }),
        });
      }
    };

    child.stdout?.on('data', checkReady);
    child.stderr?.on('data', checkReady);

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (!started) {
        reject(new Error(`Failed to start Next.js server: ${err.message}`));
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (!started) {
        reject(new Error(`Next.js server exited with code ${code}`));
      }
    });
  });
}

/**
 * Start a static server based on framework type.
 */
export async function startStaticServer(options: StaticServerOptions): Promise<StaticServerHandle> {
  if (options.framework === 'nextjs') {
    return startNextServer(options);
  }
  return startSpaServer(options);
}
