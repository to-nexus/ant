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
import { DeletionVerificationError, ProjectDeletionError } from './errors';
import {
  createProjectDeletionPhaseEmitter,
  type ProjectDeletionPhaseEmitter,
} from './projectDeletionPhaseEmitter';
import type { ProjectDeletionPhase } from '@ant/shared';

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
    this.git = new GitService(workspaceResolver, githubAuthService, chatService, stateStore);
    
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
        await this.deleteProject(id, userContext, { force: true });
      } catch (e: any) {
        if (e?.message !== 'Project not found') throw e;
      }
    }
    return this.projectCrud.createProject(id, userContext);
  }

  /**
   * Rename a project — full cascade: stop runtime → fs.rename + verify → lazy restart.
   *
   * Pod / preview / Redis-state cleanup mirrors `deleteProject` because the
   * old `subPath` mounts and old projectId-keyed state are stale after the
   * directory rename. New IDE / preview start lazily when the user re-enters
   * with the new id.
   */
  async renameProject(oldId: string, newId: string, userContext: UserContext): Promise<void> {
    // rename: tolerate every step failure (force=true) — the rename itself
    // is the user's recovery action; surfacing mid-cascade errors as 500s
    // would block legitimate renames just because IDE/preview cleanup blipped.
    await this.stopProjectRuntime(oldId, userContext, { force: true });
    return this.projectCrud.renameProject(oldId, newId, userContext);
  }

  /**
   * Delete a project end-to-end. Step 1-4 share `stopProjectRuntime`
   * with `renameProject`; only the final disk action differs (rm vs rename).
   *
   * Each step closes a "Project already exists" failure mode:
   *   1. cancelAllProjectJobs — Redis seal + child exit wait so EFS open
   *      file handles are released before fs.rm runs.
   *   2. ideOrchestrator.cleanupProject — stop pods/containers + delete IDE
   *      home dir. waitForPodDeletion happens inside KubernetesIDEOrchestrator.stop.
   *   3. requestPreviewCleanup — Redis pub/sub to ant-preview process.
   *      ack timeout is logged + tolerated (preview may not be running in dev).
   *   4. stateStore.cleanupProject — DEL all project-scoped Redis keys.
   *   5. projectCrud.deleteProject — fs.rm with verification loop.
   *
   * Progress is published as `projectDeletionPhase` SSE events so the FE
   * renders a per-step rail. Failures wrap into `ProjectDeletionError` so
   * the route returns a structured body (stage / hint / leftovers /
   * canForceCleanup) instead of a generic 500.
   *
   * Force mode (`opts.force === true`): steps 1-4 swallow failures with
   * warn logs (matching the old best-effort behavior). Step 5 still throws
   * on verify timeout — leaving the directory partially deleted would
   * surface as a confusing 409 on the next createProject.
   */
  async deleteProject(id: string, userContext: UserContext, opts: { force?: boolean } = {}): Promise<void> {
    const startedAt = Date.now();
    const emitter = this.stateStore
      ? createProjectDeletionPhaseEmitter(this.stateStore, userContext, id, startedAt)
      : null;

    await this.stopProjectRuntime(id, userContext, { force: opts.force ?? false }, emitter);

    await emitter?.emit('fsVerify', 'active');
    try {
      await this.projectCrud.deleteProject(id, userContext, { force: opts.force });
      await emitter?.emit('fsVerify', 'complete');
    } catch (err: any) {
      if (err?.message === 'Project not found') {
        // Pre-cascade existence check — surface as-is (route maps to 404).
        throw err;
      }
      if (err instanceof DeletionVerificationError) {
        await emitter?.emit('fsVerify', 'failed', `${err.leftovers.length} leftover entries`);
        throw new ProjectDeletionError('fsVerify', err, {
          canForceCleanup: !opts.force,
          hint: opts.force
            ? 'Force-delete still left files on disk — likely an active IDE pod or preview process holding open handles. Retry after waiting briefly.'
            : 'Filesystem still holds open file handles. Try Force Delete to extend the wait window.',
          leftovers: err.leftovers,
        });
      }
      // Unknown disk error — also surface as fsVerify failure so the FE
      // can still render the step rail. Force-retry is offered because the
      // most common cause (transient EBUSY/ENOTEMPTY) responds to it.
      await emitter?.emit('fsVerify', 'failed', err?.message ?? String(err));
      throw new ProjectDeletionError('fsVerify', err instanceof Error ? err : new Error(String(err)), {
        canForceCleanup: !opts.force,
        hint: 'Disk-level delete failed. Try Force Delete.',
      });
    }
  }

  /**
   * SSOT cascade: cancel jobs → stop IDE → preview cleanup → Redis cleanup.
   *
   * Shared by `deleteProject` and `renameProject` so the four lifecycle
   * steps cannot drift.
   *
   * Step behavior:
   * - `force = false`: a step failure throws `ProjectDeletionError` immediately
   *   with `canForceCleanup: true` — the FE can retry with `?force=true` to
   *   opt out of the strict gate.
   * - `force = true`: failures are warn-logged and the cascade continues
   *   (matches the legacy best-effort behavior — fs.rm verification is the
   *   final gate). Also used by `renameProject` so a rename never fails on
   *   transient infra blips.
   *
   * `emitter` may be undefined (rename path doesn't broadcast deletion-phase
   * events). When present, each step emits active → complete | failed.
   */
  private async stopProjectRuntime(
    projectId: string,
    userContext: UserContext,
    opts: { force: boolean },
    emitter?: ProjectDeletionPhaseEmitter | null,
  ): Promise<void> {
    const runStep = async (
      phase: ProjectDeletionPhase,
      run: (() => Promise<void>) | null,
      hint: string,
    ): Promise<void> => {
      if (!run) return; // dep unavailable — silently skip (e.g. no stateStore)
      await emitter?.emit(phase, 'active');
      try {
        await run();
        await emitter?.emit(phase, 'complete');
      } catch (e: any) {
        await emitter?.emit(phase, 'failed', e?.message ?? String(e));
        if (!opts.force) {
          throw new ProjectDeletionError(phase, e instanceof Error ? e : new Error(String(e)), {
            canForceCleanup: true,
            hint,
          });
        }
        logger.warn(
          `[ProjectService] ${phase} failed (force=true — continuing)`,
          { component: 'ProjectService' },
          { projectId, error: e?.message },
        );
      }
    };

    await runStep(
      'cancelJobs',
      this.stateStore && this.jobQueue
        ? async () => {
            const features = await this.featureCrud.listFeatures(projectId, userContext);
            await cancelAllProjectJobs({
              stateStore: this.stateStore!,
              jobQueue: this.jobQueue!,
              projectId,
              features,
              userContext,
            });
          }
        : null,
      'Some jobs failed to cancel cleanly. Try Force Delete to skip the strict wait.',
    );

    await runStep(
      'ideCleanup',
      this.ideOrchestrator
        ? async () => {
            await this.ideOrchestrator!.cleanupProject(userContext, projectId, { deleteHome: true });
          }
        : null,
      'IDE pod did not shut down in time. Try Force Delete (the pod will be deleted with grace=0).',
    );

    await runStep(
      'previewCleanup',
      this.stateStore
        ? async () => {
            await requestPreviewCleanup(this.stateStore!, 'project', userContext, projectId);
          }
        : null,
      'Preview server did not acknowledge cleanup. Try Force Delete (cleanup will be skipped).',
    );

    await runStep(
      'redisCleanup',
      this.stateStore
        ? async () => {
            await this.stateStore!.cleanupProject(
              userContext.organizationId,
              userContext.userId,
              projectId,
            );
          }
        : null,
      'Redis state cleanup failed. Try Force Delete to skip the strict gate.',
    );
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

