/**
 * core/context — barrel export.
 */

// Types + helpers
export type { ConversationMessage, CompactionResult, CompactionConfig } from './types';
export { groupMessagesIntoTurns, isErrorContent } from './types';

// Constants
export * from './constants';

// Turn
export { compactTurns } from './compactTurns';
export { TurnPruner } from './pruneTurns';
export type { TurnPruneConfig } from './pruneTurns';

// Run orchestrator
export { compactRun } from './compactRun';

// Job compaction (LLM-based)
export { compactJob, applyCompactionToConversation } from './compactJob';
export type { CompactableEntry, ConversationCompaction } from './compactJob';

// Task retention
export { decideRetention, applyRetention } from './retentionPolicy';
export type { RetentionDecision, RetentionContext } from './retentionPolicy';
