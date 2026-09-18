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
  /** The scheduler minted this turn (pipeline step) — no person asked for it. */
  unattended?: boolean;
}

type TurnOriginLine = { turnId?: string; jobType?: string; jobId?: string; pipeline?: unknown };
type ActiveJobAttribution = Record<string, { pipelineRunId?: string } | undefined>;

/**
 * Single owner of "was this turn minted by the scheduler?". Two facts, in
 * order: the durable `user_turn.pipeline` block (appended before enqueue), then
 * the job's kanban attribution (`activeJobs[jobId].pipelineRunId`) for when the
 * chat window no longer holds the user_turn. Neither present → a person's turn.
 */
export function resolveTurnUnattended(args: {
  pipeline?: unknown;
  jobId?: string;
  activeJobs?: ActiveJobAttribution;
}): boolean {
  if (args.pipeline) return true;
  return !!(args.jobId && args.activeJobs?.[args.jobId]?.pipelineRunId);
}

export function isUnattendedTurn(info: { unattended?: boolean } | undefined): boolean {
  return info?.unattended === true;
}

export function buildTurnInfoMap(
  chatEvents: TurnOriginLine[],
  activeJobs?: ActiveJobAttribution,
): Map<string, TurnInfo> {
  const turnInfo = new Map<string, TurnInfo>();
  for (const line of chatEvents) {
    if (!line?.turnId) continue;
    const existing = turnInfo.get(line.turnId);
    if (existing) {
      if (!existing.unattended && line.pipeline) existing.unattended = true;
      continue;
    }
    turnInfo.set(line.turnId, {
      jobType: line.jobType,
      jobId: line.jobId,
      unattended: resolveTurnUnattended({ pipeline: line.pipeline, jobId: line.jobId, activeJobs }),
    });
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

/** An `append_file` stream: the chunk extends a file that already exists on disk. */
export function isAppendPendingCard(card: PendingCardSnapshot): boolean {
  return card.metadata?.append === true;
}

export function isFileStreamingPendingCard(card: PendingCardSnapshot): boolean {
  return FILE_STREAMING_STATUS_TYPES.has(card.statusType);
}

/**
 * Single owner of "does the preview surface render this artifact?".
 *
 * The preview surface exists for documents a human reads — and only for turns
 * a human asked for. A scheduler-minted turn (`isUnattendedTurn`) never mints
 * or promotes a tab: its writes stay a chat file card, exactly as in the code
 * job, so a cron/fetch pipeline cannot pile tabs onto a viewport nobody
 * pointed at them. Tab minting, terminal promotion and chat suppression all
 * check that predicate alongside this one.
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
