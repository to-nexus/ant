/**
 * Common Graph Utilities
 * 
 * Shared utilities for all agent graphs (architect, planner, etc.)
 * - LLM configuration constants
 * - Token tracking middleware
 * - Job timing management
 * - UI label helpers
 */

// LLM Configuration
export { LLM_TEMPERATURE, LLM_MAX_TOKENS } from './llmConfig.js';

// Token Tracking
export type { TokenUsage, TokenTrackingState, EstimatingNodeId, EstimatingOpts, EstimatingState } from './llmHelpers.js';
export {
  accumulateTokenUsage,
  invokeWithTracking,
  resetTaskTokenUsage,
  getTaskTokenUsage,
  getJobTokenUsage,
  extractTokenUsageFromStreamEvent,
  updateKanbanTokenUsage,
  updatePhaseTokenUsageSnapshot,
  maybeUpdatePhaseTokenUsage,
  applyEstimatedInputTokens,
  applyEstimatedInputTokensFromMessages,
  approxTokenCountFromChars,
  runEstimatingLLM,
  runEstimatingLLMStream,
  applyEstimatingUsage,
} from './llmHelpers.js';

// Runner Helpers
export {
  loadRecursionLimit, isRecursionLimitError, cleanupChat,
  isEnvResume, logResumeMarker, invokeGraph, saveEarlyDirective,
} from './runnerHelpers.js';

// Annotation Helpers (Fields only — State types live in nodes/*/types.ts to avoid name collisions)
export {
  ResolvableFields, TriageableFields, DetectableFields,
} from './annotationHelpers.js';

// Timing
export type { UILocale } from './timing/estimatingLabels.js';
export { getEstimatingLabel, detectUILocale } from './timing/estimatingLabels.js';
export type { JobTiming } from './timing/JobTimingManager.js';
export { JobTimingManager } from './timing/JobTimingManager.js';
