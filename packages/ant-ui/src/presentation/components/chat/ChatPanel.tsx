/**
 * ChatPanel - Chat content area (history + input)
 *
 * Phase 11 chat-SSOT — consumes `turns: Turn[]` from `useChat()` directly
 * and reads file-operation stats from the projector via `selectFileStats`
 * (single pass over chat.jsonl status lines, no per-message walk).
 */

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
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
import { selectFileStats } from '@/domain/store/selectors/chat';
import type { IntentGroup } from '@ant/shared';
import { Zap, ChevronLeft, ChevronRight } from 'lucide-react';

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

  const { turns } = useChat();
  const turnCount = turns.length;

  // FileStats now derived directly from chat.jsonl SSOT — one selector
  // pass over the chatEvents slice. Survives reconnect / refresh because
  // it operates on the durable substrate, not on the message envelope.
  const fileStats = useStore(selectFileStats);

  const chatPolicy = useChatPolicy(turnCount);
  const mainPanelActiveTab = useStore(s => s.mainPanelActiveTab);

  // Session-redesign SSOT: load feature.jsonl breadcrumbs on feature switch.
  useFeatureLogSync(_projectId, _featureName);

  const [activeTab, setActiveTab] = useState<ChatPanelTab>('chat');

  // Track which user message to pin (Cursor-style dynamic pinning)
  const [pinnedQuery, setPinnedQuery] = useState<PinnedQueryData | null>(null);

  const handlePinnedUserMessageChange = useCallback((query: PinnedQueryData | null) => {
    setPinnedQuery(query);
  }, []);

  // Clear pin when chat is cleared.
  useEffect(() => {
    if (turnCount === 0) {
      setPinnedQuery(null);
    }
  }, [turnCount]);

  const hasMessages = turnCount > 0;
  const emptyStateWatermarkSrc = getWatermarkSrc(selectedAgent, 'color');
  const historyWatermarkStyle = hasMessages
    ? getWatermarkStyle(selectedAgent, 'mono')
    : null;

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
        {turnCount === 0 && chatPolicy.emptyStateMessage && (
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
        {turnCount === 0 && !chatPolicy.emptyStateMessage && chatPolicy.readyEmptyStateMessage && (
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
        {turnCount === 0 && !chatPolicy.emptyStateMessage && !chatPolicy.readyEmptyStateMessage && (
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

        {/* Chat Turns */}
        {turnCount > 0 && (
          <div className="flex-1 min-h-0">
            <ChatHistory
              turns={turns}
              onPinnedUserMessageChange={handlePinnedUserMessageChange}
            />
          </div>
        )}
      </div>
      )}

      {/* Input Area - Fixed at bottom */}
      <div className="border-t border-gray-200 dark:border-gray-700 flex-shrink-0">
        {/* Actions CTA - show when turns exist + no active job */}
        {turnCount > 0 && chatPolicy.reason === 'ready' && (
          <ActionsCTA />
        )}
        {/* Queue Status Banner */}
        <QueueStatusBanner />

        <ChatInput
          messageCount={turnCount}
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
