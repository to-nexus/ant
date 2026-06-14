/**
 * seam/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * The key embeds the task id so multiple parallel seam tasks (one per
 * ref-emitting module/package) each get an independent conversation thread.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:seam:${task.id}`;
}
