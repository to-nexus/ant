/**
 * read_state scope='history' projection over the persisted `session:main`
 * array — universal's decompaction escape hatch. In-flight compaction
 * (`composeUniversalMessages`) folds turns on a throwaway copy only, so the
 * persisted array holds the originals; this projects them into the
 * HistoryTurn shape `handleReadState` renders.
 *
 * Turn identity: the runner stamps each turn-opening user message with
 * `metadata.jobId` at admission — stable across seal-time byte trims. Legacy
 * unstamped turns get synthesized `turn-{n}` ids, which shift when a trim
 * drops older turns.
 */

import type { ConversationMessage } from '../../../common/graph/conversations';

export interface UniversalHistoryTurn {
  turnId: string;
  ts: string;
  userText: string;
  assistantFinalText?: string;
}

function assistantText(content: ConversationMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function projectHistoryTurns(messages: ConversationMessage[]): UniversalHistoryTurn[] {
  const turns: UniversalHistoryTurn[] = [];
  for (const msg of messages) {
    // Only a string-content user message opens a turn — array-content user
    // messages are tool_result rounds / clarify closures / subagent joins,
    // i.e. continuations of the turn already open.
    if (msg.role === 'user' && typeof msg.content === 'string') {
      turns.push({
        turnId: msg.metadata?.jobId ?? `turn-${turns.length + 1}`,
        ts: msg.timestamp ?? '',
        userText: msg.content,
      });
      continue;
    }
    if (msg.role === 'assistant' && turns.length > 0) {
      const text = assistantText(msg.content);
      // Last assistant text before the next opener wins; tool_use-only
      // rounds contribute nothing.
      if (text.trim()) turns[turns.length - 1].assistantFinalText = text;
    }
  }
  return turns;
}
