/**
 * LLM Response Module
 *
 * Direct Redis-based LLM response handling for job workers. Replaces the
 * pre-§5 ChatMessage scratchpad (`SessionStore` + `ContentMerger` +
 * 4 handler classes) with a single `LLMResponseService` facade that
 * emits chat events via `chat.jsonl` (durable SSOT) + Redis TURN_BUFFER
 * (in-flight) + `MessageBroadcaster` (SSE pub/sub).
 *
 * Usage:
 * ```typescript
 * import { createLLMResponseService } from '../core/llm-response';
 *
 * const service = createLLMResponseService(stateStore);
 * service.setTurnId(turnId);
 * await service.streamTextChunk('hello');
 * await service.appendAssistantMessage('hello');
 * ```
 */

export { LLMResponseService } from './LLMResponseService';
export { TurnContext } from './TurnContext';
export { ChatLogAppender } from './ChatLogAppender';
export type { ChatLogAppenderConfig } from './ChatLogAppender';

export type {
  LLMResponseEnv,
  SessionContext,
  FileOperationPhase,
  CommandExecutionPhase,
  ChatStatusType,
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
 * - ANT_ORG_ID (optional)
 * - ANT_FEATURE_PATH (optional)
 */
export function createLLMResponseService(stateStore: StateStorePort): LLMResponseService {
  const env: LLMResponseEnv = {
    projectId: process.env.ANT_PROJECT_ID || '',
    featureName: process.env.ANT_FEATURE_NAME || '',
    jobId: process.env.ANT_JOB_ID || '',
    jobType: process.env.ANT_JOB_TYPE as import('@ant/shared').LogJobType | undefined,
    agent: process.env.ANT_AGENT || undefined,
    userEmail: process.env.ANT_USER_EMAIL,
    userId: process.env.ANT_USER_ID,
    organizationId: process.env.ANT_ORG_ID,
    featurePath: process.env.ANT_FEATURE_PATH,
  };

  return new LLMResponseService(stateStore, env);
}

/**
 * Create LLMResponseService with explicit environment
 */
export function createLLMResponseServiceWithEnv(
  stateStore: StateStorePort,
  env: LLMResponseEnv,
): LLMResponseService {
  return new LLMResponseService(stateStore, env);
}
