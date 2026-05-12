/**
 * Shared plan-LLM helpers — barrel.
 *
 * See `README.md` for the abstraction policy. This directory is
 * deliberately function-only: there is no `PlanStrategy` interface or
 * `createPlanNode(strategy)` factory because code's plan node has 5
 * internal stages (entry/shortcut/RAG/llm/outcome) while design's is
 * lean — the abstraction surface that fits both is too narrow to be
 * useful, while the cost of a phantom strategy interface is high
 * (forces awkward methods on one of the two callees).
 */

export { runPlanWithTools } from './runPlanWithTools';
export { runPlanToolLoopPhase } from './runPlanToolLoopPhase';
export { extractPlanText } from './extractPlanText';
export type {
  MinimalPlanState,
  PlanLLMResponse,
  PlanLoopOutcome,
  PlanRoundResult,
  PlanToolCall,
  RunPlanWithToolsArgs,
} from './types';
export type { RunPlanToolLoopPhaseArgs } from './runPlanToolLoopPhase';
