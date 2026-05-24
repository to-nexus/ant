
/**
 * ChatHeaderBar — Aurora-styled header strip above the chat panel body.
 *
 * Hosts the two icon-only controls formerly rendered in the ChatSidebarWrapper
 * Bar right slot:
 *   - Eraser : sweep current chat view (clearChatHistory). Single-click with
 *              modal confirm dialog (preserves prior UX).
 *   - Trash  : 2-click confirm feature history wipe (resetFeatureContext).
 *              First click flips button to red confirm tone with red border
 *              glow; second click within 3s opens the modal-confirm + reset
 *              flow. A useEffect timer auto-cancels the confirm state after
 *              3000ms.
 *
 * The bar's 2px top accent strip uses var(--gradient-aurora).
 *
 * Behaviour + i18n keys preserved verbatim from the previous
 * ChatSidebarWrapper implementation so no locale entries are removed.
 */

import { useEffect, useState } from 'react';
import { Eraser, Menu, MessageCircle, Trash2, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Spinner } from '@/presentation/components/common/async';

interface ChatHeaderBarProps {
  selectedProject: string | null;
  selectedFeature: string | null;
  selectedAgent: string | null;
  onCollapse: () => void;
}

export function ChatHeaderBar({
  selectedProject,
  selectedFeature,
  selectedAgent,
  onCollapse,
}: ChatHeaderBarProps) {
  const { t } = useTranslation('chat');

  const chatEvents = useStore((state) => state.chatEvents);
  const isRunning = useStore((state) => state.isRunning);
  const runningJobsByFeature = useStore((state) => state.runningJobsByFeature);
  const kanbanData = useStore((state) => state.kanban);
  const dismissedInterruptTimestamp = useStore(
    (state) => state.dismissedInterruptTimestamp,
  );
  const resetFeatureContext = useStore((state) => state.resetFeatureContext);

  const { showConfirm, showError, showSuccess } = useAlertModalContext();

  const [isSweeping, setIsSweeping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Feature-scoped guards (mirrors useChatPolicy + previous wrapper logic).
  const featureKey =
    selectedProject && selectedFeature
      ? `${selectedProject}/${selectedFeature}`
      : null;
  const hasRunningJobForFeature = featureKey
    ? !!runningJobsByFeature[featureKey]
    : false;
  const hasInterruption =
    !isRunning &&
    kanbanData?.interruption?.canResume === true &&
    kanbanData?.interruption?.timestamp !== dismissedInterruptTimestamp;

  const canSweep = chatEvents.length > 0;
  const resetDisabled =
    !selectedFeature || isResetting || hasRunningJobForFeature || hasInterruption;

  // Auto-cancel the trash-confirm state after 3s of inactivity.
  useEffect(() => {
    if (!confirming) return;
    const id = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(id);
  }, [confirming]);

  // ── Sweep (eraser) ────────────────────────────────────────────────────
  const handleSweep = async () => {
    if (!selectedProject || !selectedFeature) return;

    const cancelActive = isRunning || hasRunningJobForFeature;
    const message = cancelActive ? (
      <>
        <p>{t('sidebar.sweepConfirm')}</p>
        <p className="mt-2 font-medium" style={{ color: 'var(--orange-600)' }}>
          {t('sidebar.sweepConfirmRunning', {
            defaultValue:
              'A job is currently running. Confirming will stop the job and clear the chat.',
          })}
        </p>
      </>
    ) : (
      <>
        <p>{t('sidebar.sweepConfirm')}</p>
        <p className="mt-2 font-medium">{t('sidebar.sweepConfirmSub')}</p>
      </>
    );

    showConfirm(message, {
      type: cancelActive ? 'warning' : 'info',
      title: t('sidebar.sweepTitle'),
      confirmText: cancelActive
        ? t('sidebar.sweepConfirmRunningAction', {
            defaultValue: 'Stop job & clear',
          })
        : t('sidebar.sweepConfirmAction'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        try {
          setIsSweeping(true);
          const { clearChatHistory } = await import('@/infrastructure/http/api');
          await clearChatHistory(selectedProject, selectedFeature, {
            cancelActive,
          });
        } catch (err) {
          console.error('[ChatHeaderBar] Failed to sweep chat:', err);
          showError(t('sidebar.sweepFailed'), { title: t('common:error.title') });
        } finally {
          setIsSweeping(false);
        }
      },
    });
  };

  // ── Reset (trash) — 2-click confirm ───────────────────────────────────
  const handleTrashClick = () => {
    if (resetDisabled || !selectedProject || !selectedFeature) return;

    // First click — flip to red "confirm" tone.
    if (!confirming) {
      if (hasRunningJobForFeature) {
        showError(t('context.resetBlockedByJob'), {
          title: t('common:error.title'),
        });
        return;
      }
      if (hasInterruption) {
        showError(t('sidebar.resetBlockedByInterruption'), {
          title: t('common:error.title'),
        });
        return;
      }
      setConfirming(true);
      return;
    }

    // Second click within 3s — invoke the existing reset flow verbatim.
    showConfirm(t('context.resetConfirm'), {
      title: t('context.resetConfirmTitle'),
      type: 'warning',
      confirmText: t('context.resetConfirmAction'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        try {
          setIsResetting(true);
          await resetFeatureContext(selectedProject, selectedFeature);
          showSuccess(t('context.resetSuccess'), {
            title: t('context.resetSuccessTitle'),
          });
        } catch (err) {
          console.warn('[ChatHeaderBar] context reset failed:', err);
          const message = err instanceof Error ? err.message : String(err);
          showError(
            `${t('context.resetFailed')}${message ? `\n${message}` : ''}`,
            { title: t('common:error.title') },
          );
        } finally {
          setIsResetting(false);
        }
      },
    });
    setConfirming(false);
  };

  // ── Styles ────────────────────────────────────────────────────────────
  // handoff a3-chat.jsx ChatHeaderBar 명세(L916-932 `headerBtn`)에 맞춰 26×26 icon-button +
  // var(--r-sm) 둥근 모서리, 기본/위험 톤별로 background·border 토큰을 분기한다.
  // transition은 명세의 `transition: all var(--dur-fast)`를 따라 'all'로 통일 — hover swap 제거에
  // 따른 변경. idle↔confirm 톤 전환 시 background/border/box-shadow가 한 번에 보간된다.
  const baseBtnStyle = {
    width: 26,
    height: 26,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-2)',
    color: 'var(--text-2)',
    borderRadius: 'var(--r-sm)',
    transition: 'all var(--dur-fast) var(--ease-smooth)',
  } as const;

  const trashIdleStyle = {
    ...baseBtnStyle,
    background: 'oklch(from var(--red-300) l c h / 0.12)',
    border: '1px solid oklch(from var(--red-400) l c h / 0.35)',
    color: 'var(--red-600)',
  } as const;

  // handoff 명세(L932-942): confirm 상태는 idle headerBtn(true) 위에 background·borderColor·boxShadow
  // 세 속성만 overlay 한다. color는 idle red-600을 그대로 유지 — 별도로 red-500을 spread 하지 않는다.
  const trashConfirmStyle = {
    ...trashIdleStyle,
    background: 'oklch(from var(--red-400) l c h / 0.25)',
    border: '1px solid var(--red-500)',
    boxShadow: '0 0 10px oklch(70% 0.20 25 / 0.4)',
  } as const;

  const sweepDisabled = !canSweep || isSweeping || !selectedProject || !selectedFeature;

  return (
    <div
      className="relative flex items-center flex-shrink-0"
      style={{
        height: 40,
        padding: '0 16px',
        gap: 10,
        borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-surface-2)',
      }}
    >
      {/* 2px Aurora gradient top accent strip (handoff: gradient-flow animation, opacity 0.85) */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0 gradient-flow"
        style={{
          height: 2,
          background: 'var(--gradient-aurora)',
          backgroundSize: '200% 200%',
          opacity: 0.85,
        }}
      />

      {/* Title slot — branches on selectedAgent presence:
          • offline (no agent): WifiOff icon + sidebar.offline label
          • online  (agent set): speech-bubble (MessageCircle) + 'Chat' label
                                 (handoff a3-chat.jsx L947 — Icon name="chat" size=13, violet-600) */}
      {selectedAgent ? (
        <>
          <MessageCircle
            size={13}
            strokeWidth={2.2}
            style={{ color: 'var(--violet-600)', flexShrink: 0 }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-1)',
            }}
          >
            {t('header.title', { defaultValue: 'Chat' })}
          </span>
        </>
      ) : (
        <>
          <WifiOff
            size={13}
            style={{ color: 'var(--text-3)', flexShrink: 0 }}
            aria-hidden="true"
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text-1)',
            }}
          >
            {t('sidebar.offline')}
          </span>
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Eraser : sweep current chat view */}
      <button
        type="button"
        onClick={handleSweep}
        disabled={sweepDisabled}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
        style={baseBtnStyle}
        title={t('sidebar.sweepTooltip')}
        aria-label={t('sidebar.sweepTooltip')}
      >
        {isSweeping ? (
          <Spinner size="md" />
        ) : (
          <Eraser size={13} strokeWidth={2.2} />
        )}
      </button>

      {/* Trash : 2-click confirm feature history wipe */}
      <button
        type="button"
        onClick={handleTrashClick}
        disabled={resetDisabled}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
        style={confirming ? trashConfirmStyle : trashIdleStyle}
        title={
          confirming
            ? t('context.resetConfirmAction')
            : t('context.resetTooltip')
        }
        aria-label={t('context.resetTooltip')}
      >
        {isResetting ? (
          <Spinner size="md" tone={confirming ? 'inherit' : 'muted'} />
        ) : (
          <Trash2 size={13} strokeWidth={2.2} />
        )}
      </button>

      {/* Collapse : hide chat sidebar (entry point for re-expand lives in ChatSidebarWrapper collapsed state) */}
      <button
        type="button"
        onClick={onCollapse}
        style={baseBtnStyle}
        title={t('sidebar.collapse')}
        aria-label={t('sidebar.collapse')}
      >
        <Menu size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}
