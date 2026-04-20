/**
 * verification/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * Supplies the conversation key used to scope the verification task's
 * assistant/tool history. Replaces the verification arm of the 7-way
 * if/else chain in `nodes/decompose/sessionManager.ts` L111~137 once T6
 * flips the delegation.
 *
 * The key embeds the task id so parallel verification sub-tasks (post
 * batch-split) each get their own conversation thread.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:verification:${task.id}`;
}
