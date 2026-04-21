/**
 * ChatPanel - Chat content area (history + input)
 * 
 * Note: Header is managed by parent (App.tsx) using Bar component
 */

import { useMemo, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { PinnedQuery, type PinnedQueryData } from './PinnedQuery';
import { QueueStatusBanner } from './QueueStatusBanner';
import { BreadcrumbTimeline } from './feature-log/BreadcrumbTimeline';
import { useFeatureLogSync } from './feature-log/useFeatureLogSync';
import { useChat } from '@/application/hooks/features/useChat';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { ActionChipGrid } from '../Actions';
import { useStore } from '@/domain/store';
import type { IntentGroup } from '@ant/shared';
import { Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FileStats } from '@/domain/models/chat';

type ChatPanelTab = 'chat' | 'timeline';

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
  const mainPanelActiveTab = useStore(s => s.mainPanelActiveTab);

  // Session-redesign SSOT: load feature.jsonl breadcrumbs on feature switch.
  // Live updates to the Timeline tab arrive via the `job_status=completed|failed`
  // SSE event handler in chatSseHandler.ts which re-issues this load.
  useFeatureLogSync(_projectId, _featureName);

  const [activeTab, setActiveTab] = useState<ChatPanelTab>('chat');

  // ✅ Track which user message to pin (Cursor-style dynamic pinning)
  // null = no pin needed (user message visible or none above viewport)
  const [pinnedQuery, setPinnedQuery] = useState<PinnedQueryData | null>(null);
  
  const handlePinnedUserMessageChange = useCallback((query: PinnedQueryData | null) => {
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
      {/* Tab bar: Chat (live / choice cards) | Timeline (feature.jsonl breadcrumbs) */}
      <ChatPanelTabBar activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'timeline' && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <BreadcrumbTimeline />
        </div>
      )}

      {activeTab === 'chat' && (
      /* Chat History (Virtuoso owns scrolling; avoid nested overflow containers) */
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

        {/* Empty State - Ready: Action Chip Grid (hidden when actions tab is open) */}
        {messages.length === 0 && !chatPolicy.emptyStateMessage && chatPolicy.readyEmptyStateMessage && (
          <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-y-auto">
            {mainPanelActiveTab === 'actions' ? (
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
            ) : (
              <ChatActionCards />
            )}
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
      )}

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Actions CTA - show when messages exist + no active job */}
        {messages.length > 0 && chatPolicy.reason === 'ready' && (
          <ActionsCTA />
        )}
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

function ChatActionCards() {
  const { t } = useTranslation('actions');
  const readiness = useActionReadiness();
  const openActionsPanel = useStore(s => s.openActionsPanel);
  const selectedAgent = useStore(s => s.selectedAgent);
  const [showAll, setShowAll] = useState(false);

  const handleSelect = (actionId: IntentGroup) => {
    openActionsPanel(actionId);
  };

  const BASE = import.meta.env.BASE_URL;
  const agentWatermark = selectedAgent && !showAll
    ? `${BASE}watermarks/${selectedAgent}-color.png`
    : undefined;

  return (
    <div className="flex flex-col items-center max-w-md w-full">
      {/* Agent character (only in agent-filtered view) */}
      {agentWatermark && (
        <img src={agentWatermark} alt="" className="w-20 h-20 mb-4 opacity-80 watermark-empty-icon" />
      )}

      {/* Title row: back button (in showAll) + title + forward button (in agent view) */}
      <div className="flex items-center gap-2 mb-5">
        {showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t('title')}</h2>
      </div>

      <ActionChipGrid
        readiness={readiness}
        variant="compact"
        onSelect={handleSelect}
        agentFilter={showAll ? undefined : (selectedAgent || undefined)}
      />

      {/* "All actions" link (only in agent-filtered view) */}
      {!showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-4 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex items-center gap-1"
        >
          {t('showAll')}
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function ActionsCTA() {
  const { t } = useTranslation('actions');
  const openActionsPanel = useStore(s => s.openActionsPanel);

  return (
    <button
      type="button"
      onClick={() => openActionsPanel()}
      className="mx-4 mt-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-center gap-2 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-sm w-[calc(100%-2rem)]"
    >
      <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400 flex-shrink-0" />
      <span className="font-medium text-amber-700 dark:text-amber-300">{t('ctaButton')}</span>
      <span className="text-amber-500/70 dark:text-amber-400/50 truncate hidden sm:inline">— {t('title')}</span>
      <ChevronRight className="w-3 h-3 text-amber-400 dark:text-amber-500 ml-auto flex-shrink-0" />
    </button>
  );
}

// Export hook for parent to use (delegates to Application Hook)
export function useChatData(_projectId: string | null, _featureName: string | null, _enabled: boolean) {
  // ✅ Delegate to Application Hook (parameters ignored, Store manages subscription)
  return useChat();
}

function ChatPanelTabBar({
  activeTab,
  onChange,
}: {
  activeTab: ChatPanelTab;
  onChange: (tab: ChatPanelTab) => void;
}) {
  const { t } = useTranslation('chat');
  const tabs: Array<{ id: ChatPanelTab; label: string }> = [
    { id: 'chat', label: t('panelTabs.chat', { defaultValue: 'Chat' }) },
    { id: 'timeline', label: t('panelTabs.timeline', { defaultValue: 'Timeline' }) },
  ];

  return (
    <div
      role="tablist"
      className="flex-shrink-0 flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#161b22] px-2 pt-1.5"
    >
      {tabs.map(tab => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`text-xs px-2.5 py-1.5 rounded-t-md border border-b-0 transition-colors ${
              isActive
                ? 'bg-white dark:bg-[#0d1117] border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 font-medium -mb-px'
                : 'bg-transparent border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

