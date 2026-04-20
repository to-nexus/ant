/**
 * ui/hooks/conversations.ts — TaskConversationsHook.convKey
 *
 * Per-task conversation scope for ui tasks. Pre-wired for the future
 * phase-layer switch from the single shared `CONV_KEYS.NODE_EXECUTE` key
 * to per-task-type conversation threads (see handoff §11.1 entry for
 * `hooks.conversations.convKey(task)`). Until that flip lands in T6+,
 * phase nodes (`execute/index.ts`, `plan/index.ts`, `tool/index.ts`)
 * continue to read/write via `CONV_KEYS.NODE_EXECUTE` and this hook has
 * no runtime consumer — it stays here as the landing spot so the later
 * flip is a one-line call-site change.
 *
 * NOTE — contrary to the original handoff table, `decompose/sessionManager.ts`
 * L111~137 is a task-type bucket counter for progress display
 * (`classifyTask`), not a convKey switch. No conv-key 7-way if/else
 * exists in the codebase today; this hook is the SSOT for when one is
 * introduced.
 */

import type { CodeTask } from '../../../../../types/task';

export function convKey(task: CodeTask): string {
  return `node:execute:ui:${task.id}`;
}
