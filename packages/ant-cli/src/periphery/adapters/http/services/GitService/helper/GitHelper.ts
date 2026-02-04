import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { logger } from '../../../../../../utils/logger';
import { UserContext } from '../../../../../../core/types/user';

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
    return simpleGit(targetPath);
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
      const git = simpleGit();
      
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

