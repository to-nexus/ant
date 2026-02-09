/**
 * Design Job Parallel Execution Module
 *
 * Re-exports the shared parallel infrastructure (from code/parallel/)
 * and provides design-specific worker graph builder.
 */

export { createDesignWorkerGraphBuilder } from './workerGraph';

// Re-export shared parallel infrastructure for convenience
export {
  TaskOrchestrator,
  TaskWorker,
  getTaskConcurrency,
} from '../../code/parallel';

export type {
  OrchestratorResult,
  OrchestratorConfig,
  OrchestratorCallbacks,
  WorkerGraphBuilder,
} from '../../code/parallel';
