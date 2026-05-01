/**
 * Plan-text persistence helper — debug-only.
 *
 * Saves the generated `<plan>` JSON for a given task into
 * `{featurePath}/sessions/architect/debug/plans/plan-{jobId}.json`.
 * All task plans for a job are accumulated into one JSON array file so
 * the full plan history of a job is inspectable side-by-side.
 *
 * Non-blocking — any I/O failure is swallowed so plan generation never
 * fails because of debug persistence.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ArchitectGraphState } from '../../../state';
import { CodeTask } from '../../../../../types/task';
import { getSessionDebugDir } from '../../../../../../../core/utils/sessionPaths';

export async function savePlanTextForDebug(
  state: ArchitectGraphState,
  task: CodeTask,
  planText: string
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;

    if (!featurePath || !jobId) {
      return;
    }

    const planTextDir = getSessionDebugDir(featurePath, 'architect', 'plans');
    await fs.mkdir(planTextDir, { recursive: true });

    const filepath = path.join(planTextDir, `plan-${jobId}.json`);

    let plansArray: any[] = [];
    try {
      const existing = await fs.readFile(filepath, 'utf-8');
      plansArray = JSON.parse(existing);
    } catch {
      // File doesn't exist, start fresh
    }

    const retryCount = state.retries || 0;

    let planJson: any;
    try {
      planJson = JSON.parse(planText);
    } catch {
      planJson = { raw: planText };
    }

    const entry = {
      taskId: task.id,
      taskName: task.name,
      taskType: task.type,
      priority: task.priority,
      retry: retryCount,
      generated: new Date().toISOString(),
      plan: planJson
    };

    plansArray.push(entry);

    await fs.writeFile(filepath, JSON.stringify(plansArray, null, 2), 'utf-8');
  } catch (err) {
    // Non-blocking - plan save failed
  }
}
