/**
 * Realtime Broadcasting Module
 * 
 * Direct Redis Pub/Sub implementations for Job Worker child processes.
 * Replaces HTTP-based clients (KanbanHttpClient, WorkflowHttpClient, FileTreeHttpClient).
 * 
 * Usage in orchestrator.ts:
 * ```
 * import { createRealtimeBroadcasters } from '../core/realtime';
 * 
 * const { kanban, workflow, fileTree } = await createRealtimeBroadcasters({
 *   redisUrl: process.env.ANT_REDIS_URL!,
 *   jobId: process.env.ANT_JOB_ID!,
 *   projectId: process.env.ANT_PROJECT_ID!,
 *   featureName: process.env.ANT_FEATURE_NAME!,
 *   jobType: process.env.ANT_JOB_TYPE as 'design' | 'code' | 'learn',
 *   projectPath: process.env.ANT_PROJECT_PATH!,
 *   userContext: { userId, organizationId, workspacePath },
 * });
 * ```
 * 
 * Architecture Flow:
 *   Job Worker Child → Broadcaster → Redis Pub/Sub → Realtime Server → SSE
 * 
 * Benefits over HTTP approach:
 * - No HTTP network hop (lower latency)
 * - No API Server intermediary (simpler architecture)
 * - Direct state storage in Redis
 * - Same Pub/Sub mechanism as Chat API refactoring
 */

// Type exports
export * from './types';

// Class exports
export { KanbanBroadcaster } from './KanbanBroadcaster';
export { WorkflowBroadcaster } from './WorkflowBroadcaster';
export { FileTreeBroadcaster } from './FileTreeBroadcaster';

import { KanbanBroadcaster } from './KanbanBroadcaster';
import { WorkflowBroadcaster } from './WorkflowBroadcaster';
import { FileTreeBroadcaster } from './FileTreeBroadcaster';
import { BroadcasterOptions } from './types';
import { TaskQueueUpdatePort } from '../ports';
import { WorkflowStateUpdatePort } from '../ports/workflow';
import { FileTreeUpdatePort } from '../ports/fileTree';

export interface RealtimeBroadcasters {
  kanban: TaskQueueUpdatePort;
  workflow: WorkflowStateUpdatePort;
  fileTree: FileTreeUpdatePort;
  close: () => Promise<void>;
}

export interface CreateBroadcastersOptions extends BroadcasterOptions {
  projectPath: string;
}

/**
 * Create all realtime broadcasters for a job
 * 
 * This is the main factory function for Job Worker child processes.
 * Creates Redis-based broadcasters that implement the same port interfaces
 * as the HTTP clients they replace.
 */
export function createRealtimeBroadcasters(
  options: CreateBroadcastersOptions
): RealtimeBroadcasters {
  const kanban = new KanbanBroadcaster(options);
  const workflow = new WorkflowBroadcaster(options);
  const fileTree = new FileTreeBroadcaster(options);

  return {
    kanban,
    workflow,
    fileTree,
    close: async () => {
      await Promise.all([
        kanban.close(),
        workflow.close(),
        fileTree.close(),
      ]);
    },
  };
}

/**
 * Check if Redis-based broadcasting is available
 * 
 * Returns true if ANT_REDIS_URL is set (Cloud mode / Job Worker child process)
 */
export function isRealtimeBroadcastingAvailable(): boolean {
  return !!process.env.ANT_REDIS_URL;
}

/**
 * Get broadcaster options from environment variables
 * 
 * Convenience function for Job Worker child processes.
 * All required environment variables are set by JobWorker.spawnJobProcess().
 */
export function getBroadcasterOptionsFromEnv(): CreateBroadcastersOptions | null {
  const redisUrl = process.env.ANT_REDIS_URL;
  const jobId = process.env.ANT_JOB_ID;
  const projectId = process.env.ANT_PROJECT_ID;
  const featureName = process.env.ANT_FEATURE_NAME || process.env.ANT_FEATURE;
  const projectPath = process.env.ANT_PROJECT_PATH || process.env.ANT_FEATURE_PATH;
  const jobType = process.env.ANT_JOB_TYPE as import('../types/task').DecomposableJobType | undefined;
  const userId = process.env.ANT_USER_ID;
  const orgId = process.env.ANT_ORG_ID;
  const workspacePath = process.env.ANT_WORKSPACE_PATH;

  // Check required environment variables (including userContext for user-scoped channels)
  if (!redisUrl || !jobId || !projectId || !featureName || !projectPath || !userId || !orgId) {
    console.log(`[Realtime] Missing required env vars for broadcasting:`, {
      redisUrl: !!redisUrl,
      jobId: !!jobId,
      projectId: !!projectId,
      featureName: !!featureName,
      projectPath: !!projectPath,
      userId: !!userId,
      orgId: !!orgId,
    });
    return null;
  }

  return {
    redisUrl,
    jobId,
    projectId,
    featureName,
    projectPath,
    jobType,
    userContext: {
      userId,
      organizationId: orgId,
      workspacePath: workspacePath || '',
    },
  };
}
