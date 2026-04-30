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

// === Decompose: Artifact Compaction ===
//
// Single-artifact thresholds for `prepareRacInjection` (code/decompose).
// Refs are the development source — preserve more aggressively (larger
// inline budget). Context is supplementary — outline earlier so the prompt
// stays compact when many context docs are supplied.
//
// Both roles flow through the SAME `compactContent` machinery; only the
// per-role dial differs. Grand-total overflow further demotes thresholds
// to 0 (greedy outline of remaining inline docs) inside `prepareRacInjection`.
/** Single ref artifact stays inline when its content fits this many chars. */
export const REF_INLINE_THRESHOLD_CHARS     = 8_000;
/** Single context artifact stays inline when its content fits this many chars. */
export const CONTEXT_INLINE_THRESHOLD_CHARS = 2_000;

// === Decompose: Token Budget Reservations ===
//
// Reserved token budget for non-artifact channels of the decompose prompt.
// `computeArtifactBudgetChars(modelContextLimitTokens)` subtracts these
// reservations from the model's input window to derive the remaining
// chars budget for artifact (refs + context) content. Values are
// conservative upper bounds intended to absorb prompt-cache miss
// re-billing and worst-case Korean / CJK char-to-token ratios.
export const SAFETY_MARGIN_TOKENS = 8_000;
export const OUTPUT_RESERVE_TOKENS = 16_000;
export const THINKING_RESERVE_TOKENS = 10_000;
export const TOOL_DEF_RESERVE_TOKENS = 2_000;
export const TOOL_RESULT_RESERVE_TOKENS = 30_000;
export const SYSTEM_PROMPT_RESERVE_TOKENS = 10_000;
/**
 * Worst-case characters-per-token ratio used when converting the artifact
 * token budget to a char budget. Empirically Korean / Japanese / Chinese
 * content lands near 1.0 chars/token at the worst (single high-codepoint
 * character per token); ASCII English is ~3.5–4.0 but we always use the
 * conservative 1.0 figure to avoid token overflow on multilingual inputs.
 */
export const WORST_CASE_CHARS_PER_TOKEN = 1.0;
/**
 * Fallback model context limit when `extractLLMInfo` does not surface a
 * `contextWindowTokens` value. 128K covers Sonnet/Opus mid-tier; the
 * compaction pipeline will scale down to a smaller artifact budget when
 * this fallback applies. Phase 2: thread the real value end-to-end.
 */
export const FALLBACK_MODEL_CONTEXT_LIMIT_TOKENS = 128_000;
