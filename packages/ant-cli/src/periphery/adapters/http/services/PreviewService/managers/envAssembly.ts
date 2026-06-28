import * as fs from 'fs';
import * as path from 'path';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { logger } from '../../../../../../utils/logger';

/**
 * Environment assembly for preview/provisioning processes — SSOT.
 *
 * Both the dev-server spawn (ProcessSpawner) and the post-infra provisioning
 * step (ProvisioningManager) must run with the SAME resolved env for a given
 * package, so a `prisma migrate deploy` sees the exact `DATABASE_URL` the app
 * will use. These pure functions are the single place that derives that env;
 * they are standalone (no PreviewService coupling) so a future deploy-side
 * backend runtime can reuse them verbatim.
 */

/**
 * Load environment variables from .env files.
 *
 * Two-level loading (like Nx / Docker Compose):
 *   1. projectRoot .env / .env.local  (workspace-level defaults)
 *   2. packagePath .env / .env.local  (package-level overrides)
 *
 * Package-level values take precedence over project-root values.
 */
export function loadProjectEnv(packagePath: string, projectRoot?: string): Record<string, string> {
  const result: Record<string, string> = {};

  const dirsToLoad: string[] = [];
  if (projectRoot && path.resolve(projectRoot) !== path.resolve(packagePath)) {
    dirsToLoad.push(projectRoot);
  }
  dirsToLoad.push(packagePath);

  for (const dir of dirsToLoad) {
    for (const fileName of ['.env', '.env.local']) {
      const filePath = path.join(dir, fileName);
      if (!fs.existsSync(filePath)) continue;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex === -1) continue;
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          result[key] = value;
        }
      } catch (err) {
        logger.warn(`[envAssembly] Failed to parse ${filePath}: ${err}`, { component: 'envAssembly' });
      }
    }
  }

  return result;
}

/**
 * Build merged env from connections, filtered by package source.
 * Only injects env vars belonging to the target package (or global '*').
 */
export function connectionsToEnv(connections?: ServiceConnection[], packageSource?: string): Record<string, string> {
  if (!connections?.length) return {};
  const result: Record<string, string> = {};
  for (const conn of connections) {
    if (!conn.envVar || !conn.value) continue;
    if (conn.source === '*' || !packageSource || conn.source === packageSource) {
      result[conn.envVar] = conn.value;
    }
  }
  return result;
}

export interface PackageEnvInput {
  pkgPath: string;
  projectRoot?: string;
  connections?: ServiceConnection[];
  packageSource?: string;
}

/**
 * Resolve the connection/.env layer for a package, shared by dev-spawn and
 * provisioning. Does NOT include process.env, PORT, base-path, or polling vars —
 * callers spread this over `process.env` and add their own runtime vars.
 */
export function buildPackageEnv(input: PackageEnvInput): Record<string, string> {
  return {
    ...loadProjectEnv(input.pkgPath, input.projectRoot),
    ...connectionsToEnv(input.connections, input.packageSource),
  };
}
