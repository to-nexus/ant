/**
 * Design Plan Node — lean LLM+tools plan phase.
 *
 * Replaces the legacy `plan.ts` task-dispatcher. For supported intent
 * groups (`design-spec`, `design-system-design`) this node runs an
 * LLM+tools loop that decides the solution and produces a sealed
 * `<plan>` JSON consumed by execute. For other intent groups it
 * delegates to `dispatchOnly` so the existing plan→execute flow keeps
 * working without LLM exploration.
 *
 * Loop mechanics use the shared helpers in
 * `agents/common/graph/nodes/plan/` so the plan↔tool round-trip behaves
 * identically to the code-job plan node.
 */

import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { maybeJoinSubagents, ownerKeyFor } from '../../../../../common/subagent';
import { collectCompleted } from '../../../../../common/subagent/registry';
import { buildReportBlocks } from '../../../../../common/subagent/drain';
import { foldSubagentUsage } from '../../../../../common/subagent/tokens';
import { logSubagentDrain } from '../../../../../common/subagent/drainTrace';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import {
  runPlanToolLoopPhase as sharedRunPlanToolLoopPhase,
  runPlanWithTools,
} from '../../../../../common/graph/nodes/plan';
import { LLM_MAX_TOKENS, LLM_THINKING_BUDGET, LLM_TEMPERATURE } from '../../../../../common/graph/llmConfig';
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';
import { dispatchOnly } from './dispatchOnly';
import { finalizePlanOutcome } from './finalizeOutcome';
import { getTools } from './tools';
import { resolveLLMClient } from './llmClient';
import { buildPlanPromptBlocks } from './prompt';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';

const PLAN_LLM_INTENT_GROUPS = new Set(['design-spec', 'design-system-design']);

/**
 * Token channels this node MUST return so LangGraph keeps its own rounds'
 * usage. `currentPhaseTokenUsage` is deliberately excluded — see
 * `foldSubagentUsage` for why folding a child conversation there would corrupt
 * the parent's context-fullness gauge.
 */
export const DESIGN_PLAN_TOKEN_CHANNELS = [
  'tokenUsage',
  'tokenUsageByModel',
  '_currentTaskTokenUsage',
  '_currentTaskTokenUsageByModel',
] as const;

/**
 * Plan-phase join barrier for explore subagents (design twin of the code job's
 * `deliverOwedExploreReports`, code/nodes/plan/index.ts). The design plan tool
 * loop only delivers reports via the tool node's per-round drain, which fires
 * only on tool-call rounds. When the plan LLM stalls with neither a `<plan>`
 * seal nor tool calls (fallthrough) while explore reports are still owed, those
 * reports would be dropped (round-grading-sable class).
 *
 * IN-NODE consumption (code-twin parity — sage-causing-rover C1 fix): the
 * joined history is returned to the caller's plan loop, which re-runs the plan
 * LLM in the SAME node invocation. The previous implementation returned a
 * graph re-entry delta WITHOUT `llmResponse`; `routeAfterPlan` then saw the
 * tool node's cleared `toolCalls: []` and misrouted to execute — the reports
 * had already been deleted from the registry, so the injected NODE_PLAN was
 * never read again (collect-then-discard, worse than no barrier at all).
 * Self-terminating: `maybeJoinSubagents` returns null once reports are
 * delivered.
 */
async function joinOwedReportsIntoHistory(
  state: DesignGraphState,
  history: Array<{ role: string; content: unknown }>,
): Promise<{ history: any[]; tokenDelta: Record<string, any> } | null> {
  // Fresh entry (empty history) launched no explores — nothing to await.
  if (history.length === 0) return null;
  const joined = await maybeJoinSubagents(state as any, ownerKeyFor(state._httpJobId), {
    history: history as any,
  });
  if (!joined) return null;
  // Preserve role alternation: the stalled round's assistant text is not
  // captured by the tool loop, so insert a spacer when the last turn is a user
  // turn (tool_result) — two consecutive user turns crash Anthropic.
  const last = history[history.length - 1] as { role?: string } | undefined;
  const spacer =
    last?.role === 'assistant'
      ? []
      : [{ role: 'assistant' as const, content: '(pausing to receive subagent findings)' }];
  console.log('🔀 [DesignPlan] Delivered owed explore report(s) into NODE_PLAN → re-running plan in-node');
  return {
    history: [
      ...history,
      ...spacer,
      {
        role: 'user' as const,
        content: [
          ...joined.blocks,
          {
            type: 'text' as const,
            text: 'All pending subagent reports are delivered above. Incorporate their findings and seal your <plan> now.',
          },
        ],
      },
    ],
    tokenDelta: joined.tokenDelta,
  };
}

/**
 * Seal-time non-blocking drain (sage-causing-rover C2 fix): reports that
 * SETTLED between the last tool round and the `<plan>` seal used to flow to
 * the execute conversation only — the plan was decided without findings the
 * launch-ack had promised "before this phase concludes". Collects settled
 * entries WITHOUT awaiting pending ones (no joinAll — a still-running child
 * keeps the doc-43 contract: execute inherits it via the shared ownerKey).
 * Returns null when nothing settled.
 */
async function drainSettledReportsAtSeal(
  state: DesignGraphState,
): Promise<{ blocks: any[]; tokenDelta: Record<string, any> } | null> {
  const ownerKey = ownerKeyFor(state._httpJobId);
  const completed = collectCompleted(ownerKey);
  if (completed.length === 0) return null;
  const blocks = buildReportBlocks(completed);
  const tokenDelta = await foldSubagentUsage(state as any, completed);
  console.log(
    `🔀 [DesignPlan] ${completed.length} subagent report(s) settled at seal time — re-running plan with findings`,
  );
  logSubagentDrain({
    featurePath: state.context?.featurePath,
    jobId: state._httpJobId,
    site: 'seal-drain',
    ownerKey,
    delivered: completed,
    phase: 'plan',
    taskId: state.currentTask?.id,
  });
  return { blocks, tokenDelta };
}

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
    return {
      currentTask: undefined,
      recursionCount: state.recursionCount,
      recursionLimit: state.recursionLimit,
    };
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
      temperature: LLM_TEMPERATURE.PLAN_GENERATION,
      taskName: currentTask!.name,
      jobType: 'design',
      onTokenUsage: async (usage) => {
        const { accumulateTokenUsage, updateKanbanTokenUsage, logTokenUsageToFile } = await import(
          '../../../../../common/graph/llmHelpers'
        );
        // Attribute to the plan node's actual model (per-node override).
        accumulateTokenUsage(state as any, usage, { taskLevel: true, jobLevel: true, modelId: llm.modelName });
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
            modelId: llm.modelName,
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

  // Bounded in-node loop: a normal pass produces `planText` (seal) or
  // `toolCalls` (route to tool node) on the first iteration. Extra passes
  // exist only for report delivery — (a) seal-time settled reports (C2,
  // once), (b) fallthrough with owed reports (C1, self-terminating because
  // `collectCompleted` deletes delivered entries). Hard bound of 4 passes;
  // the LangGraph recursionLimit stays the outer backstop.
  let planHistory: any[] = nodePlan as any;
  let sealDrainDone = false;
  // Token channels, RE-READ from state at return time: `accumulateTokenUsage`
  // (this node's own rounds) and `foldSubagentUsage` (drains) both mutate
  // `state` in place, and LangGraph DISCARDS mutations that a node does not
  // return — the unreturned-channel-drop class documented in
  // subagent/tokens.ts. Keying this off the join delta meant a plan
  // invocation with no subagent fold returned {} and silently dropped every
  // round it had just paid for (zero-hunting-label: 16 of 19 design-plan
  // calls, 96,289 input tokens, never reached the task counter, the kanban
  // snapshot, or ledger.settle). The list is static: all four are declared on
  // the design graph, and an `in`-check here could only silently drop one back
  // into the same bug — `design-plan-token-channels.test.ts` asserts the
  // declarations instead, so removing a channel fails loudly.
  const tokenDeltaOut = (): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const k of DESIGN_PLAN_TOKEN_CHANNELS) {
      const v = (state as any)[k];
      if (v !== undefined) out[k] = v;
    }
    return out;
  };
  let outcome = await sharedRunPlanToolLoopPhase({
    history: planHistory,
    isActive: true,
    runRound: runRound as any,
  });

  for (let pass = 0; pass < 4; pass++) {
    if (outcome.kind === 'planText' && !sealDrainDone) {
      // C2 — seal-time non-blocking drain: settled-but-undelivered reports
      // must inform the plan BEFORE it is finalized. Re-run the plan LLM once
      // with the sealed plan + findings; pending (still-running) children are
      // NOT awaited — they flow to execute per the doc-43 contract.
      sealDrainDone = true;
      // `drained.tokenDelta` is intentionally unused: the fold already mutated
      // `state`, and `tokenDeltaOut()` re-reads every declared token channel
      // from there, so the delta would be a stale duplicate of that read.
      const drained = await drainSettledReportsAtSeal(state);
      if (drained) {
        planHistory = [
          ...(planHistory.length > 0 ? planHistory : [await ensureFreshUserTurn()]),
          { role: 'assistant' as const, content: `<plan>\n${outcome.planText}\n</plan>` },
          {
            role: 'user' as const,
            content: [
              ...drained.blocks,
              {
                type: 'text' as const,
                text:
                  'The subagent report(s) above arrived as you sealed your plan. ' +
                  'If the findings change your plan, revise it; otherwise keep it. ' +
                  'Output your final <plan> now.',
              },
            ],
          },
        ];
        outcome = await sharedRunPlanToolLoopPhase({
          history: planHistory,
          isActive: true,
          runRound: runRound as any,
        });
        continue;
      }
    }

    if (outcome.kind === 'planText' || outcome.kind === 'toolCalls') break;

    // Fallthrough (no <plan>, no tool calls) — C1: join owed reports and
    // re-run the plan LLM IN-NODE. Returning a graph delta here misroutes to
    // execute (the tool node clears `toolCalls`, so `routeAfterPlan` cannot
    // send a no-toolCalls state back to plan) while the join has already
    // consumed the registry entries.
    const joined = await joinOwedReportsIntoHistory(state, planHistory);
    if (!joined) break;
    planHistory = joined.history;
    outcome = await sharedRunPlanToolLoopPhase({
      history: planHistory,
      isActive: true,
      runRound: runRound as any,
    });
  }

  if (outcome.kind === 'planText') {
    if (state.deps?.workflowUpdate && state._httpJobId) {
      await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
    }
    const finalized = await finalizePlanOutcome(state, currentTask as DesignTask, {
      planText: outcome.planText,
    });
    return { ...finalized, ...tokenDeltaOut() };
  }

  if (outcome.kind === 'toolCalls') {
    // Short-circuit: graph routes to tool node. NODE_PLAN must be
    // self-contained for re-entry, so for fresh entry we prepend the
    // cached prompt body (rendered once via `ensureFreshUserTurn`).
    const updatedHistory = [
      ...(planHistory.length > 0 ? planHistory : []),
      ...(planHistory.length === 0 ? [await ensureFreshUserTurn()] : []),
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
      ...tokenDeltaOut(),
    };
  }

  // Fallthrough — finalize-from-exploration failed or no LLM output.
  // Design has no single-shot fallback; we surface as an empty plan
  // so execute can run without a sealed plan (legacy behaviour) but log
  // a warning.
  console.warn(
    `⚠️ [DesignPlan] Plan loop yielded no <plan> (${outcome.reason}). Falling through to execute with empty planText.`,
  );

  // Structured event so a post-hoc operator scanning log-{jobId}.json
  // can spot tasks that reached execute without a sealed plan (i.e. the
  // worst-case path where execute has no architectural decision to
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
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
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
