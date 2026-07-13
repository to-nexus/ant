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

// Duplicate-read tracking (history-derived; shared by compaction + tool node)
export {
  extractLatestReadContent,
  preservedReadKeyOf,
  readRangeOf,
  stringifyToolResultContent,
  buildDuplicateReadStub,
  isDuplicateReadStub,
  buildAlreadyReadManifest,
  DUPLICATE_READ_STUB_PREFIX,
} from './duplicateReads';
export type { PreservedRead } from './duplicateReads';

// Run orchestrator
export { compactRun } from './compactRun';

// Job compaction (LLM-based)
export { compactJob, applyCompactionToConversation } from './compactJob';
export type { CompactableEntry, ConversationCompaction } from './compactJob';

// Task retention
export { decideRetention, applyRetention } from './retentionPolicy';
export type { RetentionDecision, RetentionContext } from './retentionPolicy';
