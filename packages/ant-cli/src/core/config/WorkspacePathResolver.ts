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
import { featureNameToSlug, FEATURE_SLUG_SENTINEL } from '@ant/shared';
import { UserContext } from '../types/user';

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
   * Get codebase path for a feature.
   *
   * A project without features has NO codebase — `featureId` is required.
   * - For features: returns featurePath/codebase (a git worktree whose branch name == feature name)
   * - For local repoType: returns the configured localPath regardless of feature
   */
  getCodebasePath(userContext: UserContext, projectId: string, featureId: string): string;

  /**
   * Get the project's git anchor path — a hidden bare repo at
   * `{project}/repo.git`. All feature worktrees hang off this anchor.
   * Not meaningful for `repoType:'local'` projects (user-owned repo).
   */
  getGitAnchorPath(userContext: UserContext, projectId: string): string;

  /**
   * Get physical workspaces directory path
   */
  getPhysicalWorkspacesPath(): string;
}

/** Directory name of the bare git anchor inside a project. */
export const GIT_ANCHOR_DIR = 'repo.git';

/**
 * Build the on-disk feature directory path. A feature name may contain `/`
 * (git-style branch), so it is projected to a single-segment slug — the
 * directory never nests. This is the single FS chokepoint; downstream
 * `path.join(featurePath, …)` callers inherit the fix unchanged.
 *
 * Backstop: the input must be a raw NAME, never a slug — a `~` here means a
 * slug leaked in where a name was expected (double-encode bug), so we throw
 * loudly rather than silently produce a wrong directory.
 */
export function buildFeaturePath(projectPath: string, featureId: string): string {
  if (featureId.includes(FEATURE_SLUG_SENTINEL)) {
    throw new Error(
      `[WorkspacePathResolver] getFeaturePath expects a raw feature name, got a slug: ${JSON.stringify(featureId)}`,
    );
  }
  const slug = featureNameToSlug(featureId);
  const featurePath = path.join(projectPath, 'features', slug);
  if (path.basename(featurePath) !== slug) {
    throw new Error(
      `[WorkspacePathResolver] feature dir must be a single slug segment: ${JSON.stringify(featureId)} -> ${JSON.stringify(slug)}`,
    );
  }
  return featurePath;
}

/**
 * Shared codebase-path resolution used by every WorkspaceResolver
 * implementation. `repoType:'local'` short-circuits to the user-owned
 * localPath; otherwise the feature worktree codebase is returned.
 */
export function resolveCodebasePathFromConfig(
  projectPath: string,
  featurePath: string,
): string {
  const configPath = path.join(projectPath, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.repoType === 'local' && config.localPath) {
        return resolveLocalPath(config.localPath);
      }
    }
  } catch {
    // config not found or invalid — fall through to the feature worktree path
  }
  return path.join(featurePath, 'codebase');
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
      return buildFeaturePath(path.join(workspacesPath, 'local', 'user', context.project), context.featureFolder);
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
   * @param templatePath Relative path within templates (e.g., 'jobs/learn/base/system.md')
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
    return buildFeaturePath(this.getProjectPath(userContext, projectId), featureId);
  }
  
  getCodebasePath(userContext: UserContext, projectId: string, featureId: string): string {
    return resolveCodebasePathFromConfig(
      this.getProjectPath(userContext, projectId),
      this.getFeaturePath(userContext, projectId, featureId),
    );
  }

  getGitAnchorPath(userContext: UserContext, projectId: string): string {
    return path.join(this.getProjectPath(userContext, projectId), GIT_ANCHOR_DIR);
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
