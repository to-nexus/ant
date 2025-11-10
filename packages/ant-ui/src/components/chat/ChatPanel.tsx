/**
 * ChatPanel - Chat content area (history + input)
 * 
 * Note: Header is managed by parent (App.tsx) using Bar component
 */

import { useMemo } from 'react';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { useChatSSE } from '../../hooks/useChatSSE';
import { useChatPolicy } from '../../hooks/useChatPolicy';
import { useStore } from '../../lib/store';
import type { FileStats } from '../../types/chat';

interface ChatPanelProps {
  projectId: string | null;
  featureName: string | null;
  enabled: boolean;
}

export function ChatPanel({ projectId, featureName, enabled }: ChatPanelProps) {
  // Automatically switch chat session based on project/feature
  const { messages, isStreaming } = useChatSSE({
    projectId,
    featureName,
    enabled
  });
  
  const lastJobFailed = useStore((state) => state.lastJobFailed);
  const chatPolicy = useChatPolicy(messages.length, lastJobFailed);

  // ✅ CRITICAL: Extract stable values for dependency tracking
  // messages 배열 자체는 매번 새 참조이므로, 실제 변경사항만 추적
  const lastAssistantMessage = useMemo(() => {
    return messages.filter(m => m.role === 'assistant').pop();
  }, [messages.length, messages[messages.length - 1]?.id]);  // length와 마지막 메시지 ID만 추적
  
  // ✅ CRITICAL: 파일 관련 content만 카운트 (thinking/text는 제외)
  // thinking content가 스트리밍되어도 fileStats는 변하지 않음!
  const fileOperationCount = useMemo(() => {
    if (!lastAssistantMessage) return 0;
    return lastAssistantMessage.contents.filter(c => 
      c.type === 'file_create' || 
      c.type === 'file_edit' || 
      c.type === 'file_delete'
    ).length;
  }, [lastAssistantMessage?.id, lastAssistantMessage?.contents.length]);
  
  // ✅ CRITICAL: Memoize fileStats with stable dependencies
  // 파일 operation 개수가 변경될 때만 재계산 (thinking/text 스트리밍은 무시)
  const fileStats = useMemo((): FileStats => {
    if (!lastAssistantMessage) return { filesEdited: 0, filesCreated: 0, filesDeleted: 0 };
    
    const uniqueFilePaths = new Set<string>();
    const filesList: Array<{ path: string; operation: 'create' | 'edit' | 'delete' }> = [];
    let createCount = 0;
    let editCount = 0;
    let deleteCount = 0;
    
    lastAssistantMessage.contents.forEach(content => {
      const filePath = content.metadata?.filePath;
      if (!filePath) return;
      
      // Count by operation type (final state only)
      if (content.type === 'file_create') {
        uniqueFilePaths.add(filePath);
        filesList.push({ path: filePath, operation: 'create' });
        createCount++;
      } else if (content.type === 'file_edit') {
        uniqueFilePaths.add(filePath);
        filesList.push({ path: filePath, operation: 'edit' });
        editCount++;
      } else if (content.type === 'file_delete') {
        uniqueFilePaths.add(filePath);
        filesList.push({ path: filePath, operation: 'delete' });
        deleteCount++;
      }
    });
    
    return {
      filesEdited: editCount,
      filesCreated: createCount,
      filesDeleted: deleteCount,
      totalFiles: uniqueFilePaths.size,
      files: filesList  // ✅ Include file list for collapsible view
    };
  }, [lastAssistantMessage?.id, fileOperationCount]);  // ✅ 파일 operation 개수만 추적

  return (
    <>
      {/* Chat History (scrollable) */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty State Message - Not Ready */}
        {messages.length === 0 && chatPolicy.emptyStateMessage && (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center max-w-sm">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {chatPolicy.emptyStateMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Empty State Message - Ready to Chat */}
        {messages.length === 0 && !chatPolicy.emptyStateMessage && chatPolicy.readyEmptyStateMessage && (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center max-w-sm">
              {/* ✨ Animated sparkle with float effect (크기 + 위치 + 회전) */}
              <div className="text-5xl mb-4 animate-sparkle-float inline-block">✨</div>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-2">
                Ready to start
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {chatPolicy.readyEmptyStateMessage}
              </p>
            </div>
          </div>
        )}
        
        {/* Chat Messages */}
        {messages.length > 0 && (
          <ChatHistory messages={messages} isStreaming={isStreaming} />
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 dark:border-gray-700">
        <ChatInput 
          disabled={isStreaming} 
          messageCount={messages.length}
          fileStats={fileStats}
        />
      </div>
    </>
  );
}

// Export hook for parent to use
export function useChatData(projectId: string | null, featureName: string | null, enabled: boolean) {
  return useChatSSE({ projectId, featureName, enabled });
}

