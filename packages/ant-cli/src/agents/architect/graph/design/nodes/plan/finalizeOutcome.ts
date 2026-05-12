/**
 * Lean state-shape finalizer for the design plan node.
 *
 * Mirrors `code/nodes/plan/outcome/finalize.ts` but without batch-split
 * fan-out (design has 1 doc per task — no `batches[]` mechanism) and
 * without verification short-circuit (design tasks always go to
 * docGen). Concerns owned here:
 *
 *   - Persist `state.planText` for docGen consumption.
 *   - Clear `_activePhase` (loop is done — graph routes to docGen on
 *     return).
 *   - Clear NODE_PLAN history (next task starts a fresh plan loop).
 *   - Clear stale `fileErrors` from any prior docGen attempt.
 *   - Save the planText to the per-job debug log so it is inspectable.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { CONV_KEYS } from '../../../../../common/graph/conversations';
import { getSessionDebugDir } from '../../../../../../core/utils/sessionPaths';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';

export interface FinalizeOutcomeInput {
  planText: string;
}

export async function finalizePlanOutcome(
  state: DesignGraphState,
  task: DesignTask,
  input: FinalizeOutcomeInput,
): Promise<Partial<DesignGraphState>> {
  const { planText } = input;

  const summary = summarizePlan(planText);
  console.log(`✅ [DesignPlan] Plan sealed (${planText.length} chars)`);
  console.log(`   Task: ${task.name}`);
  if (summary.parsed) {
    console.log(
      `   Plan summary: candidates=${summary.candidatesCount}, ` +
      `selected="${summary.decisionSelected ?? 'n/a'}", ` +
      `outlineSections=${summary.outlineSectionCount}`,
    );
  }

  await savePlanForDebug(state, task, planText);
  await logPlanSealedEvent(state, task, planText, summary);

  return {
    currentTask: task,
    planText,
    _activePhase: undefined,
    conversations: { [CONV_KEYS.NODE_PLAN]: [] },
    fileErrors: undefined,
    recursionCount: state.recursionCount,
    recursionLimit: state.recursionLimit,
  };
}

interface PlanSummary {
  parsed: boolean;
  candidatesCount: number;
  decisionSelected?: string;
  outlineSectionCount: number;
}

/**
 * Best-effort parse of the sealed `<plan>` JSON to extract the
 * top-level structural counts that operators care about when
 * eyeballing a job trace (did the LLM enumerate ≥2 candidates? what
 * decision did it pick? how many sections will docGen write?). Never
 * throws — invalid JSON or missing fields collapse to `parsed=false`
 * with zeroed counts so the caller can log conditionally.
 */
function summarizePlan(planText: string): PlanSummary {
  try {
    const json = JSON.parse(planText) as any;
    const candidates = Array.isArray(json?.candidateSolutions) ? json.candidateSolutions : [];
    const outline = Array.isArray(json?.documentOutline) ? json.documentOutline : [];
    const decision: unknown = json?.decision?.selected;
    return {
      parsed: true,
      candidatesCount: candidates.length,
      decisionSelected: typeof decision === 'string' ? decision : undefined,
      outlineSectionCount: outline.length,
    };
  } catch {
    return { parsed: false, candidatesCount: 0, outlineSectionCount: 0 };
  }
}

/**
 * Emit a `phase_complete` event so `log-{jobId}.json` carries a
 * structured trace of plan→docGen handoff. The shape mirrors what
 * docGen later consumes (sealed planText length + parsed counts) so a
 * post-hoc operator can confirm the contract without replaying the
 * whole conversation.
 *
 * Non-blocking: any logger failure swallowed by `getExecutionLogger`.
 */
async function logPlanSealedEvent(
  state: DesignGraphState,
  task: DesignTask,
  planText: string,
  summary: PlanSummary,
): Promise<void> {
  const featurePath = state.context?.featurePath;
  const jobId = state._httpJobId;
  if (!featurePath || !jobId) return;

  const startedAt = task.timing?.startedAt;
  const elapsedMs = startedAt ? Date.now() - new Date(startedAt).getTime() : 0;

  void getExecutionLogger({ featurePath, jobId, jobType: 'design' })
    .logPhaseComplete({
      phase: 'design-plan-sealed',
      elapsedMs,
      details: {
        taskId: task.id,
        taskName: task.name,
        taskType: task.type,
        intentGroup: state.resolvedAction?.intentGroup,
        planTextLen: planText.length,
        planParsed: summary.parsed,
        candidatesCount: summary.candidatesCount,
        decisionSelected: summary.decisionSelected,
        outlineSectionCount: summary.outlineSectionCount,
        recursionCount: state.recursionCount,
      },
    })
    .catch(() => { /* non-blocking */ });
}

/**
 * Append the sealed plan to a per-job JSON debug file. Non-blocking —
 * any I/O failure is swallowed so plan generation never fails because
 * of debug persistence. Mirrors code's `savePlanTextForDebug`.
 */
async function savePlanForDebug(
  state: DesignGraphState,
  task: DesignTask,
  planText: string,
): Promise<void> {
  try {
    const featurePath = state.context?.featurePath;
    const jobId = state._httpJobId;
    if (!featurePath || !jobId) return;

    const planTextDir = getSessionDebugDir(featurePath, 'architect', 'plans');
    await fs.mkdir(planTextDir, { recursive: true });

    const filepath = path.join(planTextDir, `plan-${jobId}.json`);

    let plansArray: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      plansArray = JSON.parse(existing);
    } catch {
      // Fresh file
    }

    let planJson: any;
    try {
      planJson = JSON.parse(planText);
    } catch {
      planJson = { raw: planText };
    }

    plansArray.push({
      taskId: task.id,
      taskName: task.name,
      taskType: task.type,
      priority: task.priority,
      generated: new Date().toISOString(),
      plan: planJson,
    });

    await fs.writeFile(filepath, JSON.stringify(plansArray, null, 2), 'utf-8');
  } catch {
    // Non-blocking
  }
}
