
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
import { Eraser, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { Spinner } from '@/presentation/components/common/async';

interface ChatHeaderBarProps {
  selectedProject: string | null;
  selectedFeature: string | null;
}

export function ChatHeaderBar({
  selectedProject,
  selectedFeature,
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
  const baseBtnStyle = {
    color: 'var(--text-3)',
    borderRadius: 'var(--r-sm)',
    transition: 'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
  } as const;

  const trashConfirmStyle = {
    background:
      'oklch(from var(--red-500) l c h / 0.14)',
    color: 'var(--red-500)',
    boxShadow:
      '0 0 0 2px oklch(from var(--red-500) l c h / 0.35), 0 0 12px oklch(from var(--red-500) l c h / 0.4)',
    borderRadius: 'var(--r-sm)',
    transition:
      'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth), box-shadow var(--dur-fast) var(--ease-smooth)',
  } as const;

  const sweepDisabled = !canSweep || isSweeping || !selectedProject || !selectedFeature;

  return (
    <div
      className="relative flex items-center justify-end gap-1 px-2 flex-shrink-0"
      style={{
        height: 36,
        background: 'transparent',
      }}
    >
      {/* 2px Aurora gradient top accent strip */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-0 right-0"
        style={{ height: 2, background: 'var(--gradient-aurora)' }}
      />

      {/* Eraser : sweep current chat view */}
      <button
        type="button"
        onClick={handleSweep}
        disabled={sweepDisabled}
        className="flex items-center justify-center w-8 h-8 hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--violet-600)] disabled:opacity-40 disabled:cursor-not-allowed"
        style={baseBtnStyle}
        title={t('sidebar.sweepTooltip')}
        aria-label={t('sidebar.sweepTooltip')}
      >
        {isSweeping ? (
          <Spinner size="md" />
        ) : (
          <Eraser className="w-4 h-4" />
        )}
      </button>

      {/* Trash : 2-click confirm feature history wipe */}
      <button
        type="button"
        onClick={handleTrashClick}
        disabled={resetDisabled}
        className={`flex items-center justify-center w-8 h-8 disabled:opacity-40 disabled:cursor-not-allowed ${
          confirming ? '' : 'hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--red-500)]'
        }`}
        style={confirming ? trashConfirmStyle : baseBtnStyle}
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
          <Trash2 className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
