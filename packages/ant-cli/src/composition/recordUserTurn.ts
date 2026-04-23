/**
 * recordUserTurn — Single Source of Truth for user_turn recording
 *
 * §4.5 of the session redesign: user_turn recording is the orchestrator's
 * responsibility. Called once per job invocation BEFORE LangGraph runs (or
 * before the ask runner starts).
 *
 * Jobtype-aware:
 * - code/design/plan → writes to both feature.jsonl and chat.jsonl
 * - ask/inline-ask → writes to chat.jsonl only (sourceRef='ask-only')
 * - learn → no user_turn (no user directive)
 *
 * Resume safety: if state.isResume === true, skip (no duplicate record).
 */

import * as crypto from "crypto";
import type { LogJobType, FeatureUserTurnLine, Mode } from "@ant/shared";
import { FileSessionAdapter } from "../periphery/adapters/session/FileSessionAdapter";

export interface RecordUserTurnParams {
  featurePath: string;
  jobType: LogJobType;
  jobId: string;
  directive: string;
  /** Mode (already known from Detect or explicit argument). Undefined for ask. */
  mode?: Mode;
  /** If true, skip recording entirely (used when resuming an interrupted job). */
  isResume?: boolean;
  /** Optional pre-generated turnId (for deterministic testing). Auto-generated otherwise. */
  turnId?: string;
  /** Optional: reuse an existing FileSessionAdapter instance. */
  session?: FileSessionAdapter;
  /** If session not provided, these are used to construct one. */
  agent?: string;
  projectId?: string;
  featureName?: string;
  /** Structured context from the Actions panel. Persisted to chat.jsonl so mention badges survive page refresh. */
  actionMetadata?: import('@ant/shared').ActionMetadata;
}

/**
 * Record a user_turn line to feature.jsonl and/or chat.jsonl.
 *
 * @returns the generated turnId (useful for subsequent meta patches)
 */
export async function recordUserTurn(params: RecordUserTurnParams): Promise<string> {
  const {
    featurePath,
    jobType,
    jobId,
    directive,
    mode,
    isResume,
    turnId: providedTurnId,
    agent = "architect",
    projectId,
    featureName,
    actionMetadata,
  } = params;

  const session = params.session
    ?? new FileSessionAdapter(featurePath, agent, projectId, featureName);

  if (isResume) {
    // Resume = no new user turn. We MUST reuse the existing turnId already in
    // feature.jsonl so subsequent trace lines group under the original user
    // request. Priority order:
    //   1. explicit providedTurnId (caller already knows the id)
    //   2. the last non-collapsed user_turn whose jobId matches (exact match)
    //   3. the most recent non-collapsed user_turn in feature.jsonl (fallback)
    //   4. generate a fresh id (degenerate — feature.jsonl had nothing)
    //
    // Without this lookup the helper used to propagate a freshly generated
    // random id, which silently unlinks all resumed-turn trace events from
    // their originating user_turn in feature.jsonl.
    const resumedTurnId = providedTurnId
      ?? (await resolveResumeTurnId(session, jobId))
      ?? generateTurnId();
    await propagateTurnIdToLLMResponseService(resumedTurnId);
    return resumedTurnId;
  }

  const turnId = providedTurnId || generateTurnId();

  const skipFeature = jobType === "ask" || jobType === "inline-ask";

  const line: FeatureUserTurnLine = {
    type: "user_turn",
    ts: new Date().toISOString(),
    jobId,
    turnId,
    jobType,
    text: directive,
    mode,
  };

  await session.appendUserTurn(line, { skipFeature, actionMetadata });

  // Let the worker's LLMResponseService know which turnId to tag emitted
  // chat.jsonl lines with. Fire-and-forget; failures are logged and ignored.
  await propagateTurnIdToLLMResponseService(turnId);

  return turnId;
}

/**
 * Look up the turnId of the user_turn that triggered the job currently
 * being resumed. Reads feature.jsonl via `loadSinceBoundary` and prefers an
 * exact jobId match; falls back to the most recent user_turn so we still
 * attribute trace lines correctly even when jobId drift has occurred (e.g.
 * a new BullMQ job id on resume). Returns `null` when feature.jsonl has no
 * usable user_turn entry.
 */
async function resolveResumeTurnId(
  session: FileSessionAdapter,
  jobId: string,
): Promise<string | null> {
  try {
    const { userTurns } = await session.loadSinceBoundary();
    if (userTurns.length === 0) return null;
    for (let i = userTurns.length - 1; i >= 0; i--) {
      if (userTurns[i].jobId === jobId) return userTurns[i].turnId;
    }
    return userTurns[userTurns.length - 1].turnId;
  } catch (err) {
    console.warn('[recordUserTurn] Failed to resolve resume turnId:', err);
    return null;
  }
}

/**
 * Bridge orchestrator-side turnId into the worker's LLMResponseService
 * (which owns the chat.jsonl appender singleton). Best-effort — any error
 * here must not abort user_turn recording, which has already succeeded.
 */
async function propagateTurnIdToLLMResponseService(turnId: string): Promise<void> {
  try {
    const { getLLMResponseServiceOrNull } = await import('../core/adapters/ChatAPIClient');
    const service = await getLLMResponseServiceOrNull();
    if (service && typeof service.setTurnId === 'function') {
      service.setTurnId(turnId);
    }
  } catch (err) {
    console.warn('[recordUserTurn] Failed to propagate turnId to LLMResponseService:', err);
  }
}

/**
 * Generate a short, readable turn ID.
 * Format: `t-<random 8 hex>` for easy grepping and UI display.
 */
export function generateTurnId(): string {
  return `t-${crypto.randomBytes(4).toString("hex")}`;
}
