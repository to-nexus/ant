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

  // Default for all other outputs — 32K ensures sufficient text space after thinking budget.
  // Anthropic model output ceilings (per Anthropic docs as of 2026-04):
  //   - Sonnet 4.6 / Sonnet 4.5 / Sonnet 4: 64K ceiling (default 32K)
  //   - Opus 4.7 / Opus 4.6: 128K ceiling
  //   - Opus 4 (deprecated, retires 2026-06-15): 32K hard limit
  // With thinkingBudget 10K, text space = ~22K. With 5K, text space = ~27K.
  DEFAULT: 32000,

  // Decompose Tier 4 may emit 30+ tasks against multi-ref design docs and
  // routinely exhausts the 32K DEFAULT mid-`<tasks>` block (the streaming
  // parser sees `<task>` elements but `</tasks>` never arrives, causing
  // `parseLLMResponse` to throw "Invalid response: <tasks> tag is required").
  // 64K gives ~54K text budget after thinkingBudget=10K, enough for ~150
  // tasks at typical sizes.
  //
  // Model support:
  //   - Sonnet 4.6 / 4.5 / 4 (codebase default for code.*): 64K supported
  //   - Opus 4.7 / 4.6 (codebase default for reviewer/doc; LLMClientFactory
  //     fallback): 128K supported, 64K well within
  //   - Opus 4 (deprecated, 32K): would be rejected by Anthropic API. Not
  //     used by default config; only at risk if a user explicitly overrides
  //     llmModels.code.decompose to the legacy ID.
  DECOMPOSE: 64000,
} as const;
