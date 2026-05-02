/**
 * Shared helper — append a `user_turn_meta` patch line recording the
 * execution tier decision for the current user turn.
 *
 * Called from every Tier Entry Node (code/design Decompose, plan/visual
 * Detect) and from fixed-tier paths (design explain / design default
 * fallback). The call is side-effect only: missing `session` / `turnId`
 * / `jobId` silently skip, and write failures are logged and swallowed
 * so a broken session log never interrupts a job.
 *
 * Idempotency: if Decompose re-runs (e.g. after `proceed_without_spec`),
 * a fresh meta line is appended. The reader merges by `turnId` and
 * keeps the latest.
 */

import type { SessionPort } from '../ports/session';
import type { ExecutionTierId, JobType } from '@ant/shared';

export interface RecordUserTurnMetaInput {
  session: SessionPort | undefined;
  turnId: string | undefined;
  jobId: string | undefined;
  jobType: JobType;
  executionTier: ExecutionTierId;
  /** Node label used in the error log on write failure. */
  nodeLabel: string;
}

export async function recordUserTurnMeta(input: RecordUserTurnMetaInput): Promise<void> {
  const { session, turnId, jobId, jobType, executionTier, nodeLabel } = input;
  if (!session || !turnId || !jobId) {
    // Silent skip used to make BC/meta-missing bugs impossible to diagnose
    // (job-context-bridge T1). Surface the exact precondition that failed
    // so the next resolve cycle can attribute the silence correctly.
    console.warn(
      `⚠️  [${nodeLabel}] recordUserTurnMeta skipped: ${
        !session ? 'session port unavailable' :
        !turnId ? 'turnId missing' :
        'jobId missing'
      }`,
    );
    return;
  }
  try {
    await session.appendUserTurnMeta({
      type: 'user_turn_meta',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType,
      executionTier,
    });
  } catch (err) {
    console.warn(`⚠️  [${nodeLabel}] appendUserTurnMeta failed:`, err);
  }
}
