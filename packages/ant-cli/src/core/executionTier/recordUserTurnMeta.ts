/**
 * Shared helper — append a `user_turn_meta` patch line recording the
 * execution tier decision for the current user turn.
 *
 * Called from triage and from every job's Decompose / Detect entry. The
 * call is side-effect only: missing `session` / `turnId` / `jobId`
 * silently skip, and write failures are logged and swallowed so a
 * broken session log never interrupts a job.
 *
 * Idempotency: if Decompose re-runs (e.g. after `proceed_without_spec`),
 * a fresh meta line is appended. The reader merges by `turnId` and
 * keeps the latest.
 */

import type { SessionPort } from '../ports/session';
import type { ExecutionTierId, IntentId, JobType, Mode, Domain } from '@ant/shared';

export interface RecordUserTurnMetaInput {
  session: SessionPort | undefined;
  turnId: string | undefined;
  jobId: string | undefined;
  jobType: JobType;
  /**
   * 5-tier execution strategy decided by Decompose / Detect. Optional —
   * Triage emits its meta patch BEFORE Decompose runs (only `actionMetadata`
   * is known at Triage time); reader merges later when Decompose's patch
   * arrives on the same turnId.
   */
  executionTier?: ExecutionTierId;
  /**
   * Triage 출력 메타 (intent/mode/domain). 다음 turn 의 hydrate 가
   * `featureContext.userTurns[-1].actionMetadata.intent` 로 직전 intent
   * 를 보고 후속 발화 추론에 사용.
   */
  actionMetadata?: {
    intent?: IntentId;
    mode?: Mode;
    domain?: Domain;
  };
  /** Node label used in the error log on write failure. */
  nodeLabel: string;
}

export async function recordUserTurnMeta(input: RecordUserTurnMetaInput): Promise<void> {
  const { session, turnId, jobId, jobType, executionTier, actionMetadata, nodeLabel } = input;
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
  if (executionTier === undefined && !actionMetadata) {
    // Refuse no-op patches — keeps the jsonl free of empty lines.
    console.warn(`⚠️  [${nodeLabel}] recordUserTurnMeta skipped: nothing to patch`);
    return;
  }
  try {
    await session.appendUserTurnMeta({
      type: 'user_turn_meta',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType,
      ...(executionTier !== undefined ? { executionTier } : {}),
      ...(actionMetadata ? { actionMetadata } : {}),
    });
  } catch (err) {
    console.warn(`⚠️  [${nodeLabel}] appendUserTurnMeta failed:`, err);
  }
}
