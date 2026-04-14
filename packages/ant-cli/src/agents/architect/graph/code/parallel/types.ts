/**
 * Parallel Execution Types — re-export from common
 *
 * Canonical definitions live in common/graph/parallelTypes.ts.
 * This file re-exports everything so existing code/parallel/* imports
 * continue to work without modification.
 */

export {
  type OrchestratorResult,
  type FailedTask,
  type OrchestratorConfig,
  type OrchestratorCallbacks,
  type ParallelCheckpoint,
  type WorkerGraphBuilder,
  type WorkerSnapshot,
  getTaskConcurrency,
} from '../../../../common/graph/parallelTypes';
