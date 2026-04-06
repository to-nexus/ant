/**
 * ChatPanel - Chat content area (history + input)
 * 
 * Note: Header is managed by parent (App.tsx) using Bar component
 */

import { useMemo, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { PinnedQuery } from './PinnedQuery';
import { QueueStatusBanner } from './QueueStatusBanner';
import { useChat } from '@/application/hooks/features/useChat';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import type { FileStats } from '@/domain/models/chat';

interface ChatPanelProps {
  projectId: string | null;
  featureName: string | null;
  enabled: boolean;
  selectedAgent?: string | null;
}

type WatermarkVariant = 'color' | 'mono';

const BASE = import.meta.env.BASE_URL;

const WATERMARK_MAP: Record<string, Record<WatermarkVariant, string>> = {
  planner: {
    color: `${BASE}watermarks/planner-color.png`,
    mono: `${BASE}watermarks/planner-mono.png`,
  },
  architect: {
    color: `${BASE}watermarks/architect-color.png`,
    mono: `${BASE}watermarks/architect-mono.png`,
  },
  creator: {
    color: `${BASE}watermarks/creator-color.png`,
    mono: `${BASE}watermarks/creator-mono.png`,
  },
};

function getWatermarkSrc(
  selectedAgent: string | null | undefined,
  variant: WatermarkVariant
): string | null {
  if (!selectedAgent) return null;
  return WATERMARK_MAP[selectedAgent]?.[variant] ?? null;
}

function getWatermarkStyle(
  selectedAgent: string | null | undefined,
  variant: WatermarkVariant
): CSSProperties | null {
  const src = getWatermarkSrc(selectedAgent, variant);
  if (!src) return null;

  return {
    backgroundImage: `url(${src})`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  };
}

function WatermarkIcon({ src, size, className, fallback }: {
  src: string | null;
  size: number;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback}</>;

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}

export function ChatPanel({
  projectId: _projectId,
  featureName: _featureName,
  enabled: _enabled,
  selectedAgent = null,
}: ChatPanelProps) {
  const { t } = useTranslation('chat');
  
  // ✅ Get chat data from Domain Store (via Application Hook)
  // SSE subscription is managed automatically in Store
  const { messages, isStreaming } = useChat();
  
  const chatPolicy = useChatPolicy(messages.length);

  // ✅ Track which user message to pin (Cursor-style dynamic pinning)
  // null = no pin needed (user message visible or none above viewport)
  const [pinnedQuery, setPinnedQuery] = useState<string | null>(null);
  
  const handlePinnedUserMessageChange = useCallback((query: string | null) => {
    setPinnedQuery(query);
  }, []);
  
  // ✅ Clear pin when chat is cleared (ChatHistory unmounts when messages.length === 0)
  useEffect(() => {
    if (messages.length === 0) {
      setPinnedQuery(null);
    }
  }, [messages.length]);

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
    messages.filter(m => m.role === 'assistant').pop()?.contents.filter(Boolean).map(c => c.type).join(',')
  ]);
  
  // ✅ CRITICAL: 파일 관련 content만 카운트 (thinking/text는 제외)
  // thinking content가 스트리밍되어도 fileStats는 변하지 않음!
  const fileOperationCount = useMemo(() => {
    if (!lastAssistantMessage) return 0;
    return lastAssistantMessage.contents.filter(c => 
      c && (c.type === 'file_create' || 
      c.type === 'file_edit' || 
      c.type === 'file_delete')
    ).length;
  }, [lastAssistantMessage?.id, lastAssistantMessage?.contents.length, 
      lastAssistantMessage?.contents.filter(Boolean).map(c => c.type).join(',')]);
  
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
      if (!content) return;
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

  const hasMessages = messages.length > 0;
  const emptyStateWatermarkSrc = useMemo(
    () => getWatermarkSrc(selectedAgent, 'color'),
    [selectedAgent]
  );
  const historyWatermarkStyle = useMemo(
    () => (hasMessages ? getWatermarkStyle(selectedAgent, 'mono') : null),
    [hasMessages, selectedAgent]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Chat History (Virtuoso owns scrolling; avoid nested overflow containers) */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {historyWatermarkStyle && (
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.08] dark:opacity-[0.1]"
            style={{
              ...historyWatermarkStyle,
              backgroundSize: '360px 360px',
            }}
            aria-hidden="true"
          />
        )}

        {/* Pinned Query - Absolute overlay to avoid layout feedback loop with Virtuoso */}
        <PinnedQuery query={pinnedQuery} />

        {/* Empty State Message - Not Ready */}
        {messages.length === 0 && chatPolicy.emptyStateMessage && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-8">
            <div className="text-center max-w-sm">
              <WatermarkIcon
                src={emptyStateWatermarkSrc}
                size={120}
                className="mx-auto mb-4"
                fallback={<div className="text-4xl mb-4">💬</div>}
              />
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
              <WatermarkIcon
                src={emptyStateWatermarkSrc}
                size={120}
                className="mx-auto mb-4 watermark-empty-icon"
                fallback={<div className="text-5xl mb-4 animate-sparkle-float inline-block watermark-empty-icon">✨</div>}
              />
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium mb-2 shimmer-text">
                {t('policy.readyToStart')}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-300 shimmer-text">
                {chatPolicy.readyEmptyStateMessage}
              </p>
            </div>
          </div>
        )}

        {/* Empty State Fallback - job-running / job-interrupted with no messages yet */}
        {messages.length === 0 && !chatPolicy.emptyStateMessage && !chatPolicy.readyEmptyStateMessage && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-8">
            <div className="text-center max-w-sm">
              <WatermarkIcon
                src={emptyStateWatermarkSrc}
                size={120}
                className="mx-auto mb-4 watermark-empty-icon opacity-60"
                fallback={<div className="text-5xl mb-4 animate-sparkle-float inline-block watermark-empty-icon opacity-60">✨</div>}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 shimmer-text">
                {chatPolicy.inputPlaceholder}
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
              onPinnedUserMessageChange={handlePinnedUserMessageChange}
            />
          </div>
        )}
      </div>

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Queue Status Banner */}
        <QueueStatusBanner />
        
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

