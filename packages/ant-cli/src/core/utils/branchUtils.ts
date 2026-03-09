/**
 * Branch utility functions
 * 
 * Base branch is determined by project config (config.json -> branchBase).
 * No hardcoded branch name lists.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a feature name corresponds to the project's base branch.
 * 
 * In Ant, "no feature selected" = base branch. Base branches are not features.
 * The base branch name comes from config.json's `branchBase` field.
 * In child processes (job-runner), it's available via `ANT_BRANCH_BASE` env var.
 * 
 * @param featureName - The feature/branch name to check
 * @param branchBase - The project's configured base branch (from config.branchBase or ANT_BRANCH_BASE)
 */
export function isBaseBranch(featureName: string, branchBase: string): boolean {
  return featureName.toLowerCase() === branchBase.toLowerCase();
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

/**
 * Read branchBase from project config.json.
 * Used by API server components that have access to the project path.
 */
export function readBranchBaseFromConfig(projectPath: string): string {
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
