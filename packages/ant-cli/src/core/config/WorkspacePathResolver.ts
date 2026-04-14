/**
 * Workspace Resolver
 * 
 * Unified workspace path resolution.
 * Uses userContext (organizationId/userId) to determine paths.
 * 
 * The caller is responsible for setting the correct userContext:
 * - local mode: { organizationId: 'local', userId: 'local' }
 * - cloud mode: { organizationId: 'to.nexus', userId: 'probe' } (from auth)
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { UserContext } from '../types/user';
import { RESERVED_FEATURE_NAME } from '../utils/branchUtils';

export interface WorkspaceResolver {
  /**
   * Get workspace root path for a user
   * @param userContext Contains organizationId and userId for path construction
   */
  getWorkspacePath(userContext: UserContext): string;
  
  /**
   * Get project path
   * @param userContext Contains organizationId and userId for path construction
   */
  getProjectPath(userContext: UserContext, projectId: string): string;
  
  /**
   * Get feature path
   * @param userContext Contains organizationId and userId for path construction
   */
  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string;
  
  /**
   * Get codebase path for a project or feature.
   * 
   * Centralized resolution of the codebase directory path.
   * - For main/base branch: returns projectPath/codebase (the main git worktree)
   * - For features: returns featurePath/codebase (a git worktree for that feature's branch)
   * - For local repoType: returns the configured localPath regardless of feature
   * 
   * @param userContext Contains organizationId and userId
   * @param projectId Project identifier
   * @param featureId Optional feature identifier. If omitted or 'main', returns the main codebase.
   */
  getCodebasePath(userContext: UserContext, projectId: string, featureId?: string): string;
  
  /**
   * Get physical workspaces directory path
   */
  getPhysicalWorkspacesPath(): string;
}

/**
 * Static utility for getting physical workspaces path
 */
export class WorkspacePathResolver {
  /**
   * Get physical workspaces directory path
   * ✅ NEW: Supports ANT_WORKSPACE_BASE_PATH for physical separation
   */
  static getPhysicalWorkspacesPath(): string {
    // ⭐ 환경변수로 물리적 위치 결정 (ant 소스와 분리 가능)
    if (process.env.ANT_WORKSPACE_BASE_PATH) {
      const envPath = path.resolve(process.env.ANT_WORKSPACE_BASE_PATH);
      
      // ✅ Validate the path is accessible (especially important on macOS)
      // macOS doesn't allow creating directories like /mnt without special permissions
      try {
        // Check if path exists or parent directory is writable
        if (fs.existsSync(envPath)) {
          return envPath;
        }
        
        // Try to create the path to validate it's accessible
        fs.mkdirSync(envPath, { recursive: true });
        return envPath;
      } catch (error: any) {
        console.warn(`[WorkspacePathResolver] ⚠️  ANT_WORKSPACE_BASE_PATH (${envPath}) is not accessible: ${error.message}`);
        console.warn(`[WorkspacePathResolver] Falling back to default workspace path`);
        // Continue to fallback logic below
      }
    }
    
    // ✅ Heuristic fallback: prefer sibling "ant-workspaces" if present.
    // This matches the common repo layout:
    //   <dev>/ant
    //   <dev>/ant-workspaces
    // 
    // Calculate from process.cwd() instead of __dirname to handle different execution contexts
    const cwd = process.cwd();
    const projectRoot = path.resolve(cwd); // Current working directory should be the project root
    const siblingWorkspaces = path.resolve(projectRoot, '../ant-workspaces');
    
    try {
      if (fs.existsSync(siblingWorkspaces) && fs.statSync(siblingWorkspaces).isDirectory()) {
        return siblingWorkspaces;
      }
    } catch {
      // ignore
    }
    
    // Fallback: legacy 방식 (ant 소스 내부)
    // Only use this if sibling doesn't exist
    const internalWorkspaces = path.join(projectRoot, 'workspaces');
    try {
      // Create if doesn't exist
      if (!fs.existsSync(internalWorkspaces)) {
        fs.mkdirSync(internalWorkspaces, { recursive: true });
      }
      return internalWorkspaces;
    } catch (e) {
      console.error('[WorkspacePathResolver] Failed to create workspaces directory:', e);
      // Last resort: return the path anyway
      return internalWorkspaces;
    }
  }
  
  /**
   * Helper: Resolve feature path from context
   * Extracts UserContext from ProjectContext and calls WorkspaceResolver
   * 
   * @param context ProjectContext with userId, organizationId
   * @param resolver WorkspaceResolver instance
   * @returns Feature path
   */
  static resolveFeaturePath(
    context: { project: string; featureFolder: string; userId?: string; organizationId?: string; featurePath?: string; workspaceResolver?: WorkspaceResolver },
    resolver?: WorkspaceResolver
  ): string {
    // ✅ Use cached featurePath if available (performance)
    if (context.featurePath) {
      return context.featurePath;
    }
    
    // ✅ Use provided resolver or extract from context
    const workspaceResolver = resolver || (context as any).workspaceResolver;
    if (!workspaceResolver) {
      // ⚠️ Fallback: construct ABSOLUTE path (assumes Local mode)
      console.warn('[WorkspacePathResolver.resolveFeaturePath] No resolver available, using fallback');
      const workspacesPath = WorkspacePathResolver.getPhysicalWorkspacesPath();
      return path.join(workspacesPath, 'local', 'user', context.project, 'features', context.featureFolder);
    }
    
    // ✅ Build UserContext from ProjectContext
    const userContext: UserContext = {
      userId: context.userId || 'local',
      organizationId: context.organizationId || 'local',
    };
    
    return workspaceResolver.getFeaturePath(userContext, context.project, context.featureFolder);
  }
  
  // ========================================
  // CLI Internal Resource Paths
  // ========================================
  
  /**
   * Get CLI root directory (for internal resources like templates, policies)
   * 
   * Resolution order:
   * 1. ANT_CLI_ROOT environment variable (set by JobWorker for child processes)
   * 2. Calculate from import.meta.url (for direct execution)
   * 
   * @returns CLI dist root path (e.g., /path/to/ant-cli/dist)
   */
  static getCliRoot(): string {
    // 1. Use ANT_CLI_ROOT if set (JobWorker passes this to child processes)
    if (process.env.ANT_CLI_ROOT) {
      return process.env.ANT_CLI_ROOT;
    }
    
    // 2. Calculate from current file location (or bundled output location)
    //    esbuild bundles everything into dist/composition/server.js,
    //    so we cannot count "../.." levels — find /dist/ in the path instead.
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    
    const distMarker = `${path.sep}dist${path.sep}`;
    const distIdx = currentDir.lastIndexOf(distMarker);
    if (distIdx !== -1) {
      return currentDir.substring(0, distIdx + distMarker.length - 1); // include "dist", exclude trailing sep
    }
    // Also handle path ending with /dist (no trailing separator)
    if (currentDir.endsWith(`${path.sep}dist`)) {
      return currentDir;
    }
    
    // 3. Not in dist — dev mode (tsx runs from src/ directly)
    //    WorkspacePathResolver.ts is at src/core/config/
    //    Go up 2 levels to reach src/
    return path.resolve(currentDir, '../..');
  }
  
  /**
   * Get prompt templates directory path
   * @returns Path to prompt/templates directory
   */
  static getPromptTemplatesPath(): string {
    return path.join(WorkspacePathResolver.getCliRoot(), 'core/prompt/templates');
  }
  
  /**
   * Get specific prompt template path
   * @param templatePath Relative path within templates (e.g., 'learn/system.md')
   * @returns Full path to the template file
   */
  static getPromptTemplatePath(templatePath: string): string {
    return path.join(WorkspacePathResolver.getPromptTemplatesPath(), templatePath);
  }
  
  /**
   * Get policies directory path
   * @returns Path to policies/prompts directory
   */
  static getPoliciesPath(): string {
    return path.join(WorkspacePathResolver.getCliRoot(), 'core/policies/prompts');
  }
  
  /**
   * Get profiles directory path
   * @returns Path to profiles directory
   */
  static getProfilesPath(): string {
    return path.join(WorkspacePathResolver.getCliRoot(), 'core/prompt/profiles');
  }
  
  /**
   * Get monorepo docs directory path
   * docs/ is at the monorepo root level (sibling of packages/)
   * @returns Path to docs directory (e.g., /app/docs)
   */
  static getDocsRoot(): string {
    const cliRoot = WorkspacePathResolver.getCliRoot();
    return path.resolve(cliRoot, '../../../docs');
  }
}


/**
 * Unified Workspace Resolver
 * 
 * Single implementation for both local and cloud modes.
 * Path structure: workspaces/<organizationId>/<userId>/<project>/features/<feature>
 * 
 * The caller determines the userContext:
 * - local mode: { organizationId: 'local', userId: 'local' }
 * - cloud mode: { organizationId: 'to.nexus', userId: 'probe' } (from auth)
 * 
 * This unified approach means the same code works regardless of mode.
 * The only difference is how userContext is populated (authentication layer).
 */
export class UnifiedWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly workspacesPath: string) {}
  
  getWorkspacePath(userContext: UserContext): string {
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId);
  }
  
  getProjectPath(userContext: UserContext, projectId: string): string {
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId, projectId);
  }
  
  getFeaturePath(userContext: UserContext, projectId: string, featureId: string): string {
    return path.join(this.workspacesPath, userContext.organizationId, userContext.userId, projectId, 'features', featureId);
  }
  
  getCodebasePath(userContext: UserContext, projectId: string, featureId?: string): string {
    const projectPath = this.getProjectPath(userContext, projectId);
    
    // Read project config for repoType and branchBase
    let branchBase = 'main';
    const configPath = path.join(projectPath, 'config.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.repoType === 'local' && config.localPath) {
          return resolveLocalPath(config.localPath);
        }
        if (config.branchBase) {
          branchBase = config.branchBase;
        }
      }
    } catch {
      // config not found or invalid - fall through to default cloud path
    }
    
    // Cloud mode: base branch → projectPath/codebase, feature → featurePath/codebase
    // Only RESERVED_FEATURE_NAME ('_base') maps to the main codebase path.
    // User-created ant features (e.g. 'dev') always get their own feature path,
    // even if the feature name matches the git repo's default branch (branchBase).
    // Ant features use feature/{name} git branches, so there is no path collision.
    if (!featureId || featureId === RESERVED_FEATURE_NAME) {
      return path.join(projectPath, 'codebase');
    }
    return path.join(this.getFeaturePath(userContext, projectId, featureId), 'codebase');
  }
  
  getPhysicalWorkspacesPath(): string {
    return this.workspacesPath;
  }
}

/**
 * Resolve a local path from config (supports ~, absolute, and relative paths)
 */
export function resolveLocalPath(localPath: string): string {
  if (!localPath) {
    throw new Error('Local path not configured');
  }
  if (localPath.startsWith('~')) {
    return localPath.replace('~', process.env.HOME || '');
  }
  if (path.isAbsolute(localPath)) {
    return localPath;
  }
  return path.resolve(process.cwd(), localPath);
}
