/**
 * Branch utility functions
 * 
 * Base branch is auto-detected from the git repository and recorded in
 * project config (config.json -> branchBase). Detection happens at
 * clone/init/project-creation time; afterwards everything reads from config.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Reserved feature name used as the IDE container/key identifier
 * when no feature is selected (i.e., working on the base branch).
 * Users are forbidden from creating a feature with this name.
 */
export const RESERVED_FEATURE_NAME = '_base';

/**
 * Check if a feature name corresponds to the project's base branch.
 *
 * In Ant, "no feature selected" = base branch, identified by RESERVED_FEATURE_NAME ('_base').
 * User-created ant features always use feature/{name} git branches, so a feature named
 * "dev" is NOT the base branch even if the repo's default branch is also "dev".
 *
 * @param featureName - The feature/branch name to check
 * @param _branchBase - Unused. Kept for call-site compatibility.
 */
export function isBaseBranch(featureName: string, _branchBase?: string): boolean {
  return featureName === RESERVED_FEATURE_NAME;
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

/**
 * Detect the default branch from an actual git repository.
 *
 * Resolution order:
 * 1. Remote HEAD (refs/remotes/origin/HEAD) -- most reliable for cloned repos, no network needed
 * 2. Well-known branch names (main, master) -- check if they exist locally
 * 3. Current HEAD branch -- fallback for local-only repos
 *
 * Returns null when detection is not possible (no .git, detached HEAD, etc.).
 */
export async function detectGitDefaultBranch(codebasePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(path.join(codebasePath, '.git'))) return null;

    const simpleGit = (await import('simple-git')).default;
    const git = simpleGit({ baseDir: codebasePath });

    // 1) Remote HEAD -- set automatically after clone
    try {
      const ref = await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD']);
      const branch = ref.trim().replace('refs/remotes/origin/', '');
      if (branch) return branch;
    } catch { /* no remote or HEAD not set */ }

    // 2) Well-known default branch names
    for (const candidate of ['main', 'master']) {
      try {
        await git.raw(['show-ref', '--verify', `refs/heads/${candidate}`]);
        return candidate;
      } catch { /* branch doesn't exist */ }
    }

    // 3) Current branch as last resort
    try {
      const head = await git.raw(['symbolic-ref', '--short', 'HEAD']);
      return head.trim() || null;
    } catch { /* detached HEAD or no commits */ }

    return null;
  } catch {
    return null;
  }
}
