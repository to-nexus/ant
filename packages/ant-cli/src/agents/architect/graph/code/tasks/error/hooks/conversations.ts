/**
 * error/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * Replaces the error arm of the 7-way if/else in
 * `nodes/decompose/sessionManager.ts` once T6 flips delegation. The key
 * embeds the task id so multiple parallel error tasks (post decomposition)
 * each get an independent conversation thread.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:error:${task.id}`;
}
