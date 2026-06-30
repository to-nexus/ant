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
 * Schema (root + per-package; both optional) — `provision` / `commands` is the
 * single canonical shape, matching the vocabulary the contract teaches:
 *   {
 *     "provision": {
 *       "commands": ["npx prisma db push --skip-generate"],          // root cwd
 *       "packages": {                                                // per-package
 *         "apps/api": { "commands": ["npx prisma migrate deploy"] }
 *       }
 *     }
 *   }
 *
 * The `packages` keys are `packageSource` values — `path.relative(projectRoot,
 * pkg.path)` — so the provisioning step can match each package to its commands
 * and run them in that package's cwd with that package's resolved env.
 *
 * Decorative top-level keys (`$schema`, `name`, a `provision.description`) are
 * ignored, not rejected. Only ONE command shape is accepted — there is no
 * alternate key spelling (no `setupCommands`, no top-level `commands`); a
 * non-conforming manifest is reported, never silently coerced (fragmentation).
 *
 * Failure modes:
 *   - missing file        → empty result, no warning (greenfield is normal)
 *   - malformed JSON       → empty result + warning
 *   - present but no commands found under the canonical keys → empty result +
 *     warning (a manifest exists but its shape is unrecognized — the most
 *     likely cause of a silently un-provisioned preview)
 */

export const MANIFEST_FILENAME = 'ant.manifest.json';

export interface PreviewManifestResult {
  /** Commands declared at the manifest root (run at projectRoot). */
  root: string[];
  /** packageSource (relative path) → declared commands (run in that package). */
  byPackage: Record<string, string[]>;
}

const EMPTY: PreviewManifestResult = { root: [], byPackage: {} };

/** Keep only non-empty string entries from a candidate array; non-arrays → []. */
function toCommandArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Read and validate the preview manifest for a project root.
 * Returns the declared root + per-package provisioning commands, or empty on
 * any absence / parse / shape error. A present-but-nonconforming manifest is
 * warned about (not silently treated as "no provisioning").
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

  const provision = (parsed as { provision?: unknown })?.provision;
  if (!provision || typeof provision !== 'object') {
    logger.warn(
      `[previewManifest] ${MANIFEST_FILENAME} present but has no "provision" object — ` +
        `no provisioning will run. Expected { "provision": { "commands": [...] } }.`,
      { component: 'previewManifest' },
    );
    return EMPTY;
  }

  const root = toCommandArray((provision as { commands?: unknown }).commands);

  const byPackage: Record<string, string[]> = {};
  const packages = (provision as { packages?: unknown }).packages;
  if (packages && typeof packages === 'object') {
    for (const [src, entry] of Object.entries(packages as Record<string, unknown>)) {
      const cmds = toCommandArray((entry as { commands?: unknown })?.commands);
      if (cmds.length > 0) byPackage[src] = cmds;
    }
  }

  if (root.length === 0 && Object.keys(byPackage).length === 0) {
    logger.warn(
      `[previewManifest] ${MANIFEST_FILENAME} has a "provision" object but no commands ` +
        `under provision.commands or provision.packages[*].commands — no provisioning will run.`,
      { component: 'previewManifest' },
    );
    return EMPTY;
  }

  return { root, byPackage };
}
