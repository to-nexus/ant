/**
 * Domain Models - Barrel Export
 * 
 * Central import point for all frontend domain types.
 * Shared types come from @ant/shared via sub-modules.
 * 
 * Type Modules:
 *   - @ant/shared   : BaseTask, KanbanData, TaskType, JobType, etc. (canonical)
 *   - session.ts    : Session, SessionState, Task (FE view models)
 *   - task.ts       : UnifiedTask, normalizeTask (FE normalization)
 *   - chat.ts       : FileStats (Phase 11 chat-SSOT — see chat.ts header)
 *   - detection.ts  : Mode, IntentGroup, DesignDomain + FE helpers
 *   - workflow.ts   : WorkflowRealtimeState + FE graph types
 */

// Shared types (re-exported through sub-modules from @ant/shared)
export * from './types';
export * from './session';
export * from './task';
export * from './chat';
export * from './detection';
export * from './workflow';
