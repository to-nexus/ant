/**
 * ChatPanel - Chat content area (history + input)
 * 
 * Note: Header is managed by parent (App.tsx) using Bar component
 */

import { useMemo, useState, useCallback } from 'react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { PinnedQuery } from './PinnedQuery';
import { useChat } from '@/application/hooks/features/useChat';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import type { FileStats } from '@/domain/models/chat';

interface ChatPanelProps {
  projectId: string | null;
  featureName: string | null;
  enabled: boolean;
}

export function ChatPanel({ projectId: _projectId, featureName: _featureName, enabled: _enabled }: ChatPanelProps) {
  // ✅ Get chat data from Domain Store (via Application Hook)
  // SSE subscription is managed automatically in Store
  const { messages, isStreaming } = useChat();
  
  const chatPolicy = useChatPolicy(messages.length);

  // ✅ Track visibility of last user message for pinned query
  const [isLastUserMessageVisible, setIsLastUserMessageVisible] = useState(true);
  
  const handleLastUserMessageVisibilityChange = useCallback((isVisible: boolean) => {
    setIsLastUserMessageVisible(isVisible);
  }, []);

  // ✅ Get last user query for pinned display
  const lastUserQuery = useMemo(() => {
    const userMessages = messages.filter(m => m.role === 'user');
    return userMessages.length > 0 
      ? userMessages[userMessages.length - 1].contents[0]?.content || ''
      : '';
  }, [messages.length, messages[messages.length - 1]?.id]);

  // ✅ CRITICAL: Extract stable values for dependency tracking
  // messages 배열 자체는 매번 새 참조이므로, 실제 변경사항만 추적
  const lastAssistantMessage = useMemo(() => {
    return messages.filter(m => m.role === 'assistant').pop();
  }, [
    messages.length, 
    messages[messages.length - 1]?.id,
    // ✅ CRITICAL: Track last assistant message's contents changes
    // This ensures fileStats updates when file operations complete (file_creating → file_create)
    messages.filter(m => m.role === 'assistant').pop()?.contents.length,
    messages.filter(m => m.role === 'assistant').pop()?.contents.map(c => c.type).join(',')
  ]);
  
  // ✅ CRITICAL: 파일 관련 content만 카운트 (thinking/text는 제외)
  // thinking content가 스트리밍되어도 fileStats는 변하지 않음!
  const fileOperationCount = useMemo(() => {
    if (!lastAssistantMessage) return 0;
    return lastAssistantMessage.contents.filter(c => 
      c.type === 'file_create' || 
      c.type === 'file_edit' || 
      c.type === 'file_delete'
    ).length;
  }, [lastAssistantMessage?.id, lastAssistantMessage?.contents.length, 
      // ✅ Also track changes in content types (e.g., file_creating → file_create)
      lastAssistantMessage?.contents.map(c => c.type).join(',')]);
  
  // ✅ CRITICAL: Memoize fileStats with stable dependencies
  // 파일 operation 개수가 변경될 때만 재계산 (thinking/text 스트리밍은 무시)
  const fileStats = useMemo((): FileStats => {
    if (!lastAssistantMessage) return { filesEdited: 0, filesCreated: 0, filesDeleted: 0 };
    
    // ✅ Dedup by file path:
    // Even if the same file emits multiple final operations in one message,
    // the UI should show it once (latest operation wins).
    const operationByPath = new Map<string, 'create' | 'edit' | 'delete'>();
    const orderedPaths: string[] = []; // preserve first-seen order for display
    
    lastAssistantMessage.contents.forEach(content => {
      const filePath = content.metadata?.filePath;
      if (!filePath) return;
      
      // Count by operation type (final state only)
      if (content.type === 'file_create') {
        if (!operationByPath.has(filePath)) orderedPaths.push(filePath);
        operationByPath.set(filePath, 'create');
      } else if (content.type === 'file_edit') {
        if (!operationByPath.has(filePath)) orderedPaths.push(filePath);
        operationByPath.set(filePath, 'edit');
      } else if (content.type === 'file_delete') {
        if (!operationByPath.has(filePath)) orderedPaths.push(filePath);
        operationByPath.set(filePath, 'delete');
      }
    });
    
    const filesList: Array<{ path: string; operation: 'create' | 'edit' | 'delete' }> = orderedPaths
      .map((p) => {
        const op = operationByPath.get(p);
        return op ? { path: p, operation: op } : null;
      })
      .filter((v): v is { path: string; operation: 'create' | 'edit' | 'delete' } => v !== null);
    
    let createCount = 0;
    let editCount = 0;
    let deleteCount = 0;
    for (const op of operationByPath.values()) {
      if (op === 'create') createCount++;
      else if (op === 'edit') editCount++;
      else deleteCount++;
    }
    
    return {
      filesEdited: editCount,
      filesCreated: createCount,
      filesDeleted: deleteCount,
      totalFiles: operationByPath.size,
      files: filesList  // ✅ Include file list for collapsible view
    };
  }, [lastAssistantMessage?.id, fileOperationCount]);  // ✅ 파일 operation 개수만 추적

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Chat History (Virtuoso owns scrolling; avoid nested overflow containers) */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Pinned Query - Only show when last user message is NOT visible */}
        {messages.length > 0 && lastUserQuery && !isLastUserMessageVisible && (
          <div className="shrink-0">
            <PinnedQuery query={lastUserQuery} />
          </div>
        )}

        {/* Empty State Message - Not Ready */}
        {messages.length === 0 && chatPolicy.emptyStateMessage && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-8">
            <div className="text-center max-w-sm">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-sm text-gray-600 dark:text-gray-300 shimmer-text">
                {chatPolicy.emptyStateMessage}
              </p>
            </div>
          </div>
        )}

        {/* Empty State Message - Ready to Chat */}
        {messages.length === 0 && !chatPolicy.emptyStateMessage && chatPolicy.readyEmptyStateMessage && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-8">
            <div className="text-center max-w-sm">
              {/* ✨ Animated sparkle with float effect (크기 + 위치 + 회전) */}
              <div className="text-5xl mb-4 animate-sparkle-float inline-block">✨</div>
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium mb-2 shimmer-text">
                Ready to start
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 shimmer-text">
                {chatPolicy.readyEmptyStateMessage}
              </p>
            </div>
          </div>
        )}

        {/* Chat Messages */}
        {messages.length > 0 && (
          <div className="flex-1 min-h-0">
            <ChatHistory
              messages={messages}
              isStreaming={isStreaming}
              onLastUserMessageVisibilityChange={handleLastUserMessageVisibilityChange}
            />
          </div>
        )}
      </div>

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        <ChatInput 
          messageCount={messages.length}
          fileStats={fileStats}
        />
      </div>
    </div>
  );
}

// Export hook for parent to use (delegates to Application Hook)
export function useChatData(_projectId: string | null, _featureName: string | null, _enabled: boolean) {
  // ✅ Delegate to Application Hook (parameters ignored, Store manages subscription)
  return useChat();
}

