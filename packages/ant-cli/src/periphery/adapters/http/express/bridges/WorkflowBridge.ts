import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';

/**
 * WorkflowBridge
 * 
 * Bridges API server routes with Kanban and FileTree broadcasting.
 * Handles task queue updates and file tree change notifications via Redis Pub/Sub.
 * 
 * Note: Workflow state tracking (enterNode/exitNode/endJob) is handled exclusively
 * by WorkflowBroadcaster in the Job Worker child process. This bridge only handles
 * Kanban and FileTree updates triggered by API server routes.
 */
export class WorkflowBridge {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies
  ) {}

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
        
        const channel = getRealtimeBroadcastChannel(mapping.userContext.organizationId, mapping.userContext.userId);
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
      
      const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
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
