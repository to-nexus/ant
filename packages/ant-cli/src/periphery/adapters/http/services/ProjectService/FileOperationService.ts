import * as fs from 'fs';
import * as path from 'path';
import type { FileNode, FileResource } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { isCanonicalDir, clearCanonicalDirectory, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import { normalizeTemplateDoc } from '../../../../../core/utils/templateDetector';
import { computeFileMeta, shouldEvaluateTemplate } from '../../../../../core/utils/computeFileMeta';

const TREE_EXCLUDE = new Set([
  'node_modules',
  'dist',
  'build',
  '__pycache__',
  'codebase',
]);

/**
 * FileOperationService
 * 
 * Handles file and directory operations within features.
 * 
 * Every file-meta surface (tree / read / write) routes template state
 * computation through `computeFileMeta` — there is no inline duplication.
 * 
 * Deletion / clearing behavior:
 * - Canonical directories (defined in CANONICAL_FEATURE_DIRS): contents cleared,
 *   directory structure preserved. Non-canonical subdirectories within are fully removed.
 * - Non-canonical directories (user-created): fully deleted (rm -rf).
 */
export class FileOperationService {
  private readonly workspaceResolver: WorkspaceResolver;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * @deprecated Use clearCanonicalDirectory() from sessionPaths.ts directly.
   * Kept as a thin wrapper for backward compatibility within this class.
   */
  private async smartClearDirectory(dirPath: string, relativePath: string): Promise<void> {
    return clearCanonicalDirectory(dirPath, relativePath);
  }

  private resolveFullPath(projectId: string, featureName: string, filePath: string, userContext: UserContext): { featurePath: string; fullPath: string } {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    return { featurePath, fullPath };
  }
  
  /**
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<FileNode[]> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    // Reconcile canonical dirs/files for existing features (retroactive for newly added entries)
    await ensureCanonicalStructure(featurePath);

    const buildTree = async (dirPath: string, relativePath: string = ''): Promise<FileNode[]> => {
      let items: fs.Dirent[] = [];
      try {
        items = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch {
        return [];
      }

      if (items.length === 0) {
        return [];
      }

      const sorted = items
        .filter(d => !d.name.startsWith('.') && !TREE_EXCLUDE.has(d.name))
        .sort((a, b) => {
          const ad = a.isDirectory();
          const bd = b.isDirectory();
          if (ad !== bd) return ad ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      const tree: FileNode[] = [];
      for (const item of sorted) {
        const fullPath = path.join(dirPath, item.name);
        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory()) {
          const children = await buildTree(fullPath, itemRelativePath);
          tree.push({
            name: item.name,
            path: itemRelativePath,
            type: 'directory',
            children,
          });
          continue;
        }

        let size = 0;
        let mtimeMs = 0;
        try {
          const stats = await fs.promises.stat(fullPath);
          size = stats.size;
          mtimeMs = stats.mtimeMs;
        } catch { /* skip stat failures */ }

        let content: string | null = null;
        if (shouldEvaluateTemplate(itemRelativePath)) {
          try {
            content = await fs.promises.readFile(fullPath, 'utf-8');
          } catch { /* skip read failures */ }
        }

        const meta = computeFileMeta({
          relativePath: itemRelativePath,
          content,
          size,
          mtime: mtimeMs,
        });

        tree.push({
          name: item.name,
          path: itemRelativePath,
          type: 'file',
          meta,
        });
      }

      return tree;
    };

    try {
      const tree = await buildTree(featurePath);
      if (tree.length === 0) {
        return [{
          name: path.basename(featurePath),
          path: '',
          type: 'directory',
          children: [],
        }];
      }
      return tree;
    } catch (error) {
      console.error('[FileOperationService] Error building file tree:', error);
      return [{
        name: path.basename(featurePath),
        path: '',
        type: 'directory',
        children: [],
      }];
    }
  }
  
  /**
   * Read file as a FileResource (content + ground-truth meta).
   */
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);

    const [content, stats] = await Promise.all([
      fs.promises.readFile(fullPath, 'utf-8'),
      fs.promises.stat(fullPath),
    ]);

    const meta = computeFileMeta({
      relativePath: filePath,
      content,
      size: stats.size,
      mtime: stats.mtimeMs,
    });

    return { projectId, featureName, path: filePath, content, meta };
  }
  
  /**
   * Write file content and return the ground-truth FileResource (normalized
   * content + recomputed meta). This is the single mutation surface for text
   * files; HTTP PUT routes MUST delegate here.
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);

    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    let finalContent = content;
    if (filePath.startsWith('plan/')) {
      const normalized = normalizeTemplateDoc(content);
      if (normalized !== null) {
        finalContent = normalized;
      }
    }

    await fs.promises.writeFile(fullPath, finalContent, 'utf-8');

    const stats = await fs.promises.stat(fullPath);
    const meta = computeFileMeta({
      relativePath: filePath,
      content: finalContent,
      size: stats.size,
      mtime: stats.mtimeMs,
    });

    return { projectId, featureName, path: filePath, content: finalContent, meta };
  }
  
  /**
   * Delete a file or clear a directory's contents.
   * - Canonical directories: clear contents (preserve structure, remove files and non-canonical subdirs)
   * - Non-canonical directories: fully deleted
   * - Files: deleted
   */
  async deleteFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<void> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);

    const stat = await fs.promises.stat(fullPath);
    
    if (stat.isDirectory()) {
      if (isCanonicalDir(filePath)) {
        await this.smartClearDirectory(fullPath, filePath);
        console.log(`[FileOperationService] Cleared contents: ${filePath}`);
      } else {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        console.log(`[FileOperationService] Deleted: ${filePath}`);
      }
    } else {
      await fs.promises.unlink(fullPath);
    }
  }
  
  /**
   * Upload multiple files
   */
  async uploadFiles(
    projectId: string,
    featureName: string,
    files: Array<{ path: string; content: Buffer }>,
    userContext: UserContext
  ): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    
    for (const file of files) {
      const fullPath = path.join(featurePath, file.path);
      
      if (!fullPath.startsWith(featurePath)) {
        throw new Error(`Invalid file path: ${file.path}`);
      }
      
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      await fs.promises.writeFile(fullPath, file.content);
    }
  }
}
