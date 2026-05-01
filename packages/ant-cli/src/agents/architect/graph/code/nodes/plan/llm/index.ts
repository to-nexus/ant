/**
 * Plan-LLM barrel — public surface of the plan-node LLM mechanism.
 *
 * Composition:
 *   - `prompt`       — `buildPlanPrompt` / `buildPlanPromptBlocks`
 *                      (single-string + cache-split content blocks).
 *   - `single`       — `generatePlanText` (single-shot path).
 *   - `tools`        — `runPlanLLMWithTools` + `PLAN_TOOL_LOOP_MAX`
 *                      (one tool-loop round driver).
 *   - `finalize`     — `finalizePlanFromExploration` + `FINALIZE_NUDGE`
 *                      (overlimit synthesis from gathered tool context).
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

export {
  runPlanLLMWithTools,
  PLAN_TOOL_LOOP_MAX,
} from './tools';
export type { PlanWithToolsResult } from './tools';

export {
  finalizePlanFromExploration,
  FINALIZE_NUDGE,
} from './finalize';

export {
  runPlanToolLoopPhase,
} from './toolLoop';
export type { PlanToolLoopOutcome } from './toolLoop';

export { selectLLMForTask } from './selectModel';
export { savePlanTextForDebug } from './savePlanText';
export { taskRequiresPlan } from './requiresPlan';
