/**
 * test-code/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * Replaces the test-code arm of the 7-way if/else in
 * `nodes/decompose/sessionManager.ts` once T6 flips delegation.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:test-code:${task.id}`;
}
