import type {
  ChatThinkingLine,
  ChatStatusLine,
  ChatAssistantMessageLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
  PendingCardSnapshot,
} from '@ant/shared';

export type RenderEntry =
  | { key?: string; kind: 'thinking'; line: ChatThinkingLine }
  | {
      key?: string;
      kind: 'status';
      line: ChatStatusLine;
      pending?: PendingCardSnapshot;
    }
  | { key?: string; kind: 'assistant_message'; line: ChatAssistantMessageLine }
  | {
      key?: string;
      kind: 'choice';
      presented: ChatChoicePresentedLine;
      resolved?: ChatChoiceResolvedLine;
    };

export interface TrailingThinkingMerge {
  startIndex: number;
  endIndex: number;
  hasActiveThinking: boolean;
  mergedText: string;
  mergedDurationMs?: number;
  mergedLine: ChatThinkingLine;
}

export function buildTrailingThinkingMerge(
  renderItems: RenderEntry[],
  activeThinking?: string,
  activeText?: string,
): TrailingThinkingMerge | null {
  if (renderItems.length === 0) return null;
  // Adjacency-strict: bail unless the chronological tail is a thinking
  // entry. `activeText` is an unfinalized tail below renderItems.
  if (activeText || renderItems[renderItems.length - 1].kind !== 'thinking') return null;
  const endIndex = renderItems.length - 1;

  let startIndex = endIndex;
  while (startIndex - 1 >= 0 && renderItems[startIndex - 1].kind === 'thinking') {
    startIndex -= 1;
  }

  const thinkingEntries = renderItems.slice(startIndex, endIndex + 1);
  const hasActiveThinking = Boolean(activeThinking);
  const shouldMerge = hasActiveThinking || thinkingEntries.length > 1;
  if (!shouldMerge) return null;

  const baseLine = (thinkingEntries[0] as { kind: 'thinking'; line: ChatThinkingLine }).line;
  const mergedText =
    thinkingEntries
      .map((entry) => (entry as { kind: 'thinking'; line: ChatThinkingLine }).line.text)
      .join('') + (activeThinking ?? '');

  const mergedDurationMs = thinkingEntries.reduce<number | undefined>((acc, entry) => {
    const duration = (entry as { kind: 'thinking'; line: ChatThinkingLine }).line.durationMs;
    if (typeof duration !== 'number') return acc;
    return (acc ?? 0) + duration;
  }, undefined);

  const mergedLine: ChatThinkingLine = {
    ...baseLine,
    text: mergedText,
    ...(typeof mergedDurationMs === 'number' ? { durationMs: mergedDurationMs } : {}),
  };

  return {
    startIndex,
    endIndex,
    hasActiveThinking,
    mergedText,
    mergedDurationMs,
    mergedLine,
  };
}
