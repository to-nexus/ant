import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { InterruptionDetails } from '../../../../../core/types';
import { UserContext } from '../../../../../core/types/user';
import { logger } from '../../../../../utils/logger';
import { JobStateTracker } from '../managers/JobStateTracker';
import { ServerDependencies } from '../types';
import { getInfrastructureFactory } from '../../../../../infrastructure/adapters/InfrastructureFactory';
import { getRealtimeBroadcastChannel } from '../../../../../infrastructure/state';

/**
 * JobCleanupManager
 * 
 * Handles job state cleanup when jobs are stopped or completed.
 * Manages session file updates and final Kanban broadcasts.
 */
export class JobCleanupManager {
  constructor(
    private readonly stateTracker: JobStateTracker,
    private readonly deps: ServerDependencies
  ) {}

  /**
   * Clean up job state when stopped or completed
   */
  async cleanupJobState(
    jobId: string, 
    projectId?: string, 
    featureName?: string,
    interruptionReason?: InterruptionDetails,
    explicitJobType?: 'design' | 'code' | 'learn',
    userContext?: UserContext
  ): Promise<void> {
    logger.info(`cleanupJobState`, { 
      component: 'JobCleanupManager', 
      jobId 
    }, {
      projectId,
      featureName,
      interruptionReason: interruptionReason?.reason,
      explicitJobType
    });
    
    // ✅ Cloud-safe: Get mapping from Redis (single source of truth)
    const stateStore = getInfrastructureFactory().getStateStore();
    let mapping = await stateStore.getJobMapping(jobId);
    
    // If mapping not found in Redis, use provided parameters
    if (!mapping && projectId && featureName) {
      mapping = { 
        projectId, 
        featureName, 
        jobType: explicitJobType || 'code',
        userContext
      };
      logger.debug(`Using provided mapping`, { 
        component: 'JobCleanupManager', 
        jobId 
      }, mapping);
    }
    
    // Get current snapshot
    const snapshot = this.stateTracker.getTaskQueueSnapshot(jobId);
    
    // Determine job type
    const jobStatus = this.stateTracker.getJobStatus(jobId);
    const jobType = mapping?.jobType || explicitJobType || (jobStatus?.task as 'design' | 'code' | 'learn') || 'code';
    
    // End workflow tracking
    await this.deps.workflowStateService.endJob(jobId);
    
    // Finalize any active chat message
    // ✅ CRITICAL: Must await to ensure message is finalized before session file is written
    if (mapping && this.deps.chatService) {
      await this.deps.chatService.finalizeCurrentMessage(
        mapping.projectId, 
        mapping.featureName || 'skeleton', 
        true  // cancelled: true
      );
    }
    
    // Move in-progress task back to queue in session file
    if (mapping) {
      try {
        const effectiveUserContext = userContext || mapping.userContext || {
          userId: 'local',
          organizationId: 'local',
          workspacePath: ''
        };
        
        const featurePath = this.deps.workspaceResolver.getFeaturePath(
          effectiveUserContext,
          mapping.projectId,
          mapping.featureName || 'skeleton'
        );
        const sessionPath = path.join(featurePath, 'sessions', `${jobType}.json`);
        
        const sessionData = await this.deps.sessionService.readSessionData(
          mapping.projectId, 
          mapping.featureName || 'skeleton',
          jobType,
          effectiveUserContext
        );
        
        let shouldBroadcast = true;
        
        if (sessionData?.state) {
          // Check if there's a currentTask to move back
          const taskToReturn = snapshot?.currentTask || sessionData.state.currentTask;
          
          if (taskToReturn) {
            // Mark task as interrupted
            const interruptedTask = {
              ...taskToReturn,
              interrupted: true
            };
            
            // Put currentTask back at the front of the queue
            const existingQueue = sessionData.state.taskQueue || [];
            const filteredQueue = existingQueue.filter((task: any) => task.id !== taskToReturn.id);
            const updatedQueue = [interruptedTask, ...filteredQueue];
            
            sessionData.state = {
              ...sessionData.state,
              taskQueue: updatedQueue,
              currentTask: undefined
            };
          } else {
            sessionData.state = {
              ...sessionData.state
            };
          }
          
          // Update jobTiming with pausedAt
          if (sessionData.state.jobTiming) {
            sessionData.state.jobTiming = {
              ...sessionData.state.jobTiming,
              pausedAt: new Date().toISOString()
            };
          }
          
          // Save interruption details if provided
          if (interruptionReason) {
            sessionData.state.interruption = interruptionReason;
            logger.debug(`Saved interruption reason: ${interruptionReason.reason}`, { 
              component: 'JobCleanupManager', 
              jobId 
            });
          } else if (sessionData.state.interruption) {
            // ✅ Fallback: Session already has interruption (saved by saveCheckpoint in runner.ts)
            // Use it as the effective interruption for downstream processing (chat message, etc.)
            interruptionReason = sessionData.state.interruption;
            logger.info(`Using existing session interruption: ${interruptionReason?.reason}`, { 
              component: 'JobCleanupManager', 
              jobId 
            });
          }
          
          // Write updated session
          await fs.promises.writeFile(sessionPath, JSON.stringify(sessionData, null, 2), 'utf-8');
        } else if (interruptionReason) {
          // No session file yet - create minimal session with interruption
          const minimalSession = {
            sessionId: crypto.randomUUID(),
            projectId: mapping.projectId,
            featureName: mapping.featureName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            turns: [],
            state: {
              taskQueue: [],
              completedTasks: [],
              completedTasksDetails: [],
              interruption: interruptionReason
            }
          };
          
          await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
          await fs.promises.writeFile(sessionPath, JSON.stringify(minimalSession, null, 2), 'utf-8');
        }
        
        // Broadcast final update
        if (shouldBroadcast) {
          await this.broadcastFinalUpdate(mapping, jobType, effectiveUserContext, jobId);
        } else {
          this.stateTracker.cleanup(jobId);
        }
        
        // Add cancelled message to chat if interruption occurred
        // ✅ CRITICAL: Use async version to ensure existing messages are loaded first
        if (interruptionReason && mapping.projectId && mapping.featureName) {
          await this.deps.chatService.addCancelledMessageAsync(
            mapping.projectId,
            mapping.featureName,
            jobId,
            interruptionReason.reason,
            interruptionReason.message,
            effectiveUserContext
          );
        }
      } catch (error) {
        logger.error(`Error in cleanupJobState`, { 
          component: 'JobCleanupManager', 
          jobId 
        }, error);
      }
    } else {
      logger.warn(`No mapping found, cannot broadcast Kanban update`, { 
        component: 'JobCleanupManager', 
        jobId 
      });
    }
    
    logger.debug(`cleanupJobState completed`, { 
      component: 'JobCleanupManager', 
      jobId 
    });
  }

  /**
   * Broadcast final Kanban update and cleanup state
   */
  private async broadcastFinalUpdate(
    mapping: { projectId: string; featureName: string; jobType: 'design' | 'code' | 'learn'; userContext?: UserContext },
    jobType: 'design' | 'code' | 'learn',
    userContext: UserContext,
    jobId: string
  ): Promise<void> {
    try {
      const state = this.stateTracker.getState();
      const kanbanData = await this.deps.kanbanService.getKanbanData(
        mapping.projectId, 
        mapping.featureName,
        jobType,
        state.jobToProject,
        state.jobs,
        state.taskQueueSnapshots,
        userContext
      );
      
      // Broadcast via user-scoped Redis Pub/Sub → Realtime Server → SSE
      if (!userContext?.organizationId || !userContext?.userId) {
        logger.warn(`Cannot broadcast final update without userContext`, { 
          component: 'JobCleanupManager', 
          jobId 
        });
        return;
      }
      
      const stateStore = getInfrastructureFactory().getStateStore();
      const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
      await stateStore.publish(channel, {
        projectId: mapping.projectId,
        featureName: mapping.featureName,
        type: 'kanban',
        data: kanbanData,
        userContext
      });
      
      // Clear live data AFTER broadcast
      this.stateTracker.cleanup(jobId);
    } catch (err) {
      logger.warn(`Failed to broadcast Kanban update`, { 
        component: 'JobCleanupManager', 
        jobId 
      }, err);
      
      // Clean up even if broadcast fails
      this.stateTracker.cleanup(jobId);
    }
  }
}
