import { API_BASE, apiPost, apiDelete } from './client';
import type { ActionMetadata } from '@ant/shared';

/**
 * Add a user message to the chat history.
 *
 * Posts to the optimistic-write endpoint so the user's message shows up
 * immediately via the SSE `user_message` broadcast, ahead of the worker's
 * durable `user_turn` record in chat.jsonl (session redesign §16.2).
 * Must be called BEFORE executeCodeJob().
 */
export async function addChatUserMessage(
  projectId: string,
  featureName: string,
  content: string,
  actionMetadata?: ActionMetadata,
): Promise<string> {
  const body: Record<string, unknown> = { content };
  if (actionMetadata && Object.keys(actionMetadata).length > 0) {
    body.actionMetadata = actionMetadata;
  }
  const data = await apiPost<{ messageId: string }>(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/user-message`,
    body,
  );
  return data.messageId;
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
