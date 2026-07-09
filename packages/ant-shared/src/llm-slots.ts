/**
 * Per-node LLM model slots — single source of truth.
 *
 * "Which (job, node) pairs expose a model-override chip in project settings" was
 * previously hand-copied across the FE picker (`LLMModelsSection.tsx`), the FE +
 * BE `JobLLMConfig` interfaces, and the factory `nodeType` union. This module owns
 * that decision once. A regression test
 * (`tests/config/llm-model-slots-coverage.test.ts`) reconciles the maps below
 * against the compiled LangGraph so a graph refactor that adds / renames / removes
 * an LLM node fails loudly instead of silently drifting from the picker.
 *
 * Model *value* resolution (`llmModels[job][node] ?? llmModels[job].default`) stays
 * in `LLMClientFactory`; this file only enumerates the slots.
 */

/** Jobs that expose a per-node model picker. */
export type ModelJobKey = 'plan' | 'design' | 'code' | 'learn' | 'visual';

/**
 * Every key that can appear in a `JobLLMConfig` — the storage / value-resolution
 * surface, a superset of the picker-overridable slots (`default` plus BE-only
 * value keys like `tool` / `validate`).
 */
export type ModelNodeKey =
  | 'default'
  | 'decompose'
  | 'plan'
  | 'execute'
  | 'tool'
  | 'validate'
  | 'learn'
  | 'detect'
  | 'direct'
  | 'sketch'
  | 'render'
  | 'engrave'
  | 'explain';

/**
 * Per-job model config. Unifies the two hand-copied `JobLLMConfig` interfaces
 * (FE `infrastructure/http/api/config.ts`, BE `core/types/workspace.ts`).
 * Provider is auto-detected from the model name.
 */
export type JobLLMConfig = Partial<Record<ModelNodeKey, string>>;

/**
 * (job → agent) half of the GraphMetadataService lookup. Mirrors
 * `GraphMetadataService.getGraphBuilder`'s switch.
 */
export const MODEL_JOB_AGENT: Record<ModelJobKey, string> = {
  plan: 'planner',
  design: 'architect',
  code: 'architect',
  learn: 'architect',
  visual: 'creator',
};

/**
 * THE map graph refactors must update: the curated node slots the picker exposes
 * as overridable, per job (excludes the always-present job `default`).
 */
export const OVERRIDABLE_MODEL_SLOTS: Record<ModelJobKey, readonly ModelNodeKey[]> = {
  plan: ['plan', 'execute'],
  design: ['decompose', 'plan', 'execute'],
  code: ['decompose', 'plan', 'execute'],
  learn: [],
  visual: ['direct', 'sketch', 'render', 'engrave', 'explain'],
};

/**
 * Slots resolved through `createImageGenerationClient` (image actor), NOT the
 * `llm` actor. Overridable in the picker, but excluded from the llm drift
 * cross-check (they never carry the `llm` actor).
 */
export const IMAGE_GEN_SLOTS: Partial<Record<ModelJobKey, readonly ModelNodeKey[]>> = {
  visual: ['sketch', 'render'],
};

/**
 * llm-touching graph nodes that are INTENTIONALLY not user-overridable, keyed by
 * `${agent}:${job}`. Lets the drift guard distinguish "forgot to add a slot"
 * from "deliberately fixed".
 */
export const NON_OVERRIDABLE_LLM_NODES: Record<string, readonly string[]> = {
  'architect:learn': ['decompose'],
  'planner:plan': ['triage', 'detect'],
  'creator:visual': ['triage', 'detect'],
};
