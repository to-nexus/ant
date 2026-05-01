/**
 * Verification env probes — disk-based observations that feed
 * `VerificationSession` and the verify-mode plan prompt.
 *
 * Three probe families live here:
 *
 * - `detectTestFilesFromDisk` — scans `<featurePath>/codebase` recursively
 *   for `*.test.*` / `*.spec.*` / `*_test.go` files. Disk-authoritative —
 *   reflects writes from the current run. Feeds `Session.createFresh({
 *   isTs, hasTests })`.
 * - `isTypeScriptProject` — reads the task's first techTier (or falls back
 *   to the state-level techTier) and returns true when the language is
 *   TypeScript-flavoured. Feeds the same Session-env contract.
 * - `probeInstallStatus` — wraps `areDepsInstalled` + (optional)
 *   `detectPackageManager`. Returns `{ installed, packageManager }` —
 *   state-pure (caller owns Session / state mutations). Replaces the
 *   inline dynamic-import logic that previously lived inside
 *   `nodes/plan/entry/installNeeded.ts::recomputeInstallNeeded`. The
 *   plan-entry wrapper now only owns Session lifecycle invocations.
 *
 * Phase code (e.g. `nodes/plan/entry/resolve.ts` /
 * `nodes/plan/entry/installNeeded.ts`) imports from here so the env-probe
 * responsibility lives entirely inside the verify SSOT directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTechTier } from '@ant/shared';
import type { ArchitectGraphState } from '../../../state';

const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/,
  /_test\.go$/,
];

export function detectTestFilesFromDisk(featurePath?: string): boolean {
  if (!featurePath) return false;
  const codebasePath = path.join(featurePath, 'codebase');
  return scanDirForTests(codebasePath);
}

function scanDirForTests(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    if (entry.isDirectory()) {
      if (scanDirForTests(path.join(dir, entry.name))) return true;
    } else if (TEST_FILE_PATTERNS.some(p => p.test(entry.name))) {
      return true;
    }
  }
  return false;
}

export function isTypeScriptProject(state: ArchitectGraphState): boolean {
  const taskTiers = state.currentTask?.techTiers;
  const firstTierLang = taskTiers && taskTiers.length > 0
    ? taskTiers[0].language
    : getTechTier(state)?.language;
  return (firstTierLang ?? '').toLowerCase().includes('typescript');
}

/**
 * Result of a single install-status observation. `installed === null`
 * means the workspace is not a JS project (no `package.json` walked) —
 * caller treats it as "no observation made; do not flip Session
 * `_installNeeded`". `packageManager` is `undefined` when detection
 * was not requested or no lockfile was found.
 */
export interface InstallStatusObservation {
  installed: boolean | null;
  packageManager?: string;
}

/**
 * State-pure install-status probe. Replaces the inline dynamic-import
 * logic that previously lived inside
 * `nodes/plan/entry/installNeeded.ts::recomputeInstallNeeded`.
 *
 * - `featureRoot` — workspace root (from `state.deps.fileSystem.getRootPath()`).
 * - `opts.detectPackageManager` — also probe lockfile and return
 *   `packageManager`. Plan-entry uses this on the first verify-mode
 *   entry to populate `state._detectedPackageManager` cache.
 *
 * Throws are caught by the caller (plan-entry wrapper) which interprets
 * a thrown probe as "treat as install-needed = true" defensively.
 *
 * Dynamic imports preserve the previous module-load cost shape — the
 * `areDepsInstalled` / `detectPackageManager` modules are reached only
 * when verify-mode plan-entry actually runs.
 */
export async function probeInstallStatus(
  featureRoot: string,
  opts?: { detectPackageManager?: boolean },
): Promise<InstallStatusObservation> {
  const { areDepsInstalled } = await import(
    '../../../../../../common/tool/handlers/invalidationScope'
  );
  const installed = await areDepsInstalled(featureRoot);

  let packageManager: string | undefined;
  if (opts?.detectPackageManager) {
    const { detectPackageManager } = await import(
      '../../../../../../../core/utils/packageManager'
    );
    const detected = await detectPackageManager(featureRoot);
    if (detected) packageManager = detected;
  }

  return { installed, packageManager };
}
