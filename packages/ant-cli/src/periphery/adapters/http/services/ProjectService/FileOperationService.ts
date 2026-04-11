import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { isCanonicalDir, clearCanonicalDirectory, ensureCanonicalStructure } from '../../../../../core/utils/sessionPaths';
import { isTemplateContent, normalizeTemplateDoc, getTemplateReason } from '../../../../../core/utils/templateDetector';

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
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<any> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

    // Reconcile canonical dirs/files for existing features (retroactive for newly added entries)
    await ensureCanonicalStructure(featurePath);

    const buildTree = async (dirPath: string, relativePath: string = ''): Promise<any> => {
      let items: fs.Dirent[] = [];
      try {
        // ✅ Use Dirent to sort directories-first without extra stat calls
        items = await fs.promises.readdir(dirPath, { withFileTypes: true });
      } catch (err) {
        // 폴더가 없으면 빈 배열 반환
        return [];
      }
      
      const tree: any[] = [];

      // ✅ 빈 폴더일 경우 빈 배열 반환 (children: []로 처리됨)
      // 자기 자신을 다시 반환하지 않음 (design/design 중복 버그 수정)
      if (items.length === 0) {
        return [];
      }

      // ✅ Sort: directories first, then files; both by name
      const sorted = items
        .filter(d => !d.name.startsWith('.') && !TREE_EXCLUDE.has(d.name))
        .sort((a, b) => {
          const ad = a.isDirectory();
          const bd = b.isDirectory();
          if (ad !== bd) return ad ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (const item of sorted) {

        const fullPath = path.join(dirPath, item.name);
        const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name;

        if (item.isDirectory()) {
          const children = await buildTree(fullPath, itemRelativePath);
          tree.push({
            name: item.name,
            path: itemRelativePath,
            type: 'directory',
            children
          });
        } else {
          const node: any = {
            name: item.name,
            path: itemRelativePath,
            type: 'file'
          };

          try {
            const stats = await fs.promises.stat(fullPath);
            node.size = stats.size;
            node.modifiedTime = stats.mtime.toISOString();
          } catch { /* skip stat failures */ }

          if (itemRelativePath.startsWith('inputs/sources/')) {
            try {
              const content = await fs.promises.readFile(fullPath, 'utf-8');
              const result = getTemplateReason(content, node.size ?? 0);
              if (result.reason) {
                node.isTemplate = true;
                node.templateReason = result.reason;
                if (result.contentLength !== undefined) node.templateContentLength = result.contentLength;
                if (result.threshold !== undefined) node.templateThreshold = result.threshold;
              }
            } catch { /* skip read failures */ }
          }

          tree.push(node);
        }
      }

      return tree;
    };

    try {
      const tree = await buildTree(featurePath);
      // 최상위 featurePath가 비어있으면 빈 폴더 반환
      if (tree.length === 0) {
        return [{
          name: path.basename(featurePath),
          path: '',
          type: 'directory',
          children: []
        }];
      }
      return tree;
    } catch (error) {
      console.error('[FileOperationService] Error building file tree:', error);
      return [{
        name: path.basename(featurePath),
        path: '',
        type: 'directory',
        children: []
      }];
    }
  }
  
  /**
   * Read file content
   */
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<string> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
    return await fs.promises.readFile(fullPath, 'utf-8');
  }
  
  /**
   * Write file content
   */
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });

    // Auto-strip ant:template marker when user saves real content in sources
    let finalContent = content;
    if (filePath.startsWith('inputs/sources/')) {
      const normalized = normalizeTemplateDoc(content);
      if (normalized !== null) {
        finalContent = normalized;
      }
    }

    await fs.promises.writeFile(fullPath, finalContent, 'utf-8');
  }
  
  /**
   * Delete a file or clear a directory's contents.
   * - Canonical directories: clear contents (preserve structure, remove files and non-canonical subdirs)
   * - Non-canonical directories: fully deleted
   * - Files: deleted
   */
  async deleteFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<void> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    const fullPath = path.join(featurePath, filePath);
    
    // Security: prevent path traversal
    if (!fullPath.startsWith(featurePath)) {
      throw new Error('Invalid file path');
    }
    
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
      
      // Security: prevent path traversal
      if (!fullPath.startsWith(featurePath)) {
        throw new Error(`Invalid file path: ${file.path}`);
      }
      
      // Ensure directory exists
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      
      await fs.promises.writeFile(fullPath, file.content);
    }
  }
}

