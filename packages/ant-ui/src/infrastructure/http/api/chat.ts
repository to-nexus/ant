import { API_BASE, apiPost, apiDelete, featureSeg } from './client';
import type { ActionMetadata, LogJobType } from '@ant/shared';

/**
 * Add a user message to the chat history.
 *
 * Returns the **turnId** the backend pre-allocated for this user turn.
 * The caller MUST forward the same turnId to `executeJob({ seedTurnId })`
 * so the worker reuses it when writing the durable `user_turn` line in
 * chat.jsonl. The optimistic SSE broadcast and the durable line both
 * carry id = `user-{turnId}`, so the UI never sees a duplicated user
 * message after a tab-switch / reconnect (chat SSOT refactor §6).
 */
export interface AddChatUserMessageResult {
  turnId: string;
  messageId: string;
}

export async function addChatUserMessage(
  projectId: string,
  featureName: string,
  content: string,
  actionMetadata?: ActionMetadata,
  /**
   * jobType this turn belongs to. The submit-time stamp is PERMANENT — the
   * worker's `recordUserTurn` copy dedupes by turnId and never corrects it —
   * so a caller that omits it files the turn under the BE default (`code`)
   * forever. Pass the type the job is actually started with.
   */
  jobType?: LogJobType,
): Promise<AddChatUserMessageResult> {
  const body: Record<string, unknown> = { content };
  if (actionMetadata && Object.keys(actionMetadata).length > 0) {
    body.actionMetadata = actionMetadata;
  }
  if (jobType) body.jobType = jobType;
  const data = await apiPost<{ turnId: string; messageId: string }>(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/chat/user-message`,
    body,
  );
  return { turnId: data.turnId, messageId: data.messageId };
}

/**
 * Clear chat history for a feature.
 *
 * Session redesign §16.2: the backend collapses `chat.jsonl` only (the UI
 * chat SSOT). `feature.jsonl` (LLM prompt context) is intentionally
 * preserved so conversation continuity is maintained. An `events_cleared`
 * SSE event with `scope: 'chat'` is broadcast so the UI drops chat events
 * and the local trace cache, while keeping breadcrumbs / tier badges intact.
 * Use Hard Reset (`POST .../context/reset`) when full context wipe is
 * required.
 *
 * Phase 11 chat-SSOT — when `cancelActive: true` the BE additionally
 * seals any still-running job (user_stopped) before clearing — wired to
 * the F5 / chat-sweep flow that lets the user clear mid-run.
 */
export async function clearChatHistory(
  projectId: string,
  featureName: string,
  options?: { cancelActive?: boolean },
): Promise<void> {
  const qs = options?.cancelActive ? '?cancelActive=true' : '';
  await apiDelete(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${featureSeg(featureName)}/chat/messages${qs}`,
  );
}
