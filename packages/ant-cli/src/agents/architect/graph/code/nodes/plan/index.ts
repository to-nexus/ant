/**
 * Plan node — thin orchestrator.
 *
 *   1. entry/   — STEP 0 entry classification.
 *   2. shortcut/ — fast paths (resume / prePlanText / setup) bypass plan-LLM.
 *   3. llm/toolLoop — STEP 0.9 plan↔tool loop re-entry.
 *   4. rag/     — STEP 0.8~STEP 2.5 RAG.
 *   5. STEP 3   — main plan-LLM call (single-shot or tools-first).
 *   6. STEP 3.5 — `processDiagnosticBatchSplit` fan-out.
 *   7. STEP 4   — finalised state return.
 *
 * R1: orchestrator stays blind to `task.type`; task-type discrimination is
 * delegated to per-task predicates and hooks.
 */

import type { LLMClient } from '../../../../../../core/ports';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';
import { CONV_KEYS, getConv } from '../../../../../common/graph/conversations';
import { ArchitectGraphState } from '../../state';
import { CodeTask } from '../../../../types/task';
import {
  buildPlanPromptBlocks,
  generatePlanText,
  runPlanLLMWithTools,
  runPlanToolLoopPhase,
} from './llm';
import {
  PlanEntryContext,
  composeViolationsText,
  resolvePlanEntry,
} from './entry';
import { mergeDelta } from './outcome/delta';
import { finalizePlanOutcome } from './outcome/finalize';
import {
  maybeResumeInterrupted,
  maybePrePlannedFastPath,
  maybeSetupFastPath,
} from './shortcut';
import {
  MAX_BATCH_SPLIT_CYCLES,
  BatchSplitSchemaViolation,
  buildBatchSplitSchemaViolationFraming,
} from '../../tasks/_shared/batchSplit';
import { runPlanRAG } from './rag';
import { hooksForTaskType } from '../../tasks/_shared/registry';

/**
 * Inline retry budget for `BatchSplitSchemaViolation` (see
 * `tasks/_shared/batchSplit/schemaViolation.ts`). Mirrors decompose's
 * `MAX_ATTEMPTS = 3` SSOT in `nodes/decompose/index.ts:548`.
 */
const PLAN_SCHEMA_VIOLATION_MAX_ATTEMPTS = 3;

// Back-compat re-exports.
export type { PlanEntryContext } from './entry';
export { resolvePlanEntry } from './entry';
export { runPlanToolLoopPhase } from './llm';

/** Test-only exports for verification scenario harness L1 unit tests. */
export const __testing__ = {
  finalizePlanOutcome,
  MAX_BATCH_SPLIT_CYCLES,
  resolvePlanEntry,
  runPlanToolLoopPhase,
};

async function workflowEnter(state: ArchitectGraphState, nextTask: CodeTask): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  const taskInfo = {
    id: nextTask.id,
    name: nextTask.name,
    type: nextTask.type,
    description: nextTask.description,
    priority: nextTask.priority,
  };
  await state.deps.workflowUpdate.enterNode(
    state._httpJobId,
    'plan',
    state.workerId ?? 0,
    taskInfo,
    state.deps?.llm ? extractLLMInfo(state.deps.llm as LLMClient) : undefined,
    state.recursionCount,
    state.recursionLimit,
  );
}

async function workflowExit(state: ArchitectGraphState): Promise<void> {
  if (!state.deps?.workflowUpdate || !state._httpJobId) return;
  await state.deps.workflowUpdate.exitNode(state._httpJobId, 'plan', state.workerId ?? 0);
}

/**
 * STEP 3 — main plan-LLM call. Tools-first when the task requires
 * exploration; falls back to `generatePlanText` otherwise.
 *
 * Returns either a graph state (LLM chose tool calls — caller short-circuits
 * and the next graph tick re-enters plan) or a plain `planText` string.
 *
 * R1: phase-blind. Prior-attempt continuity rides on the verification-
 * variant template (Session-driven summary lines) and the rules-level
 * pointer to `sessions/architect/code.json` for LLM self-service lookup.
 */
async function runMainPlanLLM(
  state: ArchitectGraphState,
  entry: PlanEntryContext,
  rag: Awaited<ReturnType<typeof runPlanRAG>>,
): Promise<ArchitectGraphState | { planText: string }> {
  const { nextTask } = entry;
  const llm = state.deps?.llm as LLMClient | undefined;
  const planHook = hooksForTaskType(nextTask.type)?.plan;
  const requiresPlanText = planHook?.requiresPlanText ?? true;
  const usesToolLoop = planHook?.usesToolLoop ?? requiresPlanText;

  const remainingTasks = (state.taskQueue?.getAll() || [])
    .filter(t => t.id !== nextTask.id)
    .map(t => ({ id: t.id, name: t.name, description: t.description, priority: t.priority }));

  // Polite-cap removed (pure-rivest RCA). Whenever the task type wants the
  // tool loop, take it — bounded only by LangGraph's `recursionLimit` and
  // the executeRouter safety nets, never by an in-loop round count.
  const tryToolsFirst = llm && usesToolLoop;

  // UI doc injection is now handled by ArtifactPipeline in planGeneration.ts.
  const uiDocForPlan: string | undefined = undefined;

  if (tryToolsFirst) {
    const violationsText = composeViolationsText(state.violations);
    const { blocks: contentBlocks, vars: hookLogVars } = await buildPlanPromptBlocks(
      state, nextTask, rag.codeContext, violationsText, uiDocForPlan, remainingTasks, { hasTools: true },
    );
    const messages = [{ role: 'user' as const, content: contentBlocks }];
    const result = await runPlanLLMWithTools(state, messages, nextTask, { extraLogVars: hookLogVars });
    if (result && '_activePhase' in result) {
      await workflowExit(state);
      return {
        ...state,
        currentTask: nextTask,
        conversations: { [CONV_KEYS.NODE_PLAN]: result.nodePlanHistory },
        _activePhase: 'plan' as const,
        llmResponse: result.llmResponse,
        lessons: rag.lessons,
      };
    }
    if (result && 'planText' in result) {
      return { planText: result.planText };
    }
  }

  if (!requiresPlanText) {
    console.log(`📋 [Plan] Task "${nextTask.name}" (${nextTask.type}): tool loop did not produce plan, proceeding with empty planText`);
    return { planText: '' };
  }

  const planText = await generatePlanText(
    llm!,
    nextTask,
    state,
    rag.codeContext,
    state.violations,
    uiDocForPlan,
    remainingTasks,
  );
  return { planText: planText ?? '' };
}

export async function plan(state: ArchitectGraphState): Promise<ArchitectGraphState> {
  state.recursionCount = (state.recursionCount || 0) + 1;

  // Verification scenario harness — no-op in production.
  const { traceNodeEntry } = await import('../../../../../../utils/verificationTrace');
  traceNodeEntry('plan', state.currentTask ?? undefined);

  // STEP 0 — entry classification.
  const { context: entry, delta: entryDelta } = await resolvePlanEntry(state);
  const { nextTask, isRetry, skipKeywordAndRAG } = entry;

  await workflowEnter(state, nextTask);

  // STEP 0.5 — resume interrupted task.
  const resumed = await maybeResumeInterrupted(state, entry, workflowExit);
  if (resumed) return mergeDelta(resumed, entryDelta) as ArchitectGraphState;

  // STEP 0.6 — pre-planned error / test-code fast path.
  const prePlanned = await maybePrePlannedFastPath(state, entry, workflowExit);
  if (prePlanned) return mergeDelta(prePlanned, entryDelta) as ArchitectGraphState;

  // STEP 0.7 — retry diagnostic log. Verify-mode tasks (verification +
  // Tier 2 self-verify) re-run gates via the tool loop on retry; all
  // other retry tasks fall through normally. The log surface stays
  // task-blind by reading the same `requiresPlanText` flag the
  // dispatcher uses — `false` ⇔ verification + doc + explain, of
  // which only verification ever reaches retry under the current
  // pipelines. R1 — no `task.type === 'verification'` literal here.
  if (isRetry) {
    const planHook = hooksForTaskType(nextTask.type)?.plan;
    const isVerifyMode = (planHook?.requiresPlanText ?? true) === false
      && (planHook?.usesToolLoop ?? true) === true;
    if (isVerifyMode) {
      console.log(`\n🔄 [Plan] Verify-mode retry — will re-run gates via tool loop for fresh error analysis`);
      console.log(`   Violations from previous attempt: ${state.violations?.length || 0}`);
    }
  }

  // STEP 0.9 — plan↔tool loop re-entry.
  const toolLoop = await runPlanToolLoopPhase(state, nextTask);
  if (toolLoop.kind === 'return') return mergeDelta(toolLoop.state, entryDelta) as ArchitectGraphState;

  // Setup fast path — skip RAG entirely.
  const setupFast = await maybeSetupFastPath(state, entry, workflowExit);
  if (setupFast) return mergeDelta(setupFast, entryDelta) as ArchitectGraphState;

  // STEP 0.8 ~ STEP 2.5 — RAG.
  const rag = await runPlanRAG(state, { nextTask, isRetry, skipKeywordAndRAG });

  // STEP 3 ~ STEP 4 — plan LLM call + finalize, wrapped in an inline
  // retry loop for `BatchSplitSchemaViolation`. Mirrors
  // `nodes/decompose/index.ts:548-826` SSOT — when the LLM emits an
  // `<plan>` body whose entries are missing the LLM-authored semantic
  // fields the framework uses verbatim as child task names/descriptions,
  // we re-issue the call with violation framing rather than fabricating
  // names. The framing is carried via `state._batchSplitViolationFraming`
  // and read by `buildPlanPrompt`.
  let attempt = 0;
  // Carries the latest LLM-emitted planText across attempts so the
  // graceful-skip branch (retry exhausted) can hand the parent its own
  // most recent plan to execute. Without this, the fallback would feed
  // an empty preSplitPlanText to `finalizePlanOutcome` and the parent
  // would lose its own work.
  let lastPlanTextRaw = '';
  while (true) {
    attempt++;
    try {
      const llmOutcome = await runMainPlanLLM(state, entry, rag);
      if ('_activePhase' in llmOutcome) {
        // Tool-loop entry — clear framing so it doesn't leak into the
        // tool-loop's prompt. (toolLoop.ts has its own graceful skip on
        // violation; retry of a tool-loop is too expensive.)
        state._batchSplitViolationFraming = undefined;
        return mergeDelta(llmOutcome, entryDelta) as ArchitectGraphState;
      }
      const planTextRaw = llmOutcome.planText;
      lastPlanTextRaw = planTextRaw;

      if (state.violations && state.violations.length > 0) {
        console.log(`📋 [Plan] Passing ${state.violations.length} violation(s) to CodeGen for prompt injection`);
      }

      const planNeedsText = (hooksForTaskType(nextTask.type)?.plan?.requiresPlanText ?? true);
      const stepFourOrigin: 'verification-short-circuit' | undefined =
        planTextRaw === '' && !planNeedsText ? 'verification-short-circuit' : undefined;

      // STEP 3.5 ~ STEP 4 — single SSOT for batchSplit + emptyImpl shortcut +
      // tracePlanFinalize + state shape. Throws `BatchSplitSchemaViolation`
      // when the LLM-authored semantic fields are missing.
      const updatedState = finalizePlanOutcome(state, nextTask, {
        preSplitPlanText: planTextRaw,
        callSite: 'plan-index',
        lessons: rag.lessons,
        planEmptyOrigin: stepFourOrigin,
      });

      // Success — clear framing so it doesn't leak into a future plan call.
      state._batchSplitViolationFraming = undefined;
      await workflowExit(state);
      return mergeDelta(updatedState, entryDelta) as ArchitectGraphState;
    } catch (e) {
      if (!(e instanceof BatchSplitSchemaViolation)) throw e;

      if (attempt >= PLAN_SCHEMA_VIOLATION_MAX_ATTEMPTS) {
        // Retry exhausted — graceful fallback. The most recent attempt's
        // planText still gets executed (parent runs its own plan as a
        // single task); only the fan-out is bypassed. The system MUST
        // NOT fabricate placeholder names. Operators should treat any
        // hit on this branch as a regression signal for prompt drift.
        console.error(
          `❌ [Plan] BatchSplitSchemaViolation exhausted ${PLAN_SCHEMA_VIOLATION_MAX_ATTEMPTS} attempts: ` +
          `${e.detail.entryKind}[${e.detail.ordinal}] missing '${e.detail.missingField}' — ` +
          `proceeding without fan-out (parent will execute its own plan).`,
        );
        // Clear framing — this attempt's framing has fired its budget.
        state._batchSplitViolationFraming = undefined;
        // Hand the parent its most recent planText so it can execute its
        // own plan (single task, no fan-out). The schema violation only
        // blocks fan-out — the body of the plan (modify/create/delete
        // entries) is still actionable for a single-task execution.
        const updatedState = finalizePlanOutcome(state, nextTask, {
          preSplitPlanText: lastPlanTextRaw,
          callSite: 'plan-index',
          lessons: rag.lessons,
          planEmptyOrigin: undefined,
          skipBatchSplit: true,
        });
        await workflowExit(state);
        return mergeDelta(updatedState, entryDelta) as ArchitectGraphState;
      }

      console.warn(
        `⚠️  [Plan] BatchSplitSchemaViolation attempt ${attempt}/${PLAN_SCHEMA_VIOLATION_MAX_ATTEMPTS}: ` +
        `${e.detail.entryKind}[${e.detail.ordinal}] missing '${e.detail.missingField}' — retrying with framing`,
      );
      state._batchSplitViolationFraming = buildBatchSplitSchemaViolationFraming(e);
    }
  }
}
