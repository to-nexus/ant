import type {
  FileNode,
  FileResource,
  GitSnapshot,
  GitPatState,
  GitUserOperation,
} from '@ant/shared';
import type { GitStateBroadcaster } from '../../../../../core/realtime/GitStateBroadcaster';
import type { GitOperation, GitWatcherRetryPort } from '../GitService/remote/GitOperation';
import { WorkspaceResolver } from '../../../../../core/config/WorkspacePathResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import type { IDEOrchestratorPort } from '../../../../../core/ports/ideOrchestrator';

// Import sub-services
import { ProjectCrudService } from './ProjectCrudService';
import { FeatureCrudService } from './FeatureCrudService';
import { FileOperationService } from './FileOperationService';
import { GitService } from '../GitService';
import { WorktreeService } from '../GitService/worktree';

/**
 * ProjectService (Facade)
 * 
 * Main service that delegates to specialized sub-services.
 * Provides backward-compatible interface while internally using modular services.
 * 
 * 📦 Architecture:
 * - ProjectCrudService: Project CRUD operations
 * - FeatureCrudService: Feature CRUD operations
 * - FileOperationService: File operations within features
 * - GitService: All Git-related operations (branch, status, remote, indexing)
 */
export class ProjectService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;
  private readonly chatService?: ChatService;
  private readonly ideOrchestrator?: IDEOrchestratorPort;
  
  // Sub-services
  private readonly projectCrud: ProjectCrudService;
  private readonly featureCrud: FeatureCrudService;
  private readonly fileOps: FileOperationService;
  private readonly git: GitService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService,
    ideOrchestrator?: IDEOrchestratorPort
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.chatService = chatService;
    this.ideOrchestrator = ideOrchestrator;
    
    // Initialize sub-services
    this.projectCrud = new ProjectCrudService(workspaceResolver);
    this.featureCrud = new FeatureCrudService(workspaceResolver);
    this.fileOps = new FileOperationService(workspaceResolver);
    this.git = new GitService(workspaceResolver, githubAuthService, chatService);
    
    // ✅ Inject WorktreeService into FeatureCrudService for worktree-based feature isolation
    const worktreeService = new WorktreeService(workspaceResolver, githubAuthService);
    this.featureCrud.setWorktreeService(worktreeService);
  }
  
  // =====================================
  // Project CRUD (delegated)
  // =====================================
  
  async listProjects(userContext: UserContext): Promise<string[]> {
    return this.projectCrud.listProjects(userContext);
  }
  
  async createProject(id: string, userContext: UserContext): Promise<void> {
    return this.projectCrud.createProject(id, userContext);
  }
  
  async renameProject(oldId: string, newId: string, userContext: UserContext): Promise<void> {
    return this.projectCrud.renameProject(oldId, newId, userContext);
  }
  
  async deleteProject(id: string, userContext: UserContext): Promise<void> {
    // Cleanup IDE resources first (stop+remove pods/containers, delete IDE home) to avoid dangling resources
    if (this.ideOrchestrator) {
      try {
        await this.ideOrchestrator.cleanupProject(userContext, id, { deleteHome: true });
      } catch (e: any) {
        console.warn(`[ProjectService] IDE cleanup for project ${id} failed (non-critical): ${e.message}`);
      }
    }
    return this.projectCrud.deleteProject(id, userContext);
  }
  
  async getProjectConfig(id: string, userContext: UserContext): Promise<any> {
    return this.projectCrud.getProjectConfig(id, userContext);
  }
  
  async updateProjectConfig(projectId: string, config: any, userContext: UserContext): Promise<void> {
    return this.projectCrud.updateProjectConfig(projectId, config, userContext);
  }
  
  // =====================================
  // Feature CRUD (delegated)
  // =====================================
  
  async listFeatures(projectId: string, userContext: UserContext): Promise<string[]> {
    return this.featureCrud.listFeatures(projectId, userContext);
  }
  
  async createFeature(projectId: string, featureName: string, userContext: UserContext, language?: string, options?: { skipPrdTemplate?: boolean }): Promise<void> {
    return this.featureCrud.createFeature(projectId, featureName, userContext, language, options);
  }
  
  async deleteFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    // Stop IDE pod/container for this feature before deleting the feature directory
    if (this.ideOrchestrator) {
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      await this.ideOrchestrator.stop(tenantId, projectId, featureName).catch((e: any) => {
        console.warn(`[ProjectService] IDE stop for feature ${featureName} failed (non-critical): ${e.message}`);
      });
    }
    return this.featureCrud.deleteFeature(projectId, featureName, userContext);
  }
  
  async getSession(
    projectId: string,
    featureName: string = 'skeleton',
    job: 'design' | 'code' | 'learn' = 'code',
    userContext: UserContext
  ): Promise<any> {
    return this.featureCrud.getSession(projectId, featureName, job, userContext);
  }
  
  async resetJobState(
    projectId: string,
    featureName: string,
    jobType: 'design' | 'code' | 'learn',
    userContext: UserContext
  ): Promise<void> {
    return this.featureCrud.resetJobState(projectId, featureName, jobType, userContext);
  }
  
  // =====================================
  // File Operations (delegated)
  // =====================================
  
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<FileNode[]> {
    return this.fileOps.getFileTree(projectId, featureName, userContext);
  }
  
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<FileResource> {
    return this.fileOps.readFile(projectId, featureName, filePath, userContext);
  }
  
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<FileResource> {
    return this.fileOps.writeFile(projectId, featureName, filePath, content, userContext);
  }
  
  async deleteFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<void> {
    return this.fileOps.deleteFile(projectId, featureName, filePath, userContext);
  }
  
  async uploadFiles(
    projectId: string,
    featureName: string,
    files: Array<{ path: string; content: Buffer }>,
    userContext: UserContext
  ): Promise<void> {
    return this.fileOps.uploadFiles(projectId, featureName, files, userContext);
  }
  
  // =====================================
  // Greenfield Git API (delegated to GitService)
  // =====================================

  async getGitSnapshot(
    projectId: string,
    userContext: UserContext,
    featureName?: string,
    opts: { fresh?: boolean } = {},
  ): Promise<GitSnapshot> {
    return this.git.getSnapshot(projectId, userContext, featureName, opts);
  }

  async getGitPat(userContext: UserContext): Promise<GitPatState> {
    return this.git.getPat(userContext);
  }

  resolveGitOperation(
    kind: GitUserOperation['kind'],
    opts: { broadcaster?: GitStateBroadcaster; watcher?: GitWatcherRetryPort } = {},
  ): GitOperation<any, any> | null {
    return this.git.resolveOperation(kind, opts);
  }

  // =====================================
  // Clone status probe — exposed for the Wizard's polling helper.
  // =====================================

  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.git.checkCloneStatus(projectId, userContext);
  }
}

