/**
 * ProcessServer
 *
 * Deploy-side serve primitive for backend (`kind: 'process'`) packages — the
 * sibling of `StaticServer` for the static (frontend) kind. It runs the backend
 * as a long-lived process and returns the SAME `StaticServerHandle { port,
 * stop() }`, so `DeployService` orchestrates static and process packages through
 * one uniform pipeline.
 *
 * Language-agnostic by reuse, NOT by reimplementation: it delegates to the
 * preview `ProcessSpawner` — the SSOT that already knows how to run any stack
 * (Node/TS via the package's run script, Go `go run`, Python uvicorn/django/
 * flask, Rust `cargo run`, Java gradle/maven, Makefile targets) AND assembles
 * env from `.env` + service connections + mock-toggle defaults. ANT is a
 * universal framework, so deploy must run whatever preview can run — there is
 * no Node-specific path here. Termination is `ProcessSpawner.killAndWait`
 * (→ `DevProcessControl.killTree`), so every `handle.stop()` teardown works.
 *
 * No base-path / packageUrlKey is passed: the backend serves bare paths and the
 * deploy proxy strips the `/deploy/{urlKey}` prefix (parity with preview's
 * backend routing) — keeping generated backend code identical across surfaces.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StaticServerHandle } from './StaticServer';
import type { ServiceConnection } from '../../core/ports/portRegistry';
import type { PackageInfo } from '../../periphery/adapters/http/services/PreviewService/types';
import { ProcessSpawner } from '../../periphery/adapters/http/services/PreviewService/managers/ProcessSpawner';
import { logger } from '../../utils/logger';

export interface ProcessServerOptions {
  /** Allocated deploy port — injected as `PORT`. */
  port: number;
  /** `tenant:user:project:feature` — logging/identity context for the spawner. */
  serverKey: string;
  /** Display name of the package. */
  name: string;
  /** The package directory (cwd for the run command). */
  workspacePath: string;
  /** Detected language/framework — drives the spawner's per-language dispatch. */
  projectProfile?: { language: string; framework?: string };
  /** Resolved service connections (DB URLs, mock toggles, ant-project links). */
  connections?: ServiceConnection[];
  /** Deploy workspace root for two-level .env loading. */
  projectRoot?: string;
  /** Package subdir relative to projectRoot — filters connection env by source. */
  packageSource?: string;
  onLog?: (line: string) => void;
}

/** Heuristic ready signals across common backend frameworks/languages. */
const READY_RE = /(listening|started successfully|server (is )?running|ready|nest application|running on|uvicorn running|serving)/i;
const READY_TIMEOUT_MS = 30_000;

function readPackageJson(pkgPath: string): any | undefined {
  const p = path.join(pkgPath, 'package.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Spawn a backend package as a long-lived process via the shared
 * `ProcessSpawner`. Resolves once the server looks ready (a ready log line, a
 * `:${port}` mention, or a settling timeout); rejects if the process exits
 * before becoming ready.
 */
export async function startProcessServer(options: ProcessServerOptions): Promise<StaticServerHandle> {
  const { port, serverKey, name, workspacePath, projectProfile, connections, projectRoot, packageSource, onLog } = options;

  const pkg: PackageInfo = {
    name,
    path: workspacePath,
    type: 'backend',
    packageJson: readPackageJson(workspacePath),
    projectProfile,
  };

  const spawner = new ProcessSpawner();

  return new Promise<StaticServerHandle>((resolve, reject) => {
    let started = false;

    const child = spawner.spawn(pkg, port, {
      serverKey,
      // No packageUrlKey → no base-path env. Backend serves bare paths; the
      // deploy proxy strips the prefix (parity with preview backend routing).
      projectRoot,
      connections,
      packageSource,
      onLog: (_type, message) => {
        onLog?.(message);
        if (!started && (READY_RE.test(message) || message.includes(`:${port}`))) {
          markStarted();
        }
      },
      onExit: (code) => {
        clearTimeout(timer);
        if (!started) reject(new Error(`Backend process exited with code ${code} before becoming ready`));
      },
      onError: (err) => {
        clearTimeout(timer);
        if (!started) reject(new Error(`Failed to start backend process: ${err.message}`));
      },
    });

    const makeHandle = (): StaticServerHandle => ({
      port,
      stop: () => spawner
        .killAndWait(child)
        .catch((err) => logger.warn(`[Deploy] killAndWait failed for backend PID=${child.pid}: ${err.message}`, { component: 'ProcessServer' })),
    });

    const markStarted = () => {
      if (started) return;
      started = true;
      clearTimeout(timer);
      logger.info(`[Deploy] Backend process ready on port ${port} (PID=${child.pid})`, { component: 'ProcessServer' });
      resolve(makeHandle());
    };

    // Some servers log nothing recognizable — assume started after a settle window.
    const timer = setTimeout(markStarted, READY_TIMEOUT_MS);
  });
}
