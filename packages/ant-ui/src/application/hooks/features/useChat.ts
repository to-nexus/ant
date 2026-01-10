/**
 * Application Layer: Chat View Adapter Hook
 * 
 * Responsibility:
 * - Select Chat data from Domain Store
 * - No business logic, no Infrastructure access
 */

import { useStore } from '@/domain/store';
import type { ChatMessage } from '@/domain/models/chat';

interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
}

export function useChat(): UseChatReturn {
  // ✅ Select data from Domain Store
  const messages = useStore((state) => state.chatMessages);
  const connectionStatus = useStore((state) => state.connectionStatus);
  
  // ✅ Derive streaming state from last message
  const isStreaming = messages.length > 0 && 
    messages[messages.length - 1].role === 'assistant' &&
    messages[messages.length - 1].isStreaming === true;
  
  // ✅ Derive connected state
  const isConnected = connectionStatus === 'connected';

  return {
    messages,
    isStreaming,
    isConnected,
  };
}


