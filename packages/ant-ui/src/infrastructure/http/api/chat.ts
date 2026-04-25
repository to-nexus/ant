import { API_BASE, apiPost, apiDelete } from './client';
import type { ActionMetadata } from '@ant/shared';

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
): Promise<AddChatUserMessageResult> {
  const body: Record<string, unknown> = { content };
  if (actionMetadata && Object.keys(actionMetadata).length > 0) {
    body.actionMetadata = actionMetadata;
  }
  const data = await apiPost<{ turnId: string; messageId: string }>(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/user-message`,
    body,
  );
  return { turnId: data.turnId, messageId: data.messageId };
}

/**
 * Clear chat history for a feature.
 *
 * Session redesign §16.2: the backend collapses `chat.jsonl` only (the UI
 * chat SSOT). `feature.jsonl` (LLM prompt context) is intentionally
 * preserved so conversation continuity is maintained. A `messages_cleared`
 * SSE event with `scope: 'chat'` is broadcast so the UI drops chat messages
 * and the local trace cache, while keeping breadcrumbs / tier badges intact.
 * Use Hard Reset (`POST .../context/reset`) when full context wipe is
 * required.
 */
export async function clearChatHistory(
  projectId: string,
  featureName: string,
): Promise<void> {
  await apiDelete(
    `${API_BASE()}/projects/${projectId}/features/${featureName}/chat/messages`,
  );
}
