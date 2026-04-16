/**
 * LLMResponseService Types
 * 
 * Types specific to the LLM response handling in job workers
 */

import type { UserContext } from '../types/user';

/**
 * Environment variables for LLMResponseService
 */
export interface LLMResponseEnv {
  projectId: string;
  featureName: string;
  jobId: string;
  userEmail?: string;
  userId?: string;
  organizationId?: string;
  featurePath?: string;
}

/**
 * Session context for Redis operations
 */
export interface SessionContext {
  projectId: string;
  featureName: string;
  jobId: string;
  userContext?: UserContext;
  sessionKey: string;  // Redis key
}

/**
 * File operation phases for streaming
 */
export type FileOperationPhase = 
  | 'creating' 
  | 'writing' 
  | 'editing' 
  | 'updating' 
  | 'deleting' 
  | 'complete' 
  | 'failed';

/**
 * Command execution phases for streaming
 */
export type CommandExecutionPhase = 
  | 'running' 
  | 'streaming' 
  | 'complete';

/**
 * Chat status types for showChatStatus
 */
export type ChatStatusType = 
  | 'placeholder' 
  | 'exploring' | 'explored' 
  | 'retrieving' | 'retrieved' 
  | 'grepping' | 'grepped' 
  | 'listing_files' | 'listed_files'
  | 'searching_code' | 'searched_code'
  | 'reading' | 'read'
  | 'reading_source' | 'read_source' 
  | 'thinking' 
  | 'indexing' | 'indexed' 
  | 'analyzing' | 'analyzed'
  | 'loading' | 'loaded' 
  | 'storing' | 'stored' 
  | 'searching_reference' | 'searched_reference' 
  | 'tool_action' 
  | 'learning' | 'learned' 
  | 'context_loaded'  // ✅ Context loaded notification (eval report, PRD, design docs, etc.)
  | 'triage_choice'  // ✅ Triage redirect/blocked choice
  | 'choice_card'    // ✅ Generic choice card (eval_save, etc.)
  | 'file_create_failed' | 'file_edit_failed' | 'file_delete_failed'
  | 'file_conflict' | 'file_conflict_retry'
  | 'processing' | 'processed'
  | 'downloading' | 'downloaded'
  | 'figma_calling' | 'figma_called'
  | 'plan_generating' | 'plan'
  | 'task_response';
