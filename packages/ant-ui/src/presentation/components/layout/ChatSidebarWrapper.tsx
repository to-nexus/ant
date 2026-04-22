import { ChevronRight, WifiOff, Trash2, RefreshCw } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async/primitives';
import { Bar } from '../Bar';
import { ChatPanel } from '../chat/ChatPanel';
import { useStore } from '@/domain/store';
import { useAlertModalContext } from '@/presentation/providers/AlertModalProvider';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ChatSidebarWrapperProps {
  isCollapsed: boolean;
  width: number;
  isResizing: boolean;
  selectedAgent: string | null;
  selectedProject: string | null;
  selectedFeature: string | null;
  onExpand: () => void;
  onCollapse: () => void;
  onResizeStart: () => void;
}

export function ChatSidebarWrapper({
  isCollapsed,
  width,
  isResizing,
  selectedAgent,
  selectedProject,
  selectedFeature,
  onExpand,
  onCollapse,
  onResizeStart,
}: ChatSidebarWrapperProps) {
  const chatMessages = useStore((state) => state.chatMessages);
  const isRunning = useStore((state) => state.isRunning);
  const runningJobsByFeature = useStore((state) => state.runningJobsByFeature);
  const kanbanData = useStore((state) => state.kanban);
  const dismissedInterruptTimestamp = useStore((state) => state.dismissedInterruptTimestamp);
  const resetFeatureContext = useStore((state) => state.resetFeatureContext);
  const { showConfirm, showError, showSuccess } = useAlertModalContext();
  const [isSweeping, setIsSweeping] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { t } = useTranslation('chat');

  // Feature-scoped guards. `hasRunningJobForFeature` catches other jobs running
  // on the same feature (siblings of current), while `hasInterruption`
  // mirrors useChatPolicy — a paused job that hasn't been resumed or
  // dismissed yet must be resolved before a hard reset.
  const featureKey = selectedProject && selectedFeature ? `${selectedProject}/${selectedFeature}` : null;
  const hasRunningJobForFeature = featureKey ? !!runningJobsByFeature[featureKey] : false;
  const hasInterruption =
    !isRunning &&
    kanbanData?.interruption?.canResume === true &&
    kanbanData?.interruption?.timestamp !== dismissedInterruptTimestamp;

  // Sweep = chat.jsonl collapse only. Chat view gets cleaned up but the
  // LLM retains conversation context (feature.jsonl intact). Gated only by
  // "job not currently streaming" to avoid clearing mid-response.
  const handleSweepChat = async () => {
    if (!selectedProject || !selectedFeature) return;

    showConfirm(
      <>
        <p>{t('sidebar.sweepConfirm')}</p>
        <p className="mt-2 font-medium">{t('sidebar.sweepConfirmSub')}</p>
      </>,
      {
        type: 'info',
        title: t('sidebar.sweepTitle'),
        confirmText: t('sidebar.sweepConfirmAction'),
        cancelText: t('common:button.cancel'),
        onConfirm: async () => {
          try {
            setIsSweeping(true);
            const { clearChatHistory } = await import('@/infrastructure/http/api');
            await clearChatHistory(selectedProject, selectedFeature);
            console.log('[ChatSidebar] Chat view swept');
          } catch (error) {
            console.error('[ChatSidebar] Failed to sweep chat:', error);
            showError(t('sidebar.sweepFailed'), { title: t('common:error.title') });
          } finally {
            setIsSweeping(false);
          }
        }
      }
    );
  };

  // Reset = hard reset (feature.jsonl + chat.jsonl both collapse + boundary).
  // The next job starts from an empty context. Blocked while any job on this
  // feature is running OR an interrupted job still awaits dismiss/resume.
  const handleResetContext = async () => {
    if (!selectedProject || !selectedFeature || isResetting) return;
    if (hasRunningJobForFeature) {
      showError(t('context.resetBlockedByJob'), { title: t('common:error.title') });
      return;
    }
    if (hasInterruption) {
      showError(t('sidebar.resetBlockedByInterruption'), { title: t('common:error.title') });
      return;
    }

    showConfirm(t('context.resetConfirm'), {
      title: t('context.resetConfirmTitle'),
      type: 'warning',
      confirmText: t('context.resetConfirmAction'),
      cancelText: t('common:button.cancel'),
      onConfirm: async () => {
        try {
          setIsResetting(true);
          await resetFeatureContext(selectedProject, selectedFeature);
          showSuccess(t('context.resetSuccess'), { title: t('context.resetSuccessTitle') });
        } catch (err) {
          console.warn('[ChatSidebar] context reset failed:', err);
          const message = err instanceof Error ? err.message : String(err);
          showError(`${t('context.resetFailed')}${message ? `\n${message}` : ''}`, {
            title: t('common:error.title'),
          });
        } finally {
          setIsResetting(false);
        }
      }
    });
  };

  // Collapsed state
  if (isCollapsed) {
    return (
      <div className="w-10 bg-white dark:bg-[#161b22] border-l border-gray-200 dark:border-[#30363d] flex flex-col items-center shrink-0 transition-colors shadow-sm">
        <button
          onClick={onExpand}
          className="h-10 w-10 flex items-center justify-center border-b border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title={t('sidebar.expand')}
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
      </div>
    );
  }

  const canSweep = chatMessages.length > 0 && !isRunning;
  const resetDisabled = isResetting || hasRunningJobForFeature || hasInterruption;
  const resetTooltip = hasRunningJobForFeature
    ? t('context.resetBlockedByJob')
    : hasInterruption
      ? t('sidebar.resetBlockedByInterruption')
      : t('context.resetTooltip');

  // Expanded state
  return (
    <aside 
      className="bg-white dark:bg-[#161b22] border-l border-gray-200 dark:border-[#30363d] flex flex-col overflow-hidden transition-colors shrink-0 relative shadow-sm"
      style={{ width: `${width}px` }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-blue-400 dark:hover:bg-blue-500 transition-colors z-10"
        style={{
          backgroundColor: isResizing ? '#3b82f6' : 'transparent'
        }}
        onMouseDown={onResizeStart}
      />

      {/* Chat Bar */}
      {Bar.render({
        left: (
          <>
            {!selectedAgent ? (
              <>
                <WifiOff className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span className="text-gray-700 dark:text-gray-200 font-medium">{t('sidebar.offline')}</span>
              </>
            ) : (
              <>
                <span className="text-2xl">💬</span>
                <span className="text-gray-700 dark:text-gray-200 font-medium">
                  {t('sidebar.chatWith', { agent: selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1) })}
                </span>
              </>
            )}
          </>
        ),
        right: (
          <div className="flex items-center gap-1">
            {/* Sweep: tidy up chat view (chat.jsonl collapse). Context preserved. */}
            {canSweep && (
              <button
                onClick={handleSweepChat}
                disabled={isSweeping}
                className="text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center w-8 h-8 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('sidebar.sweepTooltip')}
                aria-label={t('sidebar.sweepTooltip')}
              >
                {isSweeping ? <Spinner size="sm" tone="inherit" /> : <RefreshCw className="w-4 h-4" />}
              </button>
            )}

            {/* Reset: hard reset (feature.jsonl + chat.jsonl + boundary). */}
            {selectedFeature && (
              <button
                onClick={handleResetContext}
                disabled={resetDisabled}
                className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center justify-center w-8 h-8 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title={resetTooltip}
                aria-label={t('context.resetTooltip')}
              >
                {isResetting ? <Spinner size="sm" tone="inherit" /> : <Trash2 className="w-4 h-4" />}
              </button>
            )}

            {/* Collapse Button */}
            <button
              onClick={onCollapse}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center justify-center w-10 h-10 -mr-4 -my-4"
              title={t('sidebar.collapse')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )
      })}
      
      <div className="flex-1 overflow-hidden">
        <ChatPanel
          projectId={selectedProject}
          featureName={selectedFeature}
          enabled={!isCollapsed}
          selectedAgent={selectedAgent}
        />
      </div>
    </aside>
  );
}
