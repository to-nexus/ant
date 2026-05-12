/**
 * Plan-LLM barrel — public surface of the plan-node LLM mechanism.
 *
 * Composition:
 *   - `prompt`       — `buildPlanPrompt` / `buildPlanPromptBlocks`
 *                      (single-string + cache-split content blocks).
 *   - `single`       — `generatePlanText` (single-shot path).
 *   - `tools`        — `runPlanLLMWithTools` (one tool-loop round driver).
 *   - `toolLoop`     — `runPlanToolLoopPhase` (re-entry orchestrator
 *                      called from `nodes/plan/index.ts`).
 *   - `selectModel`  — `selectLLMForTask` (workspace-config-aware
 *                      LLM resolution).
 *   - `savePlanText` — `savePlanTextForDebug` (debug-only persistence).
 *   - `requiresPlan` — `taskRequiresPlan` (predicate gate).
 *
 * Phase code (`nodes/plan/index.ts`, `shortcut/setup.ts`) imports from
 * this barrel; intra-`llm/` siblings import each other directly to keep
 * the dependency graph explicit.
 */

export {
  buildPlanPrompt,
  buildPlanPromptBlocks,
} from './prompt';
export type {
  BuildPlanPromptResult,
  BuildPlanPromptBlocksResult,
} from './prompt';

export { generatePlanText } from './single';

export { runPlanLLMWithTools } from './tools';
export type { PlanWithToolsResult } from './tools';

export {
  runPlanToolLoopPhase,
} from './toolLoop';
export type { PlanToolLoopOutcome } from './toolLoop';

export { selectLLMForTask } from './selectModel';
export { savePlanTextForDebug } from './savePlanText';
export { taskRequiresPlan } from './requiresPlan';
