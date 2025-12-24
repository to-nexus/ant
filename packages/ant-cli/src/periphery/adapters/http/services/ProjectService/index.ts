import { WorkspaceResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { UserContext } from '../../../../../core/types/user';
import { GitHubAuthService } from '../../../auth/GitHubAuthService';
import { ChatService } from '../ChatService';
import { SSEService } from '../SSEService';

// Import sub-services
import { ProjectCrudService } from './ProjectCrudService';
import { FeatureCrudService } from './FeatureCrudService';
import { FileOperationService } from './FileOperationService';
import { GitHelper } from './git/GitHelper';
import { GitBranchService } from './git/GitBranchService';
import { GitStatusService } from './git/GitStatusService';
import { GitRemoteService } from './git/GitRemoteService';
import { GitIndexService } from './git/GitIndexService';

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
 * - GitBranchService: Branch switching and stash management
 * - GitStatusService: Git status queries
 * - GitRemoteService: Remote operations (clone, push, pull, fetch)
 * - GitIndexService: AI/LLM indexing operations
 */
export class ProjectService {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly githubAuthService?: GitHubAuthService;
  private readonly chatService?: ChatService;
  private readonly sseService?: SSEService;
  
  // Sub-services
  private readonly projectCrud: ProjectCrudService;
  private readonly featureCrud: FeatureCrudService;
  private readonly fileOps: FileOperationService;
  private readonly gitBranch: GitBranchService;
  private readonly gitStatus: GitStatusService;
  private readonly gitRemote: GitRemoteService;
  private readonly gitIndex: GitIndexService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService,
    sseService?: SSEService
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.chatService = chatService;
    this.sseService = sseService;
    
    // Initialize sub-services
    this.projectCrud = new ProjectCrudService(workspaceResolver);
    this.featureCrud = new FeatureCrudService(workspaceResolver);
    this.fileOps = new FileOperationService(workspaceResolver);
    this.gitBranch = new GitBranchService(workspaceResolver, githubAuthService);
    this.gitStatus = new GitStatusService(workspaceResolver);
    this.gitRemote = new GitRemoteService(workspaceResolver, githubAuthService, sseService);
    this.gitIndex = new GitIndexService(workspaceResolver, sseService, chatService);
    
    // ✅ Inject GitBranchService.switchToFeatureBranch into FeatureCrudService
    this.featureCrud.setSwitchToFeatureBranchFn(
      this.gitBranch.switchToFeatureBranch.bind(this.gitBranch)
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
  // Git Branch Operations (delegated)
  // =====================================
  
  async switchToFeatureBranch(
    projectId: string,
    featureName: string,
    userContext: UserContext
  ): Promise<{ branchName: string; currentBranch: string }> {
    return this.gitBranch.switchToFeatureBranch(projectId, featureName, userContext);
  }
  
  // =====================================
  // Git Status Operations (delegated - TO BE IMPLEMENTED)
  // =====================================
  
  async getGitStatus(projectId: string, userContext: UserContext): Promise<{
    hasGit: boolean;
    hasCodebase: boolean;
    hasFeatures: boolean;
    currentBranch?: string;
  }> {
    return this.gitStatus.getGitStatus(projectId, userContext);
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
    return this.gitStatus.getGitChanges(projectId, userContext);
  }
  
  async checkCloneStatus(projectId: string, userContext: UserContext): Promise<boolean> {
    return this.gitStatus.checkCloneStatus(projectId, userContext);
  }
  
  // =====================================
  // Git Remote Operations (delegated - TO BE IMPLEMENTED)
  // =====================================
  
  async cloneGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.gitRemote.cloneGitHubRepo(projectId, userContext);
  }
  
  async initializeGitHubRepo(projectId: string, userContext: UserContext): Promise<void> {
    return this.gitRemote.initializeGitHubRepo(projectId, userContext);
  }
  
  async pushToGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.gitRemote.pushToGitHub(projectId, userContext);
  }
  
  async pullFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.gitRemote.pullFromGitHub(projectId, userContext);
  }
  
  async fetchFromGitHub(projectId: string, userContext: UserContext): Promise<void> {
    return this.gitRemote.fetchFromGitHub(projectId, userContext);
  }
  
  async syncWithRemote(projectId: string, userContext: UserContext): Promise<{
    success: boolean;
    pulledChanges?: boolean;
    pushedChanges?: boolean;
  }> {
    return this.gitRemote.syncWithRemote(projectId, userContext);
  }
  
  async commitChanges(
    projectId: string,
    userContext: UserContext,
    message?: string
  ): Promise<{ success: boolean; commitHash?: string }> {
    return this.gitRemote.commitChanges(projectId, userContext, message);
  }
}

