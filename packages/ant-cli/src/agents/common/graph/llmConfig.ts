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
  // Anthropic model defaults: Sonnet 4 = 64K, Opus 4 = 32K.
  // With thinkingBudget 10K, text space = ~22K. With 5K, text space = ~27K.
  DEFAULT: 32000,
} as const;
