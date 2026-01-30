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

export const LLM_MAX_TOKENS = {
  // Short outputs
  KEYWORD: 800,
  
  // Medium outputs
  PLAN: 8000,
  DECOMPOSE_UI: 8000,
  
  // Long outputs
  DECOMPOSE_SYSTEM: 16000,
  DETECT: 16000,
  CODE_EXECUTE: 16000,
} as const;
