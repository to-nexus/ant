/**
 * Realtime Broadcasting Module
 * 
 * Direct Redis Pub/Sub implementations for Job Worker child processes.
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
 *   userContext: { userId, organizationId },
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
export { PreviewBroadcaster } from './PreviewBroadcaster';
export { GitStateBroadcaster } from './GitStateBroadcaster';

import { KanbanBroadcaster } from './KanbanBroadcaster';
import { WorkflowBroadcaster } from './WorkflowBroadcaster';
import { FileTreeBroadcaster } from './FileTreeBroadcaster';
import { PreviewBroadcaster } from './PreviewBroadcaster';
import { GitStateBroadcaster } from './GitStateBroadcaster';
import { BroadcasterOptions } from './types';
import { TaskQueueUpdatePort } from '../ports';
import { WorkflowStateUpdatePort } from '../ports/workflow';
import { FileTreeUpdatePort } from '../ports/fileTree';
import { PreviewUpdatePort } from '../ports/preview';
import { logger } from '../../utils/logger';

export interface RealtimeBroadcasters {
  kanban: TaskQueueUpdatePort;
  workflow: WorkflowStateUpdatePort;
  fileTree: FileTreeUpdatePort;
  preview: PreviewUpdatePort;
  gitChange: GitStateBroadcaster;
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
  // Build GitStateBroadcaster first so FileTreeBroadcaster can DI it for
  // automatic gitChange co-emit on every file tree update.
  const gitChange = new GitStateBroadcaster(options);
  const fileTree = new FileTreeBroadcaster(options, gitChange);
  const preview = new PreviewBroadcaster(options);

  return {
    kanban,
    workflow,
    fileTree,
    preview,
    gitChange,
    close: async () => {
      await Promise.all([
        kanban.close(),
        workflow.close(),
        fileTree.close(),
        preview.close(),
        gitChange.close(),
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
  // ✅ FileTreeBroadcaster reads file tree from this path.
  // Must use FEATURE_PATH (has plan/architecture/visual/assets/meta/sessions) not PROJECT_PATH (project root).
  const projectPath = process.env.ANT_FEATURE_PATH || process.env.ANT_PROJECT_PATH;
  const jobType = process.env.ANT_JOB_TYPE;
  const userId = process.env.ANT_USER_ID;
  const orgId = process.env.ANT_ORG_ID;
  // Check required environment variables (including userContext for user-scoped channels).
  // Missing env → real-time updates silently disappear (fileTree/kanban/gitChange),
  // which is the #1 cause of "UI frozen during job" reports. Surface as ERROR so
  // operators notice immediately instead of scrolling through info logs.
  if (!redisUrl || !jobId || !projectId || !featureName || !projectPath || !userId || !orgId) {
    const presence = {
      ANT_REDIS_URL: !!redisUrl,
      ANT_JOB_ID: !!jobId,
      ANT_PROJECT_ID: !!projectId,
      ANT_FEATURE_NAME: !!featureName,
      ANT_FEATURE_PATH_OR_PROJECT_PATH: !!projectPath,
      ANT_USER_ID: !!userId,
      ANT_ORG_ID: !!orgId,
    };
    const missing = Object.entries(presence)
      .filter(([, present]) => !present)
      .map(([k]) => k);
    // Diagnostic details go into the `meta` param (free-form), not LogContext
    // (which has a fixed shape: component/org/user/project/feature/job).
    logger.error(
      '[Realtime] Missing required env vars — real-time broadcasts disabled',
      { component: 'Realtime' },
      { missing, presence }
    );
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
    },
  };
}
