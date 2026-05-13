/**
 * Design Plan Node — lean LLM+tools plan phase.
 *
 * Replaces the legacy `plan.ts` task-dispatcher. For supported intent
 * groups (`design-spec`, `design-system-design`) this node runs an
 * LLM+tools loop that decides the solution and produces a sealed
 * `<plan>` JSON consumed by docGen. For other intent groups it
 * delegates to `dispatchOnly` so the existing plan→docGen flow keeps
 * working without LLM exploration.
 *
 * Loop mechanics use the shared helpers in
 * `agents/common/graph/nodes/plan/` so the plan↔tool round-trip behaves
 * identically to the code-job plan node.
 */

import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import {
  runPlanToolLoopPhase as sharedRunPlanToolLoopPhase,
  runPlanWithTools,
} from '../../../../../common/graph/nodes/plan';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET } from '../../../../../common/graph/llmConfig';
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';
import { dispatchOnly } from './dispatchOnly';
import { finalizePlanOutcome } from './finalizeOutcome';
import { getTools } from './tools';
import { resolveLLMClient } from './llmClient';
import { buildPlanPromptBlocks } from './prompt';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';

const PLAN_LLM_INTENT_GROUPS = new Set(['design-spec', 'design-system-design']);

export async function plan(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  const intentGroup = state.resolvedAction?.intentGroup;
  const planLLMSupported = !!intentGroup && PLAN_LLM_INTENT_GROUPS.has(intentGroup);

  // Fallback: ui-design / game-art-design keep the legacy dispatcher behaviour.
  if (!planLLMSupported) {
    return dispatchOnly(state);
  }

  // Re-entry path: tool node returned with `_activePhase === 'plan'`
  // and NODE_PLAN history populated. Stay on the same task — do not
  // pop a new one.
  const nodePlan = getConv(state.conversations, CONV_KEYS.NODE_PLAN);
  const isReEntry = state._activePhase === 'plan' && nodePlan.length > 0 && !!state.currentTask;

  let currentTask = state.currentTask;
  if (!isReEntry) {
    const dispatched = await prepareFreshTask(state);
    if (!dispatched.currentTask) {
      // Dispatcher returned without a task — let the existing flow
      // (likely caller routing) handle it. Bail without LLM work.
      return dispatched;
    }
    currentTask = dispatched.currentTask as DesignTask;
  }

  if (!currentTask) {
    return { currentTask: undefined };
  }

  // Workflow enter (LLM info attached for the gauge).
  if (state.deps?.workflowUpdate && state._httpJobId) {
    const taskInfo = {
      id: currentTask.id,
      name: currentTask.name,
      type: currentTask.type,
      description: currentTask.description,
      priority: currentTask.priority,
    };
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId,
      'plan',
      state.workerId ?? 0,
      taskInfo,
      state.deps?.llm ? extractLLMInfo(state.deps.llm) : undefined,
      state.recursionCount,
      state.recursionLimit,
    );
  }

  // Cached fresh-entry user turn — computed once on first need and
  // reused for both the LLM round AND the tool-calls history
  // reconstruction (so `runRound` doesn't render the prompt twice).
  let freshUserTurn: { role: 'user'; content: any } | undefined;
  const ensureFreshUserTurn = async () => {
    if (!freshUserTurn) {
      const { blocks } = await buildPlanPromptBlocks(state, currentTask as DesignTask);
      freshUserTurn = { role: 'user' as const, content: blocks };
    }
    return freshUserTurn;
  };

  // Build a closure over `runPlanWithTools` so the shared loop helper
  // can drive one round at a time without owning prompt/model/tool
  // selection (those stay design-local here).
  const runRound = async (history: Array<{ role: 'user' | 'assistant'; content: any }>) => {
    const llm = await resolveLLMClient(state);
    if (!llm) return null;
    const tools = await getTools(state);

    // Fresh entry: seed history with the rendered prompt. Re-entry:
    // pass the running NODE_PLAN history.
    const messages = history.length > 0
      ? history
      : [await ensureFreshUserTurn()];

    const isFirstRound = messages.length <= 1;
    return runPlanWithTools<DesignGraphState>({
      state,
      messages,
      llm,
      tools,
      enableThinking: isFirstRound,
      thinkingBudget: isFirstRound ? LLM_THINKING_BUDGET.PLAN : undefined,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      taskName: currentTask!.name,
      jobType: 'design',
      onTokenUsage: async (usage) => {
        const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import(
          '../../../../../common/graph/llmHelpers'
        );
        accumulateTokenUsage(state as any, usage, { taskLevel: true, jobLevel: true });
        updateKanbanTokenUsage(state as any);
        const planRound = Math.floor(messages.length / 2);
        logTokenUsageToFile(
          state.context?.featurePath,
          state._httpJobId,
          usage,
          {
            taskId: currentTask!.id,
            taskName: currentTask!.name,
            node: 'design-plan',
            callIndex: planRound,
            nodeHistoryLength: messages.length,
            recursionCount: state.recursionCount,
          },
        );
      },
      onMaxTokensTruncation: ({ outputTokens, round }) => {
        console.warn(
          `⚠️  [Design/Plan] max_tokens truncated (round=${round}, output=${outputTokens}) ` +
          `for task "${currentTask!.name}". The partial output is discarded and the next ` +
          `tool-loop entry restarts from scratch.`,
        );
        const featurePath = state.context?.featurePath;
        if (featurePath && state._httpJobId) {
          void getExecutionLogger({
            featurePath,
            jobId: state._httpJobId,
            jobType: 'design',
          })
            .log('max_tokens_truncated', {
              node: 'design-plan',
              round,
              outputTokens,
              maxTokens: LLM_MAX_TOKENS.DEFAULT,
              taskName: currentTask!.name,
              recoveryHint: 'fresh-toolloop-restart',
            }, currentTask!.id)
            .catch(() => { /* non-blocking */ });
        }
      },
    });
  };

  const outcome = await sharedRunPlanToolLoopPhase({
    history: nodePlan as any,
    isActive: true,
    runRound: runRound as any,
  });

  if (outcome.kind === 'planText') {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    const finalized = await finalizePlanOutcome(state, currentTask as DesignTask, {
      planText: outcome.planText,
    });
    return finalized;
  }

  if (outcome.kind === 'toolCalls') {
    // Short-circuit: graph routes to tool node. NODE_PLAN must be
    // self-contained for re-entry, so for fresh entry we prepend the
    // cached prompt body (rendered once via `ensureFreshUserTurn`).
    const updatedHistory = [
      ...(nodePlan.length > 0 ? nodePlan : []),
      ...(nodePlan.length === 0 ? [await ensureFreshUserTurn()] : []),
      outcome.assistantMessage,
    ] as any;
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    return {
      currentTask,
      conversations: { [CONV_KEYS.NODE_PLAN]: updatedHistory },
      _activePhase: 'plan' as const,
      llmResponse: outcome.llmResponse as any,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
  }

  // Fallthrough — finalize-from-exploration failed or no LLM output.
  // Design has no single-shot fallback; we surface as an empty plan
  // so docGen can run without a sealed plan (legacy behaviour) but log
  // a warning.
  console.warn(
    `⚠️ [DesignPlan] Plan loop yielded no <plan> (${outcome.reason}). Falling through to docGen with empty planText.`,
  );

  // Structured event so a post-hoc operator scanning log-{jobId}.json
  // can spot tasks that reached docGen without a sealed plan (i.e. the
  // worst-case path where docGen has no architectural decision to
  // anchor on). Mirrors `design-plan-sealed` from the success path so
  // the two outcomes are queryable with the same `phase` prefix.
  if (state.context?.featurePath && state._httpJobId && currentTask) {
    const startedAt = (currentTask as DesignTask).timing?.startedAt;
    const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;
    void getExecutionLogger({
      featurePath: state.context.featurePath,
      jobId: state._httpJobId,
      jobType: 'design',
    })
      .logPhaseComplete({
        phase: 'design-plan-fallthrough',
        elapsedMs,
        details: {
          taskId: currentTask.id,
          taskName: currentTask.name,
          taskType: currentTask.type,
          intentGroup: state.resolvedAction?.intentGroup,
          reason: outcome.reason,
          nodePlanHistoryLen: nodePlan.length,
          recursionCount: state.recursionCount,
        },
      })
      .catch(() => { /* non-blocking */ });
  }

  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
  }
  return {
    currentTask,
    planText: '',
    _activePhase: undefined,
    conversations: { [CONV_KEYS.NODE_PLAN]: [] },
  };
}

/**
 * Re-export the dispatch-only fallback so callers (workerGraph builds
 * importing `nodes/plan`) keep one stable entry point even when the
 * worker uses the lean LLM plan.
 */
export { dispatchOnly } from './dispatchOnly';

/**
 * First-time entry housekeeping — pop next task, start timing, update
 * Kanban, log task_start. Mirrors `dispatchOnly` minus the workflow
 * `enterNode` (the main `plan` body issues that with LLM info attached).
 */
async function prepareFreshTask(state: DesignGraphState): Promise<Partial<DesignGraphState>> {
  let currentTask = state.currentTask;

  if (state.taskQueue && !currentTask) {
    const nextTask = state.taskQueue.pop();
    if (!nextTask) {
      console.log('⚠️  No task to execute');
      return { ...state };
    }

    console.log(`\n📋 Processing task: "${nextTask.name}"`);
    console.log(`   Priority: ${nextTask.priority}`);
    console.log(`   Description: ${nextTask.description}\n`);

    const { TaskTimingHelper } = await import('../../../code/state');
    console.log(`⏱️  Starting timer for task: ${nextTask.name}`);
    currentTask = TaskTimingHelper.startTask(nextTask) as DesignTask;

    const { resetTaskTokenUsage } = await import('../../../../../common/graph/llmHelpers');
    resetTaskTokenUsage(state);

    const isWorkerContext = state.workerId !== undefined && state.workerId !== null;
    if (!isWorkerContext && state._httpJobId && state.deps?.kanbanUpdate) {
      console.log(`\n🔥 [Plan] Updating Kanban → task started`);
      console.log(`   Current: ${currentTask.name}`);
      console.log(`   Remaining in queue: ${state.taskQueue.size()}\n`);

      state.deps.kanbanUpdate.updateTaskQueue(
        state._httpJobId,
        currentTask,
        state.taskQueue.getAll(),
        state.completedTasksDetails || [],
      );
    }

    const { saveTaskStartCheckpoint } = await import('../../session/checkpoint');
    await saveTaskStartCheckpoint(state, { currentTask });

    if (state.context?.featurePath && state._httpJobId) {
      try {
        const execLogger = getExecutionLogger({
          featurePath: state.context.featurePath,
          jobId: state._httpJobId,
          jobType: 'design',
        });
        await execLogger.logTaskStart(currentTask.id, {
          taskName: currentTask.name,
          taskType: currentTask.type || 'doc',
          priority: currentTask.priority || 0,
          isParallel: false,
          parallelGroup: (currentTask as any).parallelGroup,
        });
      } catch (_) { /* non-critical */ }
    }
  }

  return { ...state, currentTask };
}
