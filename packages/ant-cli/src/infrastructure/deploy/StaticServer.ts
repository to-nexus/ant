/**
 * StaticServer
 * 
 * Serves built static files for deployed projects.
 * - SPA (Vite, CRA, unknown): express.static + index.html fallback
 * - Next.js: `next start` child process
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { createStaticApp } from '../static/staticApp';
import { staticEntryFile } from '../../periphery/adapters/http/services/PreviewService/detectors/manifest';
import { composeChildEnv } from '../../core/config/childEnv';
import { childSpawnIdentity, assertUserCodeIsolationOrThrow } from '../../core/config/childIdentity';
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
 * Serving policy (cache, dotfiles, SPA fallback) lives in `createStaticApp` —
 * the same owner the preview static server uses.
 */
function startSpaServer(options: StaticServerOptions): Promise<StaticServerHandle> {
  const { outputDir, port, basePath } = options;
  // Re-derived from the manifest SSOT at serve time (works after a pod-restart
  // rehydration too — the deploy workspace persists on disk). Built frameworks
  // have a package.json, so this stays undefined and the default index.html holds.
  const entryFile = staticEntryFile(options.workspacePath) ?? 'index.html';
  const app = createStaticApp({
    root: outputDir,
    basePath,
    cache: 'short',
    fallback: 'always-index',
    entryFile,
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    // `'listening'`, not the listen callback — express fires that callback even
    // on a failed bind, which resolved this promise for a server that then died.
    server.on('listening', () => {
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

  // `next start` runs the user's built server long-lived — fail closed in cloud
  // without UID isolation (M-015).
  assertUserCodeIsolationOrThrow('deploy:static-server');
  return new Promise((resolve, reject) => {
    const nextBin = path.join(workspacePath, 'node_modules', '.bin', 'next');
    const cmd = fs.existsSync(nextBin) ? nextBin : 'npx';
    const args = cmd === nextBin
      ? ['start', '-p', String(port)]
      : ['next', 'start', '-p', String(port)];

    const child: ChildProcess = spawn(cmd, args, {
      cwd: workspacePath,
      env: composeChildEnv({
        PORT: String(port),
        NEXT_PUBLIC_BASE_PATH: basePath === '/' ? '' : basePath,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...childSpawnIdentity(),
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
  if (options.framework === 'nextjs' && !options.outputDir.endsWith('.next')) {
    return startSpaServer(options);
  }
  if (options.framework === 'nextjs') {
    return startNextServer(options);
  }
  return startSpaServer(options);
}
