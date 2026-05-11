/**
 * Analysis-brief persistence helper — debug-only.
 *
 * Saves the Tier 3 cross-task `<analysis>` brief for a job into
 * `{featurePath}/sessions/architect/debug/analysis/analysis-{jobId}.json`.
 * One file per decompose invocation; re-decompose on resume overwrites
 * with the latest authoritative result (`state.analysis`).
 *
 * Non-blocking — any I/O failure is swallowed so decompose never fails
 * because of debug persistence (same policy as `savePlanText`).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ArchitectGraphState } from '../../state';
import { getSessionDebugDir } from '../../../../../../core/utils/sessionPaths';

/**
 * Persist the final Tier 3 analysis brief for post-hoc verification.
 *
 * @param state - Architect graph state (provides featurePath + jobId)
 * @param executionTier - Resolved execution tier (always 3 — caller gates)
 * @param analysis - Parsed `<analysis>` body from the LLM, or `undefined`
 *   when emission was missing after `MAX_ATTEMPTS` retries
 * @param attempts - Final value of the decompose retry-loop counter
 *   (number of LLM round-trips performed)
 */
export async function saveAnalysisForDebug(
  state: ArchitectGraphState,
  executionTier: number,
  analysis: string | undefined,
  attempts: number
): Promise<void> {
  try {
    const featurePath = state.context.featurePath;
    const jobId = state._httpJobId;

    if (!featurePath || !jobId) {
      return;
    }

    const analysisDir = getSessionDebugDir(featurePath, 'architect', 'analysis');
    await fs.mkdir(analysisDir, { recursive: true });

    const filepath = path.join(analysisDir, `analysis-${jobId}.json`);

    const body = (analysis ?? '').trim();
    const payload = {
      jobId,
      executionTier,
      generated: new Date().toISOString(),
      analysisPresent: body.length > 0,
      attempts,
      analysis: body,
    };

    await fs.writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch {
    // Non-blocking — debug persistence must never fail decompose.
  }
}
