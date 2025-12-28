import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { SSEService } from '../SSEService';
import type { IDEService } from '../../ide/IDEService';

// Import sub-services
import { ProjectCrudService } from './ProjectCrudService';
import { FeatureCrudService } from './FeatureCrudService';
import { FileOperationService } from './FileOperationService';
import { GitService } from '../GitService';

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
  private readonly sseService?: SSEService;
  private readonly ideService?: IDEService;
  
  // Sub-services
  private readonly projectCrud: ProjectCrudService;
  private readonly featureCrud: FeatureCrudService;
  private readonly fileOps: FileOperationService;
  private readonly git: GitService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService,
    sseService?: SSEService,
    ideService?: IDEService
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.chatService = chatService;
    this.sseService = sseService;
    this.ideService = ideService;
    
    // Initialize sub-services
    this.projectCrud = new ProjectCrudService(workspaceResolver);
    this.featureCrud = new FeatureCrudService(workspaceResolver);
    this.fileOps = new FileOperationService(workspaceResolver);
    this.git = new GitService(workspaceResolver, githubAuthService, chatService, sseService);
    
    // ✅ Inject GitService.switchToFeatureBranch into FeatureCrudService
    this.featureCrud.setSwitchToFeatureBranchFn(
      this.git.switchToFeatureBranch.bind(this.git)
    );
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
  
  async deleteProject(id: string, userContext: UserContext): Promise<void> {
    // ✅ Cleanup IDE resources first (stop+remove containers, delete IDE home) to avoid dangling resources
    if (this.ideService) {
      await this.ideService.cleanupProject(userContext, id, { deleteHome: true });
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
  
  async createFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    return this.featureCrud.createFeature(projectId, featureName, userContext);
  }
  
  async deleteFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
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
  
  async getFileTree(projectId: string, featureName: string, userContext: UserContext): Promise<any> {
    return this.fileOps.getFileTree(projectId, featureName, userContext);
  }
  
  async readFile(projectId: string, featureName: string, filePath: string, userContext: UserContext): Promise<string> {
    return this.fileOps.readFile(projectId, featureName, filePath, userContext);
  }
  
  async writeFile(projectId: string, featureName: string, filePath: string, content: string, userContext: UserContext): Promise<void> {
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
  // Git Branch Operations (delegated to GitService)
  // =====================================
  
  async switchToFeatureBranch(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<{ branchName: string; currentBranch: string }> {
    return this.git.switchToFeatureBranch(projectId, featureName, userContext);
  }
  
  // =====================================
  // Git Status Operations (delegated to GitService)
  // =====================================
  
  async getGitStatus(projectId: string, userContext: UserContext): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    return this.git.getGitStatus(projectId, userContext);
  }
  
  async getGitChanges(projectId: string, userContext: UserContext): Promise<{
    hasChanges: boolean;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    ahead: number;
    behind: number;
    currentBranch?: string;
    isGitInitialized?: boolean;
  }> {
    return this.git.getGitChanges(projectId, userContext);
  }
  
  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.git.checkCloneStatus(projectId, userContext);
  }
  
  // =====================================
  // Git Remote Operations (delegated to GitService)
  // =====================================
  
  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.git.cloneGitHubRepo(projectId, userContext);
  }
  
  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.git.initializeGitHubRepo(projectId, userContext);
  }
  
  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.git.pushToGitHub(projectId, userContext);
  }
  
  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.git.pullFromGitHub(projectId, userContext);
  }
  
  async fetchFromGitHub(projectId: string, userContext: UserContext, featureName?: string): Promise<void> {
    return this.git.fetchFromGitHub(projectId, userContext, featureName);
  }
  
  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.git.syncWithRemote(projectId, userContext);
  }
  
  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.git.commitChanges(projectId, userContext, message);
  }
}

