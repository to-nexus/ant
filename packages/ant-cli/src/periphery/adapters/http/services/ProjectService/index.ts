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
import type { StateStorePort } from '../../../../../core/ports/stateStore';
import type { JobQueuePort } from '../../../../../core/ports/queue';
import { logger } from '../../../../../utils/logger';
import { requestPreviewCleanup } from './previewCleanup';
import { cancelAllProjectJobs } from './projectJobCascade';

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
  private readonly stateStore?: StateStorePort;
  private readonly jobQueue?: JobQueuePort;

  // Sub-services
  private readonly projectCrud: ProjectCrudService;
  private readonly featureCrud: FeatureCrudService;
  private readonly fileOps: FileOperationService;
  private readonly git: GitService;
  
  constructor(
    workspaceResolver: WorkspaceResolver,
    githubAuthService?: GitHubAuthService,
    chatService?: ChatService,
    ideOrchestrator?: IDEOrchestratorPort,
    stateStore?: StateStorePort,
    jobQueue?: JobQueuePort,
  ) {
    this.workspaceResolver = workspaceResolver;
    this.githubAuthService = githubAuthService;
    this.chatService = chatService;
    this.ideOrchestrator = ideOrchestrator;
    this.stateStore = stateStore;
    this.jobQueue = jobQueue;

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
  
  /**
   * Create a project, with optional force-recreate.
   *
   * `opts.force === true` invokes `deleteProject` first so a stale directory
   * (left by a previous failed delete) doesn't surface as 409. Errors during
   * the pre-delete step are propagated EXCEPT "Project not found" which is
   * the expected case when force is enabled defensively.
   */
  async createProject(id: string, userContext: UserContext, opts?: { force?: boolean }): Promise<void> {
    if (opts?.force) {
      try {
        await this.deleteProject(id, userContext);
      } catch (e: any) {
        if (e?.message !== 'Project not found') throw e;
      }
    }
    return this.projectCrud.createProject(id, userContext);
  }

  async renameProject(oldId: string, newId: string, userContext: UserContext): Promise<void> {
    return this.projectCrud.renameProject(oldId, newId, userContext);
  }

  /**
   * Delete a project end-to-end.
   *
   * Cascade order — each step closes a "Project already exists" failure mode:
   *   1. cancelAllProjectJobs — Redis seal + child exit wait so EFS open
   *      file handles are released before fs.rm runs.
   *   2. ideOrchestrator.cleanupProject — stop pods/containers + delete IDE
   *      home dir. waitForPodDeletion happens inside KubernetesIDEOrchestrator.stop.
   *   3. requestPreviewCleanup — Redis pub/sub to ant-preview process.
   *      ack timeout is logged + tolerated (preview may not be running in dev).
   *   4. stateStore.cleanupProject — DEL all project-scoped Redis keys.
   *   5. projectCrud.deleteProject — fs.rm with verification loop.
   */
  async deleteProject(id: string, userContext: UserContext): Promise<void> {
    // Step 1 — cancel all jobs and wait for children to exit.
    if (this.stateStore && this.jobQueue) {
      try {
        const features = await this.featureCrud.listFeatures(id, userContext);
        await cancelAllProjectJobs({
          stateStore: this.stateStore,
          jobQueue: this.jobQueue,
          projectId: id,
          features,
          userContext,
        });
      } catch (e: any) {
        logger.warn(`[ProjectService] cancelAllProjectJobs failed for project ${id} (continuing)`, { component: 'ProjectService' }, e);
      }
    }

    // Step 2 — IDE pods/containers (waitForPodDeletion inside K8s stop).
    if (this.ideOrchestrator) {
      try {
        await this.ideOrchestrator.cleanupProject(userContext, id, { deleteHome: true });
      } catch (e: any) {
        logger.warn(`[ProjectService] IDE cleanup for project ${id} failed (continuing)`, { component: 'ProjectService' }, e);
      }
    }

    // Step 3 — preview cleanup via Redis pub/sub.
    if (this.stateStore) {
      try {
        await requestPreviewCleanup(this.stateStore, 'project', userContext, id);
      } catch (e: any) {
        logger.warn(`[ProjectService] Preview cleanup ack timed out (continuing)`, { component: 'ProjectService' }, { projectId: id, error: e?.message });
      }
    }

    // Step 4 — Redis project-scoped keys.
    if (this.stateStore) {
      try {
        await this.stateStore.cleanupProject(userContext.organizationId, userContext.userId, id);
      } catch (e: any) {
        logger.warn(`[ProjectService] Redis state cleanup failed (continuing)`, { component: 'ProjectService' }, { projectId: id, error: e?.message });
      }
    }

    // Step 5 — disk delete with verification (throws if it can't complete).
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
  
  /**
   * Delete a feature.
   *
   * Note: per-feature job cascade is handled in [features.routes.ts] DELETE
   * handler (it has access to JobCleanupManager + KanbanService via deps and
   * calls `finalizeTerminalJob` per job). This method is invoked AFTER that
   * cascade has sealed the jobs, so we focus on infra cleanup:
   *   1. IDE pod/container stop (waitForPodDeletion inside K8s stop)
   *   2. Preview cleanup via pub/sub (timeout-tolerant)
   *   3. Worktree + disk delete
   *
   * IDE stop errors are surfaced (no silent .catch swallow) so failures show
   * up to the caller — a successful delete must mean the IDE is actually gone.
   */
  async deleteFeature(projectId: string, featureName: string, userContext: UserContext): Promise<void> {
    if (this.ideOrchestrator) {
      const tenantId = `${userContext.organizationId}:${userContext.userId}`;
      const result = await this.ideOrchestrator.stop(tenantId, projectId, featureName);
      if (!result.success) {
        // Stop failure is a hard error — letting fs.rm proceed would leak the IDE.
        throw new Error(
          `Failed to stop IDE for feature '${featureName}' before deletion: ${result.message ?? '<no message>'}`,
        );
      }
    }

    if (this.stateStore) {
      try {
        await requestPreviewCleanup(this.stateStore, 'feature', userContext, projectId, featureName, 10_000);
      } catch (e: any) {
        logger.warn(`[ProjectService] Preview feature cleanup ack timed out (continuing)`, { component: 'ProjectService' }, {
          projectId,
          featureName,
          error: e?.message,
        });
      }
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
  
  // `resetJobState` was removed — session.state wipe without Redis/runs[]
  // coordination violated the SSOT invariant. Use `finalizeTerminalJob`
  // (per-job) or the Hard Reset pipeline (per-feature) instead.

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

