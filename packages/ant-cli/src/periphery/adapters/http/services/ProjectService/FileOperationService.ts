import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';

/**
 * Protected root folders within inputs/outputs/sessions
 * These folders are preserved when deleted - only their contents are removed
 */
const PROTECTED_ROOT_FOLDERS = [
  'inputs/assets',
  'inputs/references',
  'inputs/sources',
  'outputs/design',
  'outputs/reports',
  'sessions/evalCode',
  'sessions/evalUiDesign',
  'sessions/planText',
];

/**
 * FileOperationService
 * 
 * Handles file and directory operations within features
 */
export class FileOperationService {
  private readonly workspaceResolver: WorkspaceResolver;
  
  constructor(workspaceResolver: WorkspaceResolver) {
    this.workspaceResolver = workspaceResolver;
  }
  
  /**
   * Check if the path is a protected root folder
   */
  private isProtectedFolder(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
    return PROTECTED_ROOT_FOLDERS.includes(normalized);
  }
  
  /**
   * Clear directory contents (files and subdirectories) but keep the directory itself
   */
  private async clearDirectoryContents(dirPath: string): Promise<void> {
    const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        // Recursively remove subdirectory
        await fs.promises.rm(itemPath, { recursive: true, force: true });
      } else {
        // Remove file
        await fs.promises.unlink(itemPath);
      }
    }
  }
  
  /**
   * Get file tree for a feature
   */
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<any> {
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);

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
        .filter(d => !d.name.startsWith('.'))
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
          tree.push({
            name: item.name,
            path: itemRelativePath,
            type: 'file'
          });
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
    
    await fs.promises.writeFile(fullPath, content, 'utf-8');
  }
  
  /**
   * Delete a file or directory
   * - For protected root folders (inputs/*, outputs/*, sessions/*): clears contents but keeps folder
   * - For regular files/directories: deletes completely
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
      // Check if this is a protected root folder
      if (this.isProtectedFolder(filePath)) {
        // Clear contents but keep the folder
        await this.clearDirectoryContents(fullPath);
        console.log(`[FileOperationService] Cleared contents of protected folder: ${filePath}`);
      } else {
        // Delete entire directory
        await fs.promises.rm(fullPath, { recursive: true, force: true });
        console.log(`[FileOperationService] Deleted directory: ${filePath}`);
      }
    } else {
      // Delete file
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

