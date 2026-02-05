/**
 * LLM Response Module
 * 
 * Direct Redis-based LLM response handling for job workers.
 * Replaces HTTP-based ChatAPIClient for improved performance.
 * 
 * Usage:
 * ```typescript
 * import { createLLMResponseService } from '../core/llm-response';
 * 
 * const service = createLLMResponseService(stateStore);
 * await service.startMessage();
 * await service.sendLLMEvent(event);
 * await service.finalizeMessage();
 * ```
 */

export { LLMResponseService } from './LLMResponseService';
export { SessionStore } from './SessionStore';
export { LLMEventHandler } from './LLMEventHandler';
export { FileOperationHandler } from './FileOperationHandler';
export { CommandExecutionHandler } from './CommandExecutionHandler';
export { ChatStatusHandler } from './ChatStatusHandler';

export type { 
  LLMResponseEnv, 
  SessionContext,
  FileOperationPhase,
  CommandExecutionPhase,
  ChatStatusType 
} from './types';

import type { StateStorePort } from '../ports/stateStore';
import type { LLMResponseEnv } from './types';
import { LLMResponseService } from './LLMResponseService';

/**
 * Create LLMResponseService from environment variables
 * 
 * Reads from:
 * - ANT_PROJECT_ID
 * - ANT_FEATURE_NAME
 * - ANT_JOB_ID
 * - ANT_USER_EMAIL (optional)
 * - ANT_USER_ID (optional)
 * - ANT_ORGANIZATION_ID (optional)
 * - ANT_WORKSPACE_PATH (optional)
 */
export function createLLMResponseService(stateStore: StateStorePort): LLMResponseService {
  const env: LLMResponseEnv = {
    projectId: process.env.ANT_PROJECT_ID || '',
    featureName: process.env.ANT_FEATURE_NAME || '',
    jobId: process.env.ANT_JOB_ID || '',
    userEmail: process.env.ANT_USER_EMAIL,
    userId: process.env.ANT_USER_ID,
    organizationId: process.env.ANT_ORGANIZATION_ID,
    workspacePath: process.env.ANT_WORKSPACE_PATH
  };
  
  return new LLMResponseService(stateStore, env);
}

/**
 * Create LLMResponseService with explicit environment
 */
export function createLLMResponseServiceWithEnv(
  stateStore: StateStorePort, 
  env: LLMResponseEnv
): LLMResponseService {
  return new LLMResponseService(stateStore, env);
}
