import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../../core/types/user';

// Skip .git (worktree marker) and node_modules. node_modules is the
// concrete ENOTEMPTY trigger on EFS/NFS: pnpm symlink farms with thousands
// of entries race recursive rm. Other languages (Go, etc.) don't have an
// equivalent in-tree giant — for any other big directory the maxRetries
// option on fs.rm absorbs the transient EFS lag.
const BACKUP_IGNORE = new Set(['.git', 'node_modules']);

// `maxRetries`/`retryDelay` let Node retry rmdir on EFS/NFS eventual-consistency
// lag (ENOTEMPTY/EBUSY/EPERM) instead of failing the whole publish.
const RM_OPTS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 200,
} as const;

/**
 * FeatureCodebaseBackup
 *
 * Reusable backup/restore utility for feature codebases.
 * Used during worktree creation to preserve existing code that would
 * otherwise be lost when the directory is replaced by a git worktree.
 */
export class FeatureCodebaseBackup {
  constructor(private readonly workspaceResolver: WorkspaceResolver) {}

  /**
   * Read existing feature directories from a project path.
   * Filters out hidden directories and common base branch names.
   */
  static async readExistingFeatures(projectPath: string): Promise<string[]> {
    const featuresPath = path.join(projectPath, 'features');
    if (!fs.existsSync(featuresPath)) return [];

    const baseBranchNames = ['main', 'master', 'develop'];
    const items = await fs.promises.readdir(featuresPath);
    const features: string[] = [];

    for (const item of items) {
      if (item.startsWith('.')) continue;
      const itemPath = path.join(featuresPath, item);
      const stat = await fs.promises.stat(itemPath);
      if (stat.isDirectory() && !baseBranchNames.includes(item.toLowerCase())) {
        features.push(item);
      }
    }
    return features;
  }

  /**
   * Backup feature codebase directories to sibling .codebase-backup/ locations.
   * Returns a map of featureName -> backupPath.
   */
  async backup(
    projectId: string,
    features: string[],
    userContext: UserContext
  ): Promise<Map<string, string>> {
    const backups = new Map<string, string>();

    for (const featureName of features) {
      const featureCodebasePath = this.workspaceResolver.getCodebasePath(userContext, projectId, featureName);
      if (!fs.existsSync(featureCodebasePath)) continue;

      const files = await fs.promises.readdir(featureCodebasePath);
      const backupItems = files.filter(f => !BACKUP_IGNORE.has(f));
      if (backupItems.length === 0) continue;

      const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
      const backupPath = path.join(featurePath, '.codebase-backup');

      if (fs.existsSync(backupPath)) {
        await fs.promises.rm(backupPath, RM_OPTS);
      }

      console.log(`[FeatureCodebaseBackup] Backing up ${featureName} (${backupItems.length} items)`);
      await fs.promises.mkdir(backupPath, { recursive: true });
      for (const item of backupItems) {
        await fs.promises.cp(
          path.join(featureCodebasePath, item),
          path.join(backupPath, item),
          { recursive: true }
        );
      }
      backups.set(featureName, backupPath);
    }

    return backups;
  }

  /**
   * Restore backed-up files into a worktree directory.
   * Preserves the .git file used by git worktrees.
   */
  async restoreToWorktree(backupPath: string, worktreePath: string): Promise<void> {
    const existingItems = await fs.promises.readdir(worktreePath);
    for (const item of existingItems) {
      // Skip BACKUP_IGNORE entries so a leftover node_modules in the worktree
      // is left in place instead of triggering another EFS rm race.
      if (BACKUP_IGNORE.has(item)) continue;
      await fs.promises.rm(path.join(worktreePath, item), RM_OPTS);
    }

    const backupItems = await fs.promises.readdir(backupPath);
    for (const item of backupItems) {
      if (BACKUP_IGNORE.has(item)) continue;
      await fs.promises.cp(
        path.join(backupPath, item),
        path.join(worktreePath, item),
        { recursive: true }
      );
    }
  }

  /**
   * Clean up all backup directories.
   */
  async cleanup(featureBackups: Map<string, string>): Promise<void> {
    for (const [featureName, backupPath] of featureBackups) {
      try {
        if (fs.existsSync(backupPath)) {
          await fs.promises.rm(backupPath, RM_OPTS);
        }
      } catch (error: any) {
        console.warn(`[FeatureCodebaseBackup] Failed to clean up backup for ${featureName}: ${error.message}`);
      }
    }
  }
}
