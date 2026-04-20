/**
 * design-system/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * Replaces the design-system arm of the conversation key mapping in
 * `nodes/decompose/sessionManager.ts` once T6 flips delegation.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:design-system:${task.id}`;
}
