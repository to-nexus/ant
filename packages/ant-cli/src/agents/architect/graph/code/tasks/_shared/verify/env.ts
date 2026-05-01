/**
 * Verification env probes — disk-based test-file detection and TypeScript
 * project heuristic. Both feed `Session.createFresh({ isTs, hasTests })`
 * (verification's per-task env contract).
 *
 * - `detectTestFilesFromDisk` scans `<featurePath>/codebase` recursively
 *   for `*.test.*` / `*.spec.*` / `*_test.go` files. Disk-authoritative —
 *   reflects writes from the current run.
 * - `isTypeScriptProject` reads the task's first techTier (or falls back
 *   to the state-level techTier) and returns true when the language is
 *   TypeScript-flavoured.
 *
 * Phase code (e.g. `nodes/plan/entry/resolve.ts`) imports from here so
 * the env-probe responsibility lives entirely inside the verify SSOT
 * directory.
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
