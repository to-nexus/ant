/**
 * Code Job Worker Subgraph Builder
 *
 * Builds a LangGraph StateGraph for a single code task execution within
 * a TaskWorker. This is a lighter version of the main code graph that
 * only handles the task execution lifecycle (plan → execute → tool loop).
 *
 * Flow: plan → execute ↔ tool → checkTaskStatus → (plan/workerLearn)
 */

import { Annotation, StateGraph, END } from '@langchain/langgraph';
import type { ArchitectGraphState } from '../state';
import { CodeGraphChannels } from '../graph';
import { plan } from '../nodes/plan';
import { execute } from '../nodes/execute/index';
import { tool } from '../nodes/tool';
import { learn } from '../nodes/learn';
import { routeAfterExecute } from '../routers/executeRouter';
import { routeAfterPlan } from '../routers/planRouter';
import { routeAfterTool } from '../routers/toolRouter';
import { workerCheckTaskStatus } from '../nodes/checkTaskStatus/workerIndex';
import type { WorkerGraphBuilder } from './types';

/**
 * Lightweight learn node for worker subgraph.
 * Extracts lessons from the completed task without global state management.
 */
async function workerLearn(state: ArchitectGraphState): Promise<Partial<ArchitectGraphState>> {
  // Delegate to the standard learn node (it already handles single-task learning)
  return learn(state) as any;
}

const CodeWorkerSubgraphAnnotation = Annotation.Root({
  // Inherit ALL channels from main graph (SSOT — no manual sync needed)
  ...CodeGraphChannels,

  // Worker-only fields (not in main graph)
  _taskCompleted: Annotation<any>,
  _batchSplitCompleted: Annotation<any>,
});

/**
 * Build a worker subgraph for code job tasks.
 */
function buildWorkerSubgraph() {
  const graph = new StateGraph(CodeWorkerSubgraphAnnotation);

  // Register nodes
  graph.addNode('plan', plan as any);
  graph.addNode('execute', execute as any);
  graph.addNode('tool', tool as any);
  graph.addNode('checkTaskStatus', workerCheckTaskStatus as any);
  graph.addNode('learn', workerLearn as any);

  // Edges
  graph.addEdge('__start__' as any, 'plan' as any);

  // Plan → tool (if tool_calls), checkTaskStatus (if batch split), or execute
  graph.addConditionalEdges(
    'plan' as any,
    routeAfterPlan as any,
    { tool: 'tool', execute: 'execute', checkTaskStatus: 'checkTaskStatus' } as any,
  );

  // Execute → Router (tool / checkTaskStatus / execute / plan)
  graph.addConditionalEdges(
    'execute' as any,
    routeAfterExecute as any,
    {
      tool: 'tool',
      checkTaskStatus: 'checkTaskStatus',
      execute: 'execute',
      plan: 'plan',   // verification task done → plan re-verify (final build/test check)
    } as any,
  );

  // Tool → plan (if plan exploring) or execute
  graph.addConditionalEdges(
    'tool' as any,
    routeAfterTool as any,
    { plan: 'plan', execute: 'execute' } as any,
  );

  // checkTaskStatus routing
  graph.addConditionalEdges(
    'checkTaskStatus' as any,
    ((s: any) => {
      const taskCompleted = s._taskCompleted === true;
      const batchSplitCompleted = s._batchSplitCompleted === true;
      const hasViolations = s.violations && s.violations.length > 0;

      if (taskCompleted || batchSplitCompleted) {
        return 'learn';
      }

      if (hasViolations) {
        const remaining = (s.recursionLimit || 200) - (s.recursionCount || 0);
        if (remaining < 20) {
          console.warn(`⚠️  Worker: insufficient recursion budget (${remaining}) for retry — moving to learn`);
          return 'learn';
        }
        if ((s.retries || 0) < (s.maxRetries || 3)) {
          return 'plan';
        }
        console.log(`⚠️  Worker task "${s.currentTask?.name}" exhausted retries (${s.retries}/${s.maxRetries}) — moving to learn`);
        return 'learn';
      }

      return 'learn';
    }) as any,
    { plan: 'plan', learn: 'learn' } as any,
  );

  // Learn → END
  graph.addEdge('learn' as any, '__end__' as any);

  return (graph as any).compile();
}

/**
 * Create a WorkerGraphBuilder for code job tasks.
 * This function is passed to TaskOrchestrator as the graphBuilder callback.
 */
export function createCodeWorkerGraphBuilder(): WorkerGraphBuilder {
  return (_includeInstallValidate: boolean) => {
    return buildWorkerSubgraph();
  };
}
