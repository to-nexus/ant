import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';

/**
 * Preview manifest loader — single declared source for provisioning commands.
 *
 * The manifest lives at `<projectRoot>/ant.manifest.json` where `projectRoot`
 * is the codebase root the preview runs against (PreviewService `localPath`).
 * It is checked in, user-editable, and survives resets — git-tracked alongside
 * the code, NOT in Redis state. ANT infra is ORM/stack-agnostic: it executes
 * the commands the code-gen LLM declared here, it does not infer them.
 *
 * Schema (root + per-package; both optional):
 *   {
 *     "preview": {
 *       "setupCommands": ["npx prisma db push --skip-generate"],   // root cwd
 *       "packages": {                                              // per-package
 *         "apps/api": { "setupCommands": ["npx prisma migrate deploy"] }
 *       }
 *     }
 *   }
 *
 * The `packages` keys are `packageSource` values — `path.relative(projectRoot,
 * pkg.path)` — so the provisioning step can match each package to its commands
 * and run them in that package's cwd with that package's resolved env.
 *
 * Missing file / malformed JSON / wrong shape → empty result (never throws).
 * A broken manifest must NOT crash the preview start; it degrades to
 * "no provisioning declared".
 */

export const MANIFEST_FILENAME = 'ant.manifest.json';

export interface PreviewManifestResult {
  /** Commands declared at the manifest root (run at projectRoot). */
  root: string[];
  /** packageSource (relative path) → declared commands (run in that package). */
  byPackage: Record<string, string[]>;
}

const EMPTY: PreviewManifestResult = { root: [], byPackage: {} };

/** Keep only string entries from a candidate array; non-arrays → []. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Read and validate the preview manifest for a project root.
 * Returns the declared root + per-package setup commands, or empty on any
 * absence / parse / shape error.
 */
export function readPreviewManifest(projectRoot: string): PreviewManifestResult {
  const manifestPath = path.join(projectRoot, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    logger.warn(
      `[previewManifest] Malformed ${MANIFEST_FILENAME} ignored: ${(err as Error).message}`,
      { component: 'previewManifest' },
    );
    return EMPTY;
  }

  const preview = (parsed as { preview?: unknown })?.preview;
  if (!preview || typeof preview !== 'object') return EMPTY;

  const root = toStringArray((preview as { setupCommands?: unknown }).setupCommands);

  const byPackage: Record<string, string[]> = {};
  const packages = (preview as { packages?: unknown }).packages;
  if (packages && typeof packages === 'object') {
    for (const [src, entry] of Object.entries(packages as Record<string, unknown>)) {
      const cmds = toStringArray((entry as { setupCommands?: unknown })?.setupCommands);
      if (cmds.length > 0) byPackage[src] = cmds;
    }
  }

  return { root, byPackage };
}
