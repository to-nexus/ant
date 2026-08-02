import type { ChatStatusLine, ChatStatusType } from '@ant/shared';
import { isPreviewSurfaceArtifactPath } from '@/domain/store/editor/virtualTabModel';

const PREVIEW_ONLY_JOB_TYPES = new Set(['plan', 'design']);

/**
 * File statuses the main-panel preview surface can own — but only for an
 * artifact it actually renders. `isPreviewSurfaceArtifactPath` is the single
 * owner of that call; a tokens/spec JSON or a handoff stylesheet never reaches
 * the preview, so its card stays in chat exactly as in the code job.
 *
 * Deliberately SUCCESS/PROGRESS only, and deliberately create/edit only. The
 * `*_failed` and `file_delete*` statuses stay in chat because the preview has
 * no renderer for them — promotion into an editor tab fires on `file_create` /
 * `file_edit` alone. Suppressing them made the write invisible on every
 * surface: the tab simply vanished.
 * Boundary: preview owns the create/edit success path, chat owns the rest.
 */
const PREVIEW_ONLY_FILE_STATUS_TYPES = new Set<ChatStatusType>([
  'file_creating',
  'file_writing',
  'file_create',
  'file_editing',
  'file_updating',
  'file_edit',
]);

/** Path-less statuses the preview surface owns outright for plan/design. */
const PREVIEW_ONLY_STATUS_TYPES = new Set<ChatStatusType>([
  'plan_generating',
  'plan',
  'task_response_streaming',
  'task_response',
]);

export function shouldSuppressPreviewOnlyStatusCard(line: ChatStatusLine): boolean {
  if (!PREVIEW_ONLY_JOB_TYPES.has(line.jobType)) return false;
  if (PREVIEW_ONLY_STATUS_TYPES.has(line.statusType)) return true;
  if (!PREVIEW_ONLY_FILE_STATUS_TYPES.has(line.statusType)) return false;

  const filePath = line.metadata?.filePath;
  return isPreviewSurfaceArtifactPath(
    typeof filePath === 'string' ? filePath : undefined,
  );
}
