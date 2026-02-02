import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';

// Redis Pub/Sub channel for SSE broadcast (received by Realtime Server)
const SSE_BROADCAST_CHANNEL = 'sse:broadcast';

/**
 * WorkflowBridge
 * 
 * Implements WorkflowStateUpdatePort to bridge job execution with workflow visualization.
 * Tracks workflow state and broadcasts updates via Redis Pub/Sub → Realtime Server → SSE.
 * 
 * Cloud-safe: All methods are async and delegate to WorkflowStateService (Redis-backed).
 */
export class WorkflowBridge {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Start workflow tracking for a job
   */
  async startJob(jobId: string, llmInfo?: any): Promise<void> {
    logger.debug(`startJob`, { component: 'WorkflowBridge', jobId }, llmInfo);
    await this.deps.workflowStateService.startJob(jobId, llmInfo);
  }

  /**
   * Track node entry
   */
  async enterNode(
    jobId: string, 
    nodeId: string, 
    taskInfo?: any, 
    llmInfo?: any, 
    recursionCount?: number, 
    recursionLimit?: number
  ): Promise<void> {
    logger.debug(`enterNode: ${nodeId}`, { 
      component: 'WorkflowBridge', 
      jobId 
    }, { 
      task: taskInfo?.name, 
      llm: llmInfo 
    });
    
    await this.deps.workflowStateService.enterNode(
      jobId, 
      nodeId, 
      taskInfo, 
      llmInfo, 
      recursionCount, 
      recursionLimit
    );
  }

  /**
   * Track node exit
   */
  async exitNode(jobId: string, nodeId: string): Promise<void> {
    await this.deps.workflowStateService.exitNode(jobId, nodeId);
  }

  /**
   * Track actor interaction start
   */
  async startActorInteraction(jobId: string, actorId: string): Promise<void> {
    await this.deps.workflowStateService.startActorInteraction(jobId, actorId);
  }

  /**
   * Track actor interaction end
   */
  async endActorInteraction(jobId: string, actorId: string): Promise<void> {
    await this.deps.workflowStateService.endActorInteraction(jobId, actorId);
  }

  /**
   * End workflow tracking for a job
   */
  async endJob(jobId: string): Promise<void> {
    await this.deps.workflowStateService.endJob(jobId);
  }

  /**
   * Update task queue and broadcast to Kanban clients
   */
  async updateTaskQueue(
    jobId: string, 
    currentTask: any, 
    queue: any[], 
    completedTasks?: any[],
    recursionCount?: number,
    recursionLimit?: number,
    tokenUsage?: { 
      inputTokens: number; 
      outputTokens: number; 
      totalTokens: number; 
      cacheReadTokens?: number; 
      cacheCreationTokens?: number;
    }
  ): Promise<void> {
    // Update task queue in Redis via KanbanService
    await this.deps.kanbanService.updateTaskQueue(
      jobId, 
      currentTask, 
      queue, 
      completedTasks || [], 
      recursionCount, 
      recursionLimit
    );
    
    // Update local snapshot for backwards compatibility
    this.stateTracker.updateTaskQueue(
      jobId, 
      currentTask, 
      queue, 
      completedTasks, 
      recursionCount, 
      recursionLimit
    );
    
    // Broadcast to Kanban clients via SSE
    const mapping = this.stateTracker.getJobMapping(jobId);
    if (mapping) {
      const jobStatus = this.stateTracker.getJobStatus(jobId);
      const task = jobStatus?.task;
      const jobType: 'design' | 'code' | 'learn' = 
        (task === 'design' || task === 'code' || task === 'learn') ? task : 'code';
      
      try {
        const kanbanData = await this.deps.kanbanService.getKanbanData(
          mapping.projectId, 
          mapping.featureName,
          jobType,
          this.stateTracker.getState().jobToProject,
          this.stateTracker.getState().jobs,
          this.stateTracker.getState().taskQueueSnapshots,
          mapping.userContext
        );
        
        // Broadcast via Redis Pub/Sub → Realtime Server → SSE
        const stateStore = getInfrastructureFactory().getStateStore();
        await stateStore.publish(SSE_BROADCAST_CHANNEL, {
          projectId: mapping.projectId,
          featureName: mapping.featureName,
          type: 'kanban',
          data: kanbanData,
          userContext: mapping.userContext
        });
      } catch (error) {
        logger.warn(`Failed to broadcast Kanban update`, { 
          component: 'WorkflowBridge', 
          jobId 
        }, error);
      }
    }
  }

  /**
   * Notify file tree update
   */
  async notifyFileTreeUpdate(projectId: string, featureName: string): Promise<void> {
    try {
      logger.debug(`[FileTreeUpdate] Updating`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName 
      });
      
      // Find userContext from job mappings
      let userContext: UserContext | undefined;
      const state = this.stateTracker.getState();
      for (const [jobId, mapping] of state.jobToProject.entries()) {
        if (mapping.projectId === projectId && mapping.featureName === featureName) {
          userContext = mapping.userContext;
          break;
        }
      }
      
      // Fallback for Local mode
      if (!userContext) {
        userContext = {
          userId: 'local',
          organizationId: 'local',
          workspacePath: ''
        };
      }
      
      const fileTree = await this.deps.projectService.getFileTree(
        projectId, 
        featureName, 
        userContext
      );
      
      logger.debug(`[FileTreeUpdate] Broadcasting via Redis Pub/Sub`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName, 
        organizationId: userContext.organizationId, 
        userId: userContext.userId 
      });
      
      // Broadcast via Redis Pub/Sub → Realtime Server → SSE
      const stateStore = getInfrastructureFactory().getStateStore();
      await stateStore.publish(SSE_BROADCAST_CHANNEL, {
        projectId,
        featureName,
        type: 'fileTree',
        data: { type: 'update', tree: fileTree },
        userContext
      });
    } catch (error) {
      logger.warn(`[FileTreeUpdate] Error`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName 
      }, error);
    }
  }
}
