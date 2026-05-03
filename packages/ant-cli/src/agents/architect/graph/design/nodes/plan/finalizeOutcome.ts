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
import type { DesignGraphState } from '../../state';
import type { DesignTask } from '../../../../types/task';

export interface FinalizeOutcomeInput {
  planText: string;
  origin: 'tool-loop' | 'over-limit';
}

export async function finalizePlanOutcome(
  state: DesignGraphState,
  task: DesignTask,
  input: FinalizeOutcomeInput,
): Promise<Partial<DesignGraphState>> {
  const { planText, origin } = input;

  console.log(`✅ [DesignPlan] Plan sealed (${planText.length} chars, origin=${origin})`);
  console.log(`   Task: ${task.name}`);

  await savePlanForDebug(state, task, planText, origin);

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

/**
 * Append the sealed plan to a per-job JSON debug file. Non-blocking —
 * any I/O failure is swallowed so plan generation never fails because
 * of debug persistence. Mirrors code's `savePlanTextForDebug`.
 */
async function savePlanForDebug(
  state: DesignGraphState,
  task: DesignTask,
  planText: string,
  origin: 'tool-loop' | 'over-limit',
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
      origin,
      generated: new Date().toISOString(),
      plan: planJson,
    });

    await fs.writeFile(filepath, JSON.stringify(plansArray, null, 2), 'utf-8');
  } catch {
    // Non-blocking
  }
}
