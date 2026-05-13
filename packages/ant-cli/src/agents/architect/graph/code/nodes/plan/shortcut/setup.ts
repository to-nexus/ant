import type { LLMClient } from '../../../../../../../core/ports';
import { CONV_KEYS } from '../../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../../state';
import { generatePlanText } from '../llm';
import { isSetupTask } from '../../../tasks/setup';
import type { PlanEntryContext } from '../entry';

/**
 * Setup task fast-path — new projects have no existing code, so
 * keyword/RAG/tool-loop are skipped and planText is rendered directly
 * from the setup variant.
 */
export async function maybeSetupFastPath(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  workflowExit: (state: ArchitectGraphState) => Promise<void>,
): Promise<ArchitectGraphState | null> {
  const { nextTask } = entry;
  if (!isSetupTask(nextTask)) return null;
  const llm = state.deps?.llm as LLMClient | undefined;
  console.log(`⚡ [Plan] Setup task — skipping keyword/RAG/tool-loop (no existing code to search)`);

  const emptyCodeContext = {
    source: 'plan' as const,
    filePaths: [] as string[],
    files: [] as any[],
    stats: { filesLoaded: 0, stackTraceCount: 0, semanticCount: 0, deduplicatedCount: 0, estimatedTokens: 0 },
  };

  const setupRemainingTasks = (state.taskQueue?.getAll() || [])
    .filter(t => t.id !== nextTask.id)
    .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

  const setupPlanText = await generatePlanText(
    llm!, nextTask, state, emptyCodeContext,
    state.violations, undefined, setupRemainingTasks,
  );

  await workflowExit(state);

  return {
    ...state,
    currentTask: nextTask,
    lessons: [],
    planText: setupPlanText,
    // retries — handleRetryEntry is the single writer (bc1e45b9).
    completedTasksDetails: state.completedTasksDetails || [],
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
    workspaceConfig: state.workspaceConfig,
    _activePhase: 'execute' as const,
    conversations: { [CONV_KEYS.NODE_EXECUTE]: [] },
  };
}
