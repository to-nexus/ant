/**
 * useChatSSE - Chat SSE hook with automatic project/feature switching
 * 
 * Automatically manages chat sessions per project+feature combination
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../types/chat';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

interface UseChatSSEOptions {
  projectId: string | null;
  featureName: string | null;
  enabled?: boolean;
}

interface UseChatSSEReturn {
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  clearMessages: () => Promise<void>;
}

export function useChatSSE({ 
  projectId, 
  featureName,
  enabled = true 
}: UseChatSSEOptions): UseChatSSEReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentSessionRef = useRef<string>('');

  // Clear messages function
  // ✅ CRITICAL: useCallback to prevent creating new function reference on every render
  const clearMessages = useCallback(async () => {
    if (!projectId || !featureName) return;

    try {
      const response = await fetch(
        `${API_BASE}/projects/${projectId}/features/${featureName}/chat/messages`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to clear messages');
      }

      setMessages([]);
    } catch (error) {
      console.error('Failed to clear chat messages:', error);
    }
  }, [projectId, featureName]);

  useEffect(() => {
    if (!enabled || !projectId || !featureName) {
      // Clean up if disabled or no project/feature
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    const sessionKey = `${projectId}/${featureName}`;

    // If session changed, clear messages and reconnect
    if (currentSessionRef.current !== sessionKey) {
      console.log(`💬 [ChatSSE] Switching to session: ${sessionKey}`);
      currentSessionRef.current = sessionKey;
      setMessages([]);
      
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }

    // ✅ CRITICAL: handleSSEMessage를 useEffect 내부에 정의하여
    // 클로저 문제 방지 및 안정적인 상태 업데이트 보장
    const handleSSEMessage = (data: any) => {
      switch (data.type) {
        case 'initial_state':
          // Load existing messages
          if (data.messages) {
            setMessages(data.messages);
          }
          break;

        case 'user_message':
          // User message added
          if (data.message) {
            setMessages(prev => [...prev, data.message]);
          }
          break;

        case 'message_start':
          // New message started (assistant)
          if (data.message) {
            setMessages(prev => [...prev, data.message]);
            setIsStreaming(true);
          }
          break;

        case 'content_add':
          // Content added to current message
          if (data.messageId && data.content) {
            setMessages(prev => prev.map(msg => {
              if (msg.id === data.messageId) {
                return {
                  ...msg,
                  contents: [...msg.contents, data.content]
                };
              }
              return msg;
            }));
          }
          break;

        case 'content_update':
          // Content updated (merged/appended)
          if (data.messageId && data.content && data.contentIndex !== undefined) {
            setMessages(prev => prev.map(msg => {
              if (msg.id === data.messageId) {
                const newContents = [...msg.contents];
                newContents[data.contentIndex] = data.content;
                return {
                  ...msg,
                  contents: newContents
                };
              }
              return msg;
            }));
          }
          break;

        case 'message_complete':
          // Message completed
          if (data.messageId) {
            setMessages(prev => prev.map(msg => {
              if (msg.id === data.messageId) {
                return {
                  ...msg,
                  isStreaming: false
                };
              }
              return msg;
            }));
            setIsStreaming(false);
          }
          break;

        case 'messages_cleared':
          // All messages cleared
          setMessages([]);
          setIsStreaming(false);
          break;

        default:
          console.warn('Unknown SSE message type:', data.type);
      }
    };

    const connectSSE = () => {
      try {
        const url = `${API_BASE}/projects/${projectId}/features/${featureName}/chat/stream`;
        const eventSource = new EventSource(url);

        eventSource.onopen = () => {
          console.log(`💬 [ChatSSE] Connected to ${sessionKey}`);
          setIsConnected(true);
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleSSEMessage(data);
          } catch (error) {
            console.error('Failed to parse SSE message:', error);
          }
        };

        eventSource.onerror = () => {
          console.error(`💬 [ChatSSE] Connection error for ${sessionKey}`);
          setIsConnected(false);
          eventSource.close();
          
          // Attempt to reconnect after 3 seconds
          if (enabled && projectId && featureName) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log(`💬 [ChatSSE] Reconnecting to ${sessionKey}...`);
              connectSSE();
            }, 3000);
          }
        };

        eventSourceRef.current = eventSource;
      } catch (error) {
        console.error('Failed to create EventSource:', error);
        setIsConnected(false);
      }
    };

    connectSSE();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
    };
  }, [projectId, featureName, enabled]);


  // ✅ CRITICAL: useMemo to prevent creating new object reference on every render
  // This prevents infinite re-renders in parent components
  return useMemo(() => ({
    messages,
    isConnected,
    isStreaming,
    clearMessages
  }), [messages, isConnected, isStreaming, clearMessages]);
}

