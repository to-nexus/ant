import type { ChatStatusLine, ChatStatusType } from '@ant/shared';
import {
  isPreviewSurfaceArtifactPath,
  VIRTUAL_TAB_JOB_TYPES,
} from '@/domain/store/editor/virtualTabModel';

/**
 * Path-less preview cards (plan / task_response) exist only for jobs whose
 * main panel renders them as a document surface — plan/design. Universal is
 * a VIRTUAL_TAB job (file-op promotion) but has no path-less preview, so its
 * plan/task_response cards must stay in chat.
 */
const PATHLESS_PREVIEW_JOB_TYPES = new Set(['plan', 'design']);

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
  if (PATHLESS_PREVIEW_JOB_TYPES.has(line.jobType) && PREVIEW_ONLY_STATUS_TYPES.has(line.statusType)) {
    return true;
  }
  // File-op suppression must mirror the tab-minting gate exactly
  // (VIRTUAL_TAB_JOB_TYPES is the single owner) — drift double-renders the
  // card in chat AND the editor tab.
  if (!(VIRTUAL_TAB_JOB_TYPES as Set<string>).has(line.jobType)) return false;
  if (!PREVIEW_ONLY_FILE_STATUS_TYPES.has(line.statusType)) return false;

  const filePath = line.metadata?.filePath;
  return isPreviewSurfaceArtifactPath(
    typeof filePath === 'string' ? filePath : undefined,
  );
}
