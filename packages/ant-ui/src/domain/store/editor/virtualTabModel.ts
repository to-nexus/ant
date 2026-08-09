import type { PendingCardSnapshot } from '@ant/shared';

const FILE_STREAMING_STATUS_TYPES = new Set([
  'file_creating',
  'file_writing',
  'file_editing',
  'file_updating',
]);

export interface TurnInfo {
  jobType?: string;
  jobId?: string;
}

export function buildTurnInfoMap(
  chatEvents: Array<{ turnId?: string; jobType?: string; jobId?: string }>,
): Map<string, TurnInfo> {
  const turnInfo = new Map<string, TurnInfo>();
  for (const line of chatEvents) {
    if (!line?.turnId || turnInfo.has(line.turnId)) continue;
    turnInfo.set(line.turnId, { jobType: line.jobType, jobId: line.jobId });
  }
  return turnInfo;
}

/**
 * Single owner of "which job types get a streaming virtual editor tab".
 * `chatSseHandler` (terminal promotion) and `statusCardVisibility` (the
 * inverse — chat-side card suppression) MUST consume this set; a local copy
 * is exactly the drift that muted the universal job.
 */
export const VIRTUAL_TAB_JOB_TYPES = new Set(['plan', 'design', 'universal'] as const);

export type VirtualTabSource = 'plan' | 'design' | 'universal';

function asVirtualTabSource(jobType?: string): VirtualTabSource | undefined {
  return jobType && (VIRTUAL_TAB_JOB_TYPES as Set<string>).has(jobType)
    ? (jobType as VirtualTabSource)
    : undefined;
}

export function resolveVirtualTabSource(args: {
  turnInfo: Map<string, TurnInfo>;
  turnId: string;
  selectedJobType?: string;
}): VirtualTabSource | undefined {
  const { turnInfo, turnId, selectedJobType } = args;
  return (
    asVirtualTabSource(turnInfo.get(turnId)?.jobType) ??
    asVirtualTabSource(selectedJobType)
  );
}

export function getPendingCardFilePath(card: PendingCardSnapshot): string | undefined {
  const raw = card.metadata?.filePath;
  if (typeof raw !== 'string') return undefined;
  return raw.trim().length > 0 ? raw : undefined;
}

export function isFileStreamingPendingCard(card: PendingCardSnapshot): boolean {
  return FILE_STREAMING_STATUS_TYPES.has(card.statusType);
}

/**
 * Single owner of "does the preview surface render this artifact?".
 *
 * The preview surface exists for documents a human reads. `VirtualDocumentViewer`
 * markdown-renders `.md`; everything else lands in a monospace `<pre>`, so a
 * tokens/spec JSON or a handoff stylesheet would take over the main panel to
 * scroll a blob nobody watches. Those belong in a chat file card — the code-job
 * behaviour. A path-less file op is never preview-worthy either: no path means
 * no tab can be minted, and suppressing its card would hide it on every surface.
 *
 * Consumed by `shouldRenderVirtualPreviewCard` (tab minting), `chatSseHandler`
 * (terminal promotion) and `statusCardVisibility` (chat suppression) — the three
 * sites must agree, so the rule lives here once.
 */
const PREVIEW_SURFACE_EXTENSIONS = /\.(md|markdown|html|htm)$/i;

export function isPreviewSurfaceArtifactPath(path?: string): path is string {
  return !!path && PREVIEW_SURFACE_EXTENSIONS.test(path.trim());
}

export function shouldRenderVirtualPreviewCard(card: PendingCardSnapshot): boolean {
  return (
    isFileStreamingPendingCard(card) &&
    isPreviewSurfaceArtifactPath(getPendingCardFilePath(card))
  );
}
