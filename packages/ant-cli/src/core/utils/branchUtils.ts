/**
 * Branch utility functions
 *
 * `branchBase` is a pure pointer into the project's feature set (branch name
 * == feature name). Its lifecycle (auto-apply on feature create/delete,
 * lock-after-remote, manual selection) is owned by
 * `GitService/anchor/branchBaseLifecycle.ts` — this module only keeps the
 * fs-only readers usable from any layer (core / infrastructure / agents).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Read branchBase from project config.json. Pure fs read — safe from every
 * layer. Defaults to 'main' when unset (fresh project pre-first-feature).
 */
export function readBranchBase(projectPath: string): string {
  try {
    const configPath = path.join(projectPath, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.branchBase) return config.branchBase;
    }
  } catch {
    // config not found or invalid
  }
  return 'main';
}

/**
 * Get the configured base branch name.
 *
 * Resolution order:
 * 1. Explicit branchBase parameter (from config)
 * 2. ANT_BRANCH_BASE environment variable (set by JobWorker for child processes)
 * 3. Falls back to 'main' if nothing is configured
 */
export function getBranchBase(branchBase?: string): string {
  return branchBase || process.env.ANT_BRANCH_BASE || 'main';
}
