import * as fs from 'fs';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';

/**
 * GitHelper
 * 
 * Utility functions for Git operations
 */
export class GitHelper {
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
      console.log(`[GitHelper] 🚫 .git not found at: ${targetPath}`);
      return null;
    }
    
    console.log(`[GitHelper] ✅ .git verified at: ${targetPath}`);
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
}

