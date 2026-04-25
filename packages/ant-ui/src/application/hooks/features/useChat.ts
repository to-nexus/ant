/**
 * Application Layer: Chat View Adapter Hook
 *
 * Phase 11 chat-SSOT — exposes the projector output (`Turn[]`) directly
 * so the presentation layer no longer needs the legacy `ChatMessage[]`
 * envelope. Streaming detection walks the last turn's sections and
 * looks for any active streaming buffer overlay (text / thinking /
 * pendingCards).
 */

import { useStore } from '@/domain/store';
import { selectTurns, type Turn } from '@/domain/store/selectors/chat';

interface UseChatReturn {
  turns: Turn[];
  isStreaming: boolean;
  isConnected: boolean;
}

export function useChat(): UseChatReturn {
  const turns = useStore(selectTurns);
  const connectionStatus = useStore((state) => state.connectionStatus);

  const lastTurn = turns[turns.length - 1];
  const isStreaming =
    !!lastTurn &&
    lastTurn.sections.some(
      (s) =>
        !!s.activeText ||
        !!s.activeThinking ||
        !!(s.pendingCards && Object.keys(s.pendingCards).length > 0),
    );

  const isConnected = connectionStatus === 'connected';

  return {
    turns,
    isStreaming,
    isConnected,
  };
}
