import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { getSSEBroadcastChannel } from '../../../../../infrastructure/state';

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
    // ✅ Cloud-safe: Get job mapping from Redis (single source of truth)
    const stateStore = getInfrastructureFactory().getStateStore();
    
    logger.debug(`[Kanban Broadcast] Looking up job mapping for ${jobId}`, { 
      component: 'WorkflowBridge', 
      jobId 
    });
    
    const mapping = await stateStore.getJobMapping(jobId);
    
    logger.debug(`[Kanban Broadcast] Mapping lookup result: ${mapping ? `found (${mapping.projectId}/${mapping.featureName})` : 'NOT FOUND'}`, { 
      component: 'WorkflowBridge', 
      jobId
    });
    
    if (mapping) {
      // Get job status from Redis for accurate job type
      const jobStatus = await stateStore.getJobStatus(jobId);
      const task = jobStatus?.type;
      const jobType: 'design' | 'code' | 'learn' = 
        (task === 'design' || task === 'code' || task === 'learn') ? task : (mapping.jobType || 'code');
      
      try {
        const kanbanData = await this.deps.kanbanService.getKanbanData(
          mapping.projectId, 
          mapping.featureName,
          jobType,
          undefined,  // jobToProject - not used, KanbanService uses Redis
          undefined,  // jobs - not used, KanbanService uses Redis
          undefined,  // taskQueueSnapshots - not used
          mapping.userContext
        );
        
        // Broadcast via user-scoped Redis Pub/Sub → Realtime Server → SSE
        if (!mapping.userContext?.organizationId || !mapping.userContext?.userId) {
          logger.warn(`[Kanban Broadcast] Cannot broadcast without userContext`, {
            component: 'WorkflowBridge',
            projectId: mapping.projectId,
            featureName: mapping.featureName
          });
          return;
        }
        
        const channel = getSSEBroadcastChannel(mapping.userContext.organizationId, mapping.userContext.userId);
        logger.debug(`[Kanban Broadcast] Publishing to ${channel}: ${mapping.projectId}/${mapping.featureName}`, {
          component: 'WorkflowBridge',
          projectId: mapping.projectId,
          featureName: mapping.featureName
        });
        
        await stateStore.publish(channel, {
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
    } else {
      logger.warn(`No job mapping found for kanban broadcast`, { 
        component: 'WorkflowBridge', 
        jobId 
      });
    }
  }

  /**
   * Notify file tree update
   */
  async notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: UserContext): Promise<void> {
    // Require userContext for user-scoped channel
    if (!userContext?.organizationId || !userContext?.userId) {
      logger.warn(`[FileTreeUpdate] Cannot update without userContext`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName 
      });
      return;
    }
    
    try {
      logger.debug(`[FileTreeUpdate] Updating`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName 
      });
      
      const stateStore = getInfrastructureFactory().getStateStore();
      
      const fileTree = await this.deps.projectService.getFileTree(
        projectId, 
        featureName, 
        userContext
      );
      
      // Validate userContext for user-scoped channel
      if (!userContext?.organizationId || !userContext?.userId) {
        logger.warn(`[FileTreeUpdate] Cannot broadcast without userContext`, { 
          component: 'WorkflowBridge', 
          projectId, 
          featureName 
        });
        return;
      }
      
      const channel = getSSEBroadcastChannel(userContext.organizationId, userContext.userId);
      logger.debug(`[FileTreeUpdate] Broadcasting via ${channel}`, { 
        component: 'WorkflowBridge', 
        projectId, 
        featureName, 
        organizationId: userContext.organizationId, 
        userId: userContext.userId 
      });
      
      // Broadcast via user-scoped Redis Pub/Sub → Realtime Server → SSE
      await stateStore.publish(channel, {
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
