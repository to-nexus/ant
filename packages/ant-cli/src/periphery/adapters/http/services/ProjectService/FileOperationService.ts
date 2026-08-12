import * as fs from 'fs';
import * as path from 'path';
import type { FileNode, FileResource } from '@ant/shared';
import { isFeatureTreeRootEntry } from '@ant/shared';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { assertWithinRoot } from '../../../../../core/config/pathContainment';
import { UserContext } from '../../../../../core/types/user';
import { isCanonicalDir, clearCanonicalDirectory, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import {
  buildUniversalMergedTree,
  decorateUniversalTree,
  resolveUniversalContainerPath,
  resolveUniversalMergedPath,
} from '../../../../../core/customAgents/universalContainer';
import { normalizeTemplateDoc } from '../../../../../core/utils/templateDetector';
import { computeFileMeta, shouldEvaluateTemplate } from '../../../../../core/utils/computeFileMeta';
import { isBinaryPath, isBinaryFileSync, sniffFile } from '../../../../../core/utils/binaryExtensions';
import { writeBufferVerified } from '../../../../../core/utils/binaryIntegrity';

/**
 * Thrown when the text file API is pointed at binary content. Routes map it
 * to HTTP 422 so the FE can distinguish it from real failures.
 * - 'BINARY_FILE'   — read refused (use /files-raw/)
 * - 'BINARY_TARGET' — write refused (binary enters via the upload route only)
 */
export class BinaryFileOperationError extends Error {
  readonly code: 'BINARY_FILE' | 'BINARY_TARGET';
  readonly size?: number;

  constructor(code: 'BINARY_FILE' | 'BINARY_TARGET', filePath: string, size?: number) {
    super(
      code === 'BINARY_FILE'
        ? `Binary file cannot be read as text: ${filePath}`
        : `Binary file cannot be written via the text file API: ${filePath}`,
    );
    this.code = code;
    this.size = size;
  }
}

/**
 * Blacklist for depth ≥ 1 only. The feature root is governed by the
 * `isFeatureTreeRootEntry` allowlist, which already excludes `codebase/`
 * (not a canonical dir) and everything else that is not an artifact domain.
 */
const TREE_EXCLUDE = new Set([
  'node_modules',
  'dist',
  'build',
  '__pycache__',
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

  /**
   * Universal seam: when `featureName` is the universal pseudo-feature on a
   * universal-type project, file paths resolve against the container's merged
   * view (`artifacts/**` + grafted `sessions/**`) instead of `features/…`.
   * Null on canonical projects — every existing path is untouched.
   */
  private resolveUniversalContainer(projectId: string, featureName: string, userContext: UserContext): string | null {
    const projectPath = this.workspaceResolver.getProjectPath(userContext, projectId);
    return resolveUniversalContainerPath(projectPath, featureName);
  }

  private resolveFullPath(projectId: string, featureName: string, filePath: string, userContext: UserContext): { featurePath: string; fullPath: string } {
    const containerPath = this.resolveUniversalContainer(projectId, featureName, userContext);
    if (containerPath) {
      return { featurePath: containerPath, fullPath: resolveUniversalMergedPath(containerPath, filePath) };
    }
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    // Traversal + symlink-redirect guard (shared SSOT with the route-level
    // raw/download handlers, which bypass this service).
    let fullPath: string;
    try {
      fullPath = assertWithinRoot(featurePath, filePath);
    } catch {
      throw new Error('Invalid file path');
    }
    return { featurePath, fullPath };
  }
  
  /**
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<FileNode[]> {
    // Universal seam: merged container view, no canonical-feature scaffolding.
    // FileNode meta computation is preserved so fileSlice.refreshFileTree /
    // stale detection / the Redis tree cache stay shape-compatible.
    const containerPath = this.resolveUniversalContainer(projectId, featureName, userContext);
    if (containerPath) {
      return decorateUniversalTree(buildUniversalMergedTree(containerPath));
    }

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
        .filter(d => (relativePath === ''
          ? isFeatureTreeRootEntry(d.name)
          : !d.name.startsWith('.') && !TREE_EXCLUDE.has(d.name)))
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
   *
   * Binary files are refused (`code: 'BINARY_FILE'` → HTTP 422): decoding
   * them as utf-8 is lossy (every invalid byte → U+FFFD), and a subsequent
   * save round-trips the replacement chars back to disk, destroying the
   * file. Binary reads go through `/files-raw/` instead.
   */
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);

    const stats = await fs.promises.stat(fullPath);
    if (stats.isFile()) {
      const sniff = sniffFile(fullPath);
      if (sniff.binary) {
        throw new BinaryFileOperationError('BINARY_FILE', filePath, sniff.size ?? stats.size);
      }
    }

    const content = await fs.promises.readFile(fullPath, 'utf-8');

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
   *
   * Binary targets are refused (`code: 'BINARY_TARGET'` → HTTP 422): a
   * string body re-encoded as utf-8 destroys binary content (the Duck.glb
   * mojibake incident — U+FFFD round-trip). Binary files enter only via the
   * Buffer-safe upload route.
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<FileResource> {
    const { fullPath } = this.resolveFullPath(projectId, featureName, filePath, userContext);

    if (isBinaryPath(filePath) || isBinaryFileSync(fullPath)) {
      throw new BinaryFileOperationError('BINARY_TARGET', filePath);
    }

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
    for (const file of files) {
      const { fullPath } = this.resolveFullPath(projectId, featureName, file.path, userContext);
      await writeBufferVerified(fullPath, file.content);
    }
  }
}
