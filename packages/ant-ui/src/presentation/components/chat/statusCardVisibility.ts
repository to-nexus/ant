import type { ChatStatusLine, ChatStatusType } from '@ant/shared';

const PREVIEW_ONLY_JOB_TYPES = new Set(['plan', 'design']);
const PREVIEW_ONLY_STATUS_TYPES = new Set<ChatStatusType>([
  'file_creating',
  'file_writing',
  'file_create',
  'file_create_failed',
  'file_editing',
  'file_updating',
  'file_edit',
  'file_edit_failed',
  'file_deleting',
  'file_delete',
  'file_delete_failed',
  'plan_generating',
  'plan',
  'task_response_streaming',
  'task_response',
]);

export function shouldSuppressPreviewOnlyStatusCard(line: ChatStatusLine): boolean {
  return PREVIEW_ONLY_JOB_TYPES.has(line.jobType) && PREVIEW_ONLY_STATUS_TYPES.has(line.statusType);
}
