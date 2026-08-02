import type { ChatStatusLine, ChatStatusType } from '@ant/shared';

const PREVIEW_ONLY_JOB_TYPES = new Set(['plan', 'design']);

/**
 * Statuses the main-panel preview surface owns for plan/design, so the chat
 * card would be a duplicate.
 *
 * Deliberately SUCCESS/PROGRESS only. The `*_failed` statuses stay in chat
 * because the preview has no failure renderer — promotion into an editor tab
 * fires on `file_create` / `file_edit` alone. Suppressing them here made a
 * failed artifact write invisible on every surface: the tab simply vanished.
 * Boundary: preview owns the success path, chat owns the failure path.
 */
const PREVIEW_ONLY_STATUS_TYPES = new Set<ChatStatusType>([
  'file_creating',
  'file_writing',
  'file_create',
  'file_editing',
  'file_updating',
  'file_edit',
  'file_deleting',
  'file_delete',
  'plan_generating',
  'plan',
  'task_response_streaming',
  'task_response',
]);

export function shouldSuppressPreviewOnlyStatusCard(line: ChatStatusLine): boolean {
  return PREVIEW_ONLY_JOB_TYPES.has(line.jobType) && PREVIEW_ONLY_STATUS_TYPES.has(line.statusType);
}
