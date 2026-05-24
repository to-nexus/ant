/**
 * ChatPanel - Chat content area (history + input)
 *
 * Phase 11 chat-SSOT — consumes `turns: Turn[]` from `useChat()` directly
 * and reads file-operation stats from the projector via `selectFileStats`
 * (single pass over chat.jsonl status lines, no per-message walk).
 */

import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { ChatHeaderBar } from './ChatHeaderBar';
import { ChatHistory } from './ChatHistory';
import { ChatInput } from './ChatInput';
import { PinnedQuery, type PinnedQueryData } from './PinnedQuery';
import { QueueStatusBanner } from './QueueStatusBanner';
import { useFeatureLogSync } from './feature-log/useFeatureLogSync';
import { useChat } from '@/application/hooks/features/useChat';
import { useChatPolicy } from '@/application/hooks/ui/useChatPolicy';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { ActionChipGrid } from '../Actions';
import { useStore } from '@/domain/store';
import { selectFileStats } from '@/domain/store/selectors/chat';
import type { IntentGroup } from '@ant/shared';
import { Zap, ChevronRight } from 'lucide-react';

interface ChatPanelProps {
  projectId: string | null;
  featureName: string | null;
  enabled: boolean;
  selectedAgent?: string | null;
  onCollapse?: () => void;
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
  onCollapse,
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
      {/* Aurora header bar: eraser (sweep) + trash (reset) + collapse icon buttons */}
      <ChatHeaderBar
        selectedProject={_projectId}
        selectedFeature={_featureName}
        selectedAgent={selectedAgent}
        onCollapse={onCollapse ?? (() => {})}
      />

      {/* Chat History (Virtuoso owns scrolling; avoid nested overflow containers) */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {historyWatermarkStyle && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              ...historyWatermarkStyle,
              backgroundSize: '360px 360px',
              opacity: 0.09,
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
              <p className="text-sm shimmer-text" style={{ color: 'var(--text-2)' }}>
                {chatPolicy.emptyStateMessage}
              </p>
            </div>
          </div>
        )}

        {/* Empty State - Ready: Action Chip Grid (hidden when actions tab is open) */}
        {turnCount === 0 && !chatPolicy.emptyStateMessage && chatPolicy.readyEmptyStateMessage && (
          mainPanelActiveTab === 'actions' ? (
            <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-y-auto">
              <div className="text-center max-w-sm">
                <WatermarkIcon
                  src={emptyStateWatermarkSrc}
                  size={120}
                  className="mx-auto mb-4 watermark-empty-icon"
                  fallback={<div className="text-5xl mb-4 animate-sparkle-float inline-block watermark-empty-icon">✨</div>}
                />
                <p
                  className="text-sm font-medium mb-2 shimmer-text"
                  style={{ color: 'var(--text-1)' }}
                >
                  {t('policy.readyToStart')}
                </p>
                <p
                  className="text-xs shimmer-text"
                  style={{ color: 'var(--text-2)' }}
                >
                  {chatPolicy.readyEmptyStateMessage}
                </p>
              </div>
            </div>
          ) : (
            /* spec §5.5: natural flow, no justifyContent:center / no min-h-full; child flexShrink:0 */
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
            >
              <ChatActionCards />
            </div>
          )
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
              <p className="text-xs shimmer-text" style={{ color: 'var(--text-3)' }}>
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

      {/* Input Area - Fixed at bottom */}
      <div
        className="flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-2)' }}
      >
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
  // Agent picker JSX/state removed per §5.5 — `selectedAgent` is sourced
  // from the auth slice only to render the agent watermark; it never gates
  // the visible action set (filtering is now permanent to current agent).
  const selectedAgent = useStore(s => s.selectedAgent);

  const handleSelect = (actionId: IntentGroup) => {
    openActionsPanel(actionId);
  };

  const BASE = import.meta.env.BASE_URL;
  const agentWatermark = selectedAgent
    ? `${BASE}watermarks/${selectedAgent}-color.png`
    : undefined;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: '28rem',
      }}
    >
      {/* Agent character watermark — always shown when an agent is selected. */}
      {agentWatermark && (
        <img
          src={agentWatermark}
          alt=""
          className="w-20 h-20 mb-4 opacity-80 watermark-empty-icon"
          style={{ flexShrink: 0 }}
        />
      )}

      <h2
        className="text-lg font-semibold mb-5"
        style={{ color: 'var(--text-1)', flexShrink: 0 }}
      >
        {t('title')}
      </h2>

      <div style={{ width: '100%', flexShrink: 0 }}>
        <ActionChipGrid
          readiness={readiness}
          variant="compact"
          onSelect={handleSelect}
          agentFilter={selectedAgent || undefined}
        />
      </div>
    </div>
  );
}

function ActionsCTA() {
  const { t } = useTranslation('actions');
  const openActionsPanel = useStore(s => s.openActionsPanel);
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={() => openActionsPanel()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="mx-4 mt-2 px-3 py-2 flex items-center gap-2 text-sm w-[calc(100%-2rem)]"
      style={{
        background: 'var(--gradient-aurora-soft)',
        backgroundSize: '180% 180%',
        backgroundPosition: hover ? '100% 100%' : '0% 0%',
        border: '1px solid oklch(88% 0.06 50)',
        borderRadius: 'var(--r-lg)',
        boxShadow: hover
          ? '0 6px 14px -6px oklch(70% 0.18 60 / 0.35)'
          : 'var(--shadow-xs)',
        color: 'var(--text-1)',
        cursor: 'pointer',
        transition:
          'background-position 360ms var(--ease-smooth), box-shadow 220ms var(--ease-smooth)',
      }}
    >
      <Zap
        className="w-4 h-4 flex-shrink-0"
        style={{ color: 'var(--amber-500)' }}
      />
      <span className="font-medium" style={{ color: 'var(--text-1)' }}>
        {t('ctaButton')}
      </span>
      <span
        className="truncate hidden sm:inline"
        style={{ color: 'var(--text-3)' }}
      >
        — {t('title')}
      </span>
      <ChevronRight
        className="w-3 h-3 ml-auto flex-shrink-0"
        style={{ color: 'var(--text-3)' }}
      />
    </button>
  );
}

// Export hook for parent to use (delegates to Application Hook)
export function useChatData(_projectId: string | null, _featureName: string | null, _enabled: boolean) {
  return useChat();
}
