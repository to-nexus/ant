import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { logger } from '../../../../../../utils/logger';
import { UserContext } from '../../../../../../core/types/user';

/**
 * Default simple-git instance options shared across every git invocation in
 * the GitService surface. `timeout.block` kills a stuck child process if it
 * produces no stdout/stderr for this long — protects publish/init/push from
 * TLS/auth hangs that would otherwise pin the Redis init lock for its full
 * TTL. Spread into every `simpleGit({...})` call so the SSOT lives here.
 */
export const SIMPLE_GIT_DEFAULT_OPTS = {
  binary: 'git',
  maxConcurrentProcesses: 6,
  timeout: { block: 60_000 },
} as const;

/**
 * Worktree validity reasons emitted by {@link GitHelper.isWorktreeStructureValid}.
 * - `no-git-file`     — `.git` marker file does not exist (worktree never created)
 * - `invalid-marker`  — `.git` exists but has malformed `gitdir:` line / read failure
 * - `gitdir-missing`  — `.git/worktrees/<id>/` directory referenced by marker is absent
 * - `head-missing`    — meta directory exists but lacks `HEAD`
 * - `commondir-missing` — meta directory exists but lacks `commondir`
 */
export type WorktreeValidityReason =
  | 'no-git-file'
  | 'invalid-marker'
  | 'gitdir-missing'
  | 'head-missing'
  | 'commondir-missing';

/**
 * GitHelper
 * 
 * Utility functions for Git operations
 */
export class GitHelper {
  // ✅ Cache for safe.directory paths to prevent redundant calls and race conditions
  // Multiple concurrent calls to ensureSafeDirectory can cause .gitconfig lock errors
  private static safeDirectoryCache = new Set<string>();
  private static safeDirectoryPending = new Map<string, Promise<void>>();
  /**
   * 🛡️ CRITICAL SAFETY: Get Git instance only if .git exists in EXACT directory
   * 
   * Prevents simpleGit from traversing up to parent directories (e.g., ant source code).
   * Returns null if .git is not found in the specified path.
   * 
   * @param targetPath - The exact directory where .git should exist
   * @returns SimpleGit instance or null if not initialized
   */
  static getGitInstanceSafe(targetPath: string): SimpleGit | null {
    const gitDir = path.join(targetPath, '.git');
    
    if (!fs.existsSync(gitDir)) {
      // Keep this visible at info because it often explains downstream git failures.
      logger.info(`.git not found`, { component: 'GitHelper' }, { targetPath });
      return null;
    }
    
    // Too noisy in normal operation; keep for debug only.
    logger.debug(`.git verified`, { component: 'GitHelper' }, { targetPath });
    return simpleGit({ baseDir: targetPath, ...SIMPLE_GIT_DEFAULT_OPTS });
  }

  /**
   * Check if a directory has Git initialized
   */
  static hasGitInitialized(targetPath: string): boolean {
    const gitDir = path.join(targetPath, '.git');
    return fs.existsSync(gitDir);
  }

  /**
   * Sanitize branch name for Git
   */
  static sanitizeBranchName(featureName: string): string {
    return `feature/${featureName.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * Ensure Git user config (user.email, user.name) is set for the repository.
   * Uses local (repo-level) config to avoid affecting global settings.
   * 
   * This is essential for cloud environments where global git config is not set.
   * Derives email from UserContext: `${userId}@${organizationId}`
   * 
   * @param git - SimpleGit instance
   * @param userContext - User context containing userId and organizationId
   */
  /**
   * Ensure the directory is added to Git's safe.directory config.
   * 
   * This is essential for cloud environments where the git process user
   * may differ from the file owner (causes "dubious ownership" error).
   * 
   * Uses global config since this is a security exception that needs
   * to persist across git commands.
   * 
   * ✅ OPTIMIZED: Caches already-added paths and coalesces concurrent calls
   * to prevent .gitconfig lock errors from race conditions.
   * 
   * @param targetPath - The absolute path to the git repository
   */
  static async ensureSafeDirectory(targetPath: string): Promise<void> {
    // ✅ Skip if already added (memory cache)
    if (this.safeDirectoryCache.has(targetPath)) {
      logger.debug(`safe.directory already cached`, { component: 'GitHelper' }, { path: targetPath });
      return;
    }
    
    // ✅ Coalesce concurrent calls for the same path
    // This prevents multiple simultaneous git config commands that cause lock errors
    const pending = this.safeDirectoryPending.get(targetPath);
    if (pending) {
      logger.debug(`safe.directory call pending, waiting`, { component: 'GitHelper' }, { path: targetPath });
      return pending;
    }
    
    // ✅ Create and cache the promise
    const operation = this.doEnsureSafeDirectory(targetPath);
    this.safeDirectoryPending.set(targetPath, operation);
    
    try {
      await operation;
    } finally {
      this.safeDirectoryPending.delete(targetPath);
    }
  }
  
  /**
   * Internal: Actually add the directory to safe.directory
   */
  private static async doEnsureSafeDirectory(targetPath: string): Promise<void> {
    try {
      const git = simpleGit(SIMPLE_GIT_DEFAULT_OPTS);
      
      // Add the directory to safe.directory (global config)
      // This command is idempotent - adding the same path multiple times is safe
      await git.raw(['config', '--global', '--add', 'safe.directory', targetPath]);
      
      // ✅ Add to cache on success
      this.safeDirectoryCache.add(targetPath);
      
      logger.info(`Added to safe.directory`, { component: 'GitHelper' }, { path: targetPath });
    } catch (error) {
      // ✅ Downgrade to debug level for lock errors (common in concurrent scenarios)
      // The operation is best-effort and usually succeeds on subsequent calls
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('could not lock config file')) {
        logger.debug(`safe.directory lock conflict (will retry on next call)`, { component: 'GitHelper' }, { path: targetPath });
      } else {
        logger.warn(`Failed to add safe.directory`, { component: 'GitHelper' }, { path: targetPath, error });
      }
      // Don't throw - this is a best-effort operation
    }
  }

  /**
   * Resolve absolute paths derived from a worktree's `.git` marker file.
   *
   * Single source of truth for parsing `.git` marker → `mainGitDir` + `worktreePath`.
   * Used by both Docker (`resolveWorktreeBindMounts`) and K8s
   * (`resolveK8sWorktreeMounts`) — keeps the `.git` parsing logic in one place.
   *
   * @returns `{ mainGitDir, worktreePath }` when marker is valid AND mainGitDir
   *   exists on disk; `null` otherwise. Caller may distinguish reasons via
   *   {@link isWorktreeStructureValid}.
   */
  static resolveWorktreeAbsPaths(featureCodebasePath: string): {
    mainGitDir: string;
    worktreePath: string;
  } | null {
    const gitPath = path.join(featureCodebasePath, '.git');

    if (!fs.existsSync(gitPath)) return null;

    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      // Regular .git directory — not a worktree (base branch case)
      return null;
    }

    let content: string;
    try {
      content = fs.readFileSync(gitPath, 'utf-8').trim();
    } catch (error) {
      logger.warn(`Failed to read .git marker`, { component: 'GitHelper' }, { featureCodebasePath, error });
      return null;
    }

    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) {
      logger.warn(`Unexpected .git file format in worktree`, { component: 'GitHelper' }, { featureCodebasePath, content });
      return null;
    }

    const gitdirPath = match[1].trim();
    // gitdirPath = /<base>/<proj>/codebase/.git/worktrees/{id}
    // mainGitDir = /<base>/<proj>/codebase/.git
    const worktreesDir = path.dirname(gitdirPath);
    const mainGitDir = path.dirname(worktreesDir);

    if (!fs.existsSync(mainGitDir)) {
      logger.warn(`Main .git directory not found`, { component: 'GitHelper' }, { mainGitDir, featureCodebasePath });
      return null;
    }

    return { mainGitDir, worktreePath: featureCodebasePath };
  }

  /**
   * Stage-4 worktree validity check.
   *
   * Verifies that a feature codebase is a fully-formed git worktree, NOT just
   * "has a .git marker". Catches partial NFS writes where `git worktree add`
   * reports exit-code 0 but some meta files (`HEAD` / `commondir`) failed to
   * land on EFS.
   *
   * Cheap (4 stat calls). Used by:
   * - `WorktreeService.createWorktree` early-return + post-create probe
   * - `WorktreeService.pruneCorruptWorktreeMeta` orphan detection
   * - `ensureGitRepository` stage-4 check (lazy worktree self-heal)
   * - `StatusService.getGitChanges` defense-in-depth auto-recovery
   */
  static isWorktreeStructureValid(featureCodebasePath: string):
    | { valid: true }
    | { valid: false; reason: WorktreeValidityReason } {
    const gitPath = path.join(featureCodebasePath, '.git');

    if (!fs.existsSync(gitPath)) {
      return { valid: false, reason: 'no-git-file' };
    }

    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      // .git is a directory → main repo, treat as valid (worktree validity is per-feature only)
      return { valid: true };
    }

    let content: string;
    try {
      content = fs.readFileSync(gitPath, 'utf-8').trim();
    } catch {
      return { valid: false, reason: 'invalid-marker' };
    }

    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return { valid: false, reason: 'invalid-marker' };

    const gitdirPath = match[1].trim();
    if (!fs.existsSync(gitdirPath)) {
      return { valid: false, reason: 'gitdir-missing' };
    }

    if (!fs.existsSync(path.join(gitdirPath, 'HEAD'))) {
      return { valid: false, reason: 'head-missing' };
    }

    if (!fs.existsSync(path.join(gitdirPath, 'commondir'))) {
      return { valid: false, reason: 'commondir-missing' };
    }

    return { valid: true };
  }

  /**
   * Resolve Git worktree bind mounts needed for Docker containers.
   *
   * A worktree's .git is a file (not a directory) containing a gitdir reference
   * to the main repository's .git/worktrees/{name} directory. For Docker containers,
   * both the main .git directory and the worktree path must be accessible at their
   * original host absolute paths for git operations to work.
   *
   * Implementation note: `.git` parsing is delegated to {@link resolveWorktreeAbsPaths}
   * (shared with K8s side via `resolveK8sWorktreeMounts`) — keeps the duplicated
   * parsing logic in one place. This function only owns the Docker bind format.
   *
   * @param worktreePath - Absolute path to the worktree codebase directory
   * @returns Additional bind mount strings for Docker, or empty array if not a worktree
   */
  static resolveWorktreeBindMounts(worktreePath: string): string[] {
    const abs = GitHelper.resolveWorktreeAbsPaths(worktreePath);
    if (!abs) return [];

    const binds: string[] = [
      `${abs.mainGitDir}:${abs.mainGitDir}:rw`,
      `${abs.worktreePath}:${abs.worktreePath}:rw`,
    ];

    logger.info(`Resolved worktree bind mounts`, { component: 'GitHelper' }, {
      worktreePath: abs.worktreePath,
      mainGitDir: abs.mainGitDir,
      bindCount: binds.length,
    });

    return binds;
  }

  static async ensureUserConfig(git: SimpleGit, userContext: UserContext): Promise<void> {
    try {
      // Check if user.email is already configured (local or global)
      let hasEmail = false;
      let hasName = false;

      try {
        const email = await git.raw(['config', 'user.email']);
        hasEmail = !!email.trim();
      } catch {
        hasEmail = false;
      }

      try {
        const name = await git.raw(['config', 'user.name']);
        hasName = !!name.trim();
      } catch {
        hasName = false;
      }

      // Derive email and name from UserContext
      const derivedEmail = `${userContext.userId}@${userContext.organizationId}`;
      const derivedName = userContext.userId;

      // Set local config if not already set
      if (!hasEmail) {
        await git.addConfig('user.email', derivedEmail, false, 'local');
        logger.info(`Git user.email configured`, { component: 'GitHelper' }, { email: derivedEmail });
      }

      if (!hasName) {
        await git.addConfig('user.name', derivedName, false, 'local');
        logger.info(`Git user.name configured`, { component: 'GitHelper' }, { name: derivedName });
      }
    } catch (error) {
      logger.warn(`Failed to configure git user`, { component: 'GitHelper' }, { error });
      // Don't throw - this is a best-effort operation
    }
  }
}

