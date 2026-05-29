/**
 * LLM Configuration Constants
 * 
 * Ant's pipeline requires DETERMINISTIC outputs:
 * - Same PRD/design → Same code output
 * - Reproducible across runs
 * - Predictable for code review
 * 
 * Temperature Guidelines:
 * - 0.0~0.2: Highly deterministic (classification, detection, code generation)
 * - 0.3: Slight flexibility (planning, decomposition)
 * - 0.5+: Creative tasks (NOT recommended for Ant pipeline)
 */

export const LLM_TEMPERATURE = {
  // Analysis & Detection (최고 결정론적)
  DETECT: 0.2,
  
  // Decomposition (구조적 분해)
  DECOMPOSE: 0.2,
  
  // Planning (약간의 유연성, 하지만 일관된 구조)
  PLAN_KEYWORD: 0.2,
  PLAN_GENERATION: 0.3,
  
  // Code Execution (스펙 준수 최우선)
  CODE_EXECUTE: 0.2,
} as const;

export const LLM_THINKING_BUDGET = {
  PLAN: 10000,
  DECOMPOSE: 10000,
  CODE_EXECUTE: 5000,
  REVISE: 10000,
} as const;

export const LLM_MAX_TOKENS = {
  // Short outputs (no thinking, concise keyword responses)
  KEYWORD: 3200,

  // Default for plan / execute / verify / docgen.
  //
  // Anthropic model output ceilings (per Anthropic docs, 2026-04):
  //   - Sonnet 4.6 / 4.5 / 4 (codebase default for code.*): 64K ceiling
  //   - Opus 4.8 / 4.7 / 4.6 (env override / reviewer): 128K ceiling
  //   - Opus 4 (deprecated, retires 2026-06-15): 32K hard limit
  //
  // 64K is the safe default: matches Sonnet's ceiling, well within Opus 4.8's.
  // With thinkingBudget 10K, text space = ~54K; with 5K, ~59K.
  //
  // Why bumped 32K → 64K (safe-braking-eagle RCA):
  // The legacy 32K cap caused silent mid-stream truncation in plan (parent
  // emits batches[] with full per-batch detail) and execute (single LLM
  // round emits a >20KB file). On `stop_reason: max_tokens` the closing
  // `</plan>` / `</file>` never arrives, the partial output is discarded,
  // and the orchestrator falls through to a fresh tool-loop — billing the
  // tokens twice with zero progress. See
  // `.claude/plans/safe-braking-eagle-id-code-enchanted-dongarra.md`.
  // Detection lives on `LLMStreamEvent.stopReason` (option A);
  // chunked-emission recovery is option C.
  //
  // Risk model: Opus 4 (deprecated) at 32K would have this rejected. Not
  // reachable from default config; only at risk if a user explicitly
  // overrides to the legacy ID before its 2026-06-15 retirement.
  DEFAULT: 64000,

  // Decompose Tier 4 may emit 30+ tasks against multi-ref design docs and
  // exhausted the legacy 32K mid-`<tasks>` block (the streaming parser
  // saw `<task>` elements but `</tasks>` never arrived, causing
  // `parseLLMResponse` to throw "Invalid response: <tasks> tag is required").
  // 64K gives ~54K text budget after thinkingBudget=10K, enough for ~150
  // tasks at typical sizes. Now identical to DEFAULT, kept as a named
  // constant for intent and so a future bump can split them again.
  DECOMPOSE: 64000,
} as const;
