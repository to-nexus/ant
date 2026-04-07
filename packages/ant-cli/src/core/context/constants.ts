/**
 * Context Management — all token budget constants.
 */

// === Sub-turn: compactToolResults ===
export const COMPACTABLE_TOOLS = new Set([
  'read_file', 'search_code', 'run_command', 'list_files',
  'search_reference_code', 'read_source_doc',
]);
export const MIN_CONTENT_TOKENS_TO_COMPACT = 200;
export const DEFAULT_COMPACT_TOOL_RESULTS_HOT_TAIL = 3;

// === Turn: compactTurns ===
export const DEFAULT_COMPACT_TURNS_THRESHOLD = 50_000;
export const DEFAULT_COMPACT_TURNS_HOT_TAIL = 5;

// === Turn: pruneTurns ===
export const DEFAULT_PRUNE_TURNS_MAX_TOKENS = 75_000;
export const DEFAULT_PRUNE_TURNS_MIN_KEEP = 3;

// === Job: compactJob — Plan ===
export const PLAN_CONVERSATION_HISTORY_BUDGET = 50_000;
export const PLAN_COMPACTION_THRESHOLD = 12_000;
export const PLAN_COMPACTION_WINDOW = 4;

// === Job: compactJob — Visual ===
export const VISUAL_COMPACTION_THRESHOLD = 6_400;
export const VISUAL_COMPACTION_WINDOW = 3;

// === Job: compactJob — LLM ===
export const COMPACTION_MAX_OUTPUT_TOKENS = 16_384;

// === Job: Inter-Job Context — Code/Design ===
export const CODE_JOB_COMPACTION_THRESHOLD = 8_000;
export const CODE_JOB_COMPACTION_WINDOW = 4;    // Must be even: entries are user+assistant pairs
export const DESIGN_JOB_COMPACTION_THRESHOLD = 8_000;
export const DESIGN_JOB_COMPACTION_WINDOW = 4;  // Must be even: entries are user+assistant pairs
