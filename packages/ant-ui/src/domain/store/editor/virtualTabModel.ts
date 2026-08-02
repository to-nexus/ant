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

export function resolveVirtualTabSource(args: {
  turnInfo: Map<string, TurnInfo>;
  turnId: string;
  selectedJobType?: string;
}): 'plan' | 'design' | undefined {
  const { turnInfo, turnId, selectedJobType } = args;
  const fromTurn = turnInfo.get(turnId)?.jobType;
  if (fromTurn === 'plan' || fromTurn === 'design') return fromTurn;
  if (selectedJobType === 'plan' || selectedJobType === 'design') return selectedJobType;
  return undefined;
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
