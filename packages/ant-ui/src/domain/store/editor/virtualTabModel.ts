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

export function shouldRenderVirtualPreviewCard(card: PendingCardSnapshot): boolean {
  return isFileStreamingPendingCard(card) && !!getPendingCardFilePath(card);
}
