import { API_BASE, apiPost, apiDelete } from './client';

/**
 * Add a user message to the chat history.
 * Persists the message to chat.json and broadcasts via SSE.
 * Must be called BEFORE executeCodeJob().
 */
export async function addChatUserMessage(
  projectId: string,
  featureName: string,
  content: string,
): Promise<string> {
  const data = await apiPost<{ messageId: string }>(
    `${API_BASE()}/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureName)}/chat/user-message`,
    { content },
  );
  return data.messageId;
}

/**
 * Clear chat history for a feature (chat.json only)
 */
export async function clearChatHistory(
  projectId: string,
  featureName: string,
): Promise<void> {
  await apiDelete(
    `${API_BASE()}/projects/${projectId}/features/${featureName}/chat/messages`,
  );
}
