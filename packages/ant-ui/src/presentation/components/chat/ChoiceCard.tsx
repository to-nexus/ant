/**
 * ChoiceCard - Unified choice card component
 * 
 * Architecture:
 *   useChoiceCardState()  — shared state management (loading, selected, persist, dismiss)
 *   ChoiceCardShell       — shared layout (header icon + title + subtitle + buttons/resolved)
 *   TwoButtonLayout       — shared two-button action layout
 *   Variant components    — thin wrappers providing config + handlers
 * 
 * ✅ Multi-pod safe:
 *   - All choice actions (positive AND negative) persist to backend via dismiss-choice endpoint
 *   - metadataFilter ensures correct content targeting when multiple contents share same type
 *   - Backend saves to chat.json + Redis + broadcasts via SSE
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Play, Loader2, XCircle, Save, FileCheck } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import {
  submitTriageChoice,
  submitEvalSave,
  submitPrdApply,
  submitChoiceDismiss,
  dismissInterruptedJob,
  resumeJob,
  TriageChoiceAction,
} from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';

type ChoiceVariant = 'triage_choice' | 'cancelled' | 'eval_save' | 'prd_apply' | 'clarifying' | 'spec_complete';

interface ChoiceCardProps {
  content: MessageContent;
  variant: ChoiceVariant;
  messageId: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Hook: useChoiceCardState
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface UseChoiceCardStateParams {
  content: MessageContent;
  messageId: string;
  /** Content type for metadata lookup (e.g. 'triage_choice', 'cancelled', 'choice_card') */
  contentType: string;
  /** Extra filter for Zustand content matching (e.g. metadata.cardType === 'eval_save') */
  contentFilter?: (c: MessageContent) => boolean;
  /** Metadata filter for backend API — ensures correct content targeting in multi-pod */
  metadataFilter?: Record<string, string>;
}

function useChoiceCardState({ content, messageId, contentType, contentFilter, metadataFilter }: UseChoiceCardStateParams) {
  const selectedProject = useStore(state => state.selectedProject);
  const selectedFeature = useStore(state => state.selectedFeature);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const chatMessages = useStore(state => state.chatMessages);

  const [isLoading, setIsLoading] = useState(false);
  const [localSelectedChoice, setLocalSelectedChoice] = useState<string | null>(null);
  const [localResolvedLabel, setLocalResolvedLabel] = useState<string | null>(null);

  // Source of truth: metadata (persisted) > local state (optimistic)
  const selectedChoice = content.metadata?.choiceSelected || localSelectedChoice;
  const resolvedLabel = content.metadata?.resolvedLabel || localResolvedLabel;
  const isSelected = !!selectedChoice;

  /** Persist choice to Zustand store (prevents Virtuoso remount reset) */
  const persistChoice = useCallback((choiceAction: string, label: string) => {
    const message = chatMessages.find(m => m.id === messageId);
    if (!message) return;

    const matchFn = contentFilter
      || ((c: MessageContent) => c.type === contentType);

    const contentIndex = message.contents.findIndex(matchFn);
    if (contentIndex === -1) return;

    const updatedContents = [...message.contents];
    updatedContents[contentIndex] = {
      ...updatedContents[contentIndex],
      metadata: {
        ...updatedContents[contentIndex].metadata,
        choiceSelected: choiceAction,
        resolvedLabel: label,
      },
    };
    updateChatMessage(messageId, { contents: updatedContents });
  }, [chatMessages, messageId, contentType, contentFilter, updateChatMessage]);

  /**
   * Persist choice to backend via unified dismiss-choice endpoint.
   * ✅ Multi-pod safe: metadataFilter ensures correct content is updated
   * when multiple contents share the same type (e.g., choice_card subtypes).
   */
  const persistToBackend = useCallback(async (choiceAction: string, label: string, extraMetadata?: Record<string, any>) => {
    if (!selectedProject || !selectedFeature) return;
    try {
      await submitChoiceDismiss(
        selectedProject, selectedFeature,
        contentType, choiceAction, label,
        metadataFilter,
        extraMetadata
      );
    } catch (error) {
      console.warn('[ChoiceCard] dismiss-choice API failed (non-blocking):', error);
      // Non-blocking: local persist already done, backend will catch up on next SSE sync
    }
  }, [selectedProject, selectedFeature, contentType, metadataFilter]);

  return {
    selectedProject,
    selectedFeature,
    isLoading,
    setIsLoading,
    selectedChoice,
    resolvedLabel,
    isSelected,
    localSelectedChoice,
    setLocalSelectedChoice,
    localResolvedLabel,
    setLocalResolvedLabel,
    persistChoice,
    persistToBackend,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared Layout: ChoiceCardShell
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type ThemeColor = 'blue' | 'orange' | 'emerald' | 'violet';

interface ThemeConfig {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  buttonBg: string;
}

const THEMES: Record<ThemeColor, ThemeConfig> = {
  blue: {
    bg: 'from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-blue-200 dark:border-gray-700',
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    buttonBg: 'bg-blue-500 hover:bg-blue-600',
  },
  orange: {
    bg: 'from-orange-50 to-amber-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-orange-200 dark:border-orange-800/50',
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
    buttonBg: 'bg-orange-500 hover:bg-orange-600',
  },
  emerald: {
    bg: 'from-emerald-50 to-teal-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-emerald-200 dark:border-emerald-800/50',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    buttonBg: 'bg-emerald-500 hover:bg-emerald-600',
  },
  violet: {
    bg: 'from-violet-50 to-purple-50 dark:from-gray-800 dark:to-gray-900',
    border: 'border-violet-200 dark:border-violet-800/50',
    iconBg: 'bg-violet-100 dark:bg-violet-900/30',
    iconColor: 'text-violet-600 dark:text-violet-400',
    buttonBg: 'bg-violet-500 hover:bg-violet-600',
  },
};

type ResolvedIcon = 'dismiss' | 'resume' | null;

interface ResolvedBadgeProps {
  label: string;
  icon?: ResolvedIcon;
}

function ResolvedBadge({ label, icon }: ResolvedBadgeProps) {
  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-600">
      <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700">
          {icon === 'dismiss' && <XCircle className="w-3.5 h-3.5" />}
          {icon === 'resume' && <Play className="w-3.5 h-3.5" />}
          {label}
        </span>
      </div>
    </div>
  );
}

interface ChoiceCardShellProps {
  theme: ThemeColor;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  // Resolved state
  isSelected: boolean;
  resolvedLabel: string | null;
  resolvedIcon?: ResolvedIcon;
  // Content area (buttons) — rendered when not selected
  children: React.ReactNode;
}

function ChoiceCardShell({
  theme, icon, title, subtitle,
  isSelected, resolvedLabel, resolvedIcon,
  children,
}: ChoiceCardShellProps) {
  const t = THEMES[theme];

  return (
    <div className={`choice-card bg-gradient-to-br ${t.bg} rounded-xl p-4 border ${t.border} shadow-sm`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`flex-shrink-0 w-8 h-8 rounded-full ${t.iconBg} flex items-center justify-center`}>
          <span className={t.iconColor}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 prose prose-sm dark:prose-invert max-w-none [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {title}
            </ReactMarkdown>
          </div>
          {subtitle && (
            <div className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 whitespace-pre-line">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Resolved badge OR action buttons */}
      {isSelected && resolvedLabel ? (
        <ResolvedBadge label={resolvedLabel} icon={resolvedIcon} />
      ) : (
        children
      )}
    </div>
  );
}

/** Standard two-button layout used by most variants */
function TwoButtonLayout({
  positiveLabel,
  positiveIcon,
  positiveLoadingLabel,
  negativeLabel,
  isLoading,
  onPositive,
  onNegative,
  disablePositive,
  theme,
}: {
  positiveLabel: string;
  positiveIcon?: React.ReactNode;
  positiveLoadingLabel?: string;
  negativeLabel: string;
  isLoading: boolean;
  onPositive: () => void;
  onNegative: () => void;
  disablePositive?: boolean;
  theme: ThemeColor;
}) {
  const t = THEMES[theme];
  return (
    <div className="flex gap-3">
      <button
        type="button"
        onClick={onPositive}
        disabled={isLoading || disablePositive}
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${t.buttonBg} text-white ${isLoading || disablePositive ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {positiveLoadingLabel || 'Processing...'}
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            {positiveIcon}
            {positiveLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onNegative}
        disabled={isLoading}
        className={`flex-1 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {negativeLabel}
      </button>
    </div>
  );
}

/** Vertical three-button layout for triage redirect with proceed option */
function VerticalChoiceLayout({
  positiveLabel,
  neutralLabel,
  negativeLabel,
  isLoading,
  loadingAction,
  onPositive,
  onNeutral,
  onNegative,
  theme,
}: {
  positiveLabel: string;
  neutralLabel: string;
  negativeLabel: string;
  isLoading: boolean;
  loadingAction: 'positive' | 'neutral' | null;
  onPositive: () => void;
  onNeutral: () => void;
  onNegative: () => void;
  theme: ThemeColor;
}) {
  const t = THEMES[theme];
  const disabled = isLoading;
  return (
    <div className="flex flex-col gap-2">
      {/* Positive: primary action (e.g. 전환) */}
      <button
        type="button"
        onClick={onPositive}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 ${t.buttonBg} text-white ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md'}`}
      >
        {isLoading && loadingAction === 'positive' ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            처리 중...
          </span>
        ) : (
          positiveLabel
        )}
      </button>
      {/* Neutral: continue with current mode (e.g. 현재 모드로 진행) */}
      <button
        type="button"
        onClick={onNeutral}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 border ${t.border} text-gray-700 dark:text-gray-200 bg-transparent ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:shadow-sm'}`}
      >
        {isLoading && loadingAction === 'neutral' ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            처리 중...
          </span>
        ) : (
          neutralLabel
        )}
      </button>
      {/* Negative: dismiss */}
      <button
        type="button"
        onClick={onNegative}
        disabled={disabled}
        className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-sm'}`}
      >
        {negativeLabel}
      </button>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Public Entry Point
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function ChoiceCard({ content, variant, messageId }: ChoiceCardProps) {
  switch (variant) {
    case 'triage_choice':
      return <TriageChoiceVariant content={content} messageId={messageId} />;
    case 'cancelled':
      return <CancelledChoiceVariant content={content} messageId={messageId} />;
    case 'eval_save':
      return <EvalSaveChoiceVariant content={content} messageId={messageId} />;
    case 'prd_apply':
      return <PrdApplyChoiceVariant content={content} messageId={messageId} />;
    case 'clarifying':
      return <ClarifyingVariant content={content} messageId={messageId} />;
    case 'spec_complete':
      return <SpecCompleteVariant content={content} messageId={messageId} />;
    default:
      return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: Triage Choice (blue theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function TriageChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const setSelectedJobType = useStore(state => state.setSelectedJobType);
  const { runJob } = useJobExecution();
  const [loadingAction, setLoadingAction] = useState<'positive' | 'neutral' | null>(null);

  const state = useChoiceCardState({
    content, messageId,
    contentType: 'triage_choice',
  });

  const jobId = content.metadata?.jobId;
  const options = content.metadata?.choiceOptions;
  if (!options) return null;

  const hasNeutral = !!options.neutral;

  const handlePositive = async () => {
    if (!state.selectedProject || !state.selectedFeature || !jobId || state.isSelected) return;

    state.setIsLoading(true);
    setLoadingAction('positive');
    state.setLocalSelectedChoice(options.positive.action);

    try {
      const response = await submitTriageChoice(
        state.selectedProject, state.selectedFeature, jobId,
        options.positive.action as TriageChoiceAction
      );

      // Handle redirect
      if (response.type === 'continue' && response.action === 'redirect' && response.suggestedJob) {
        const targetAgent = response.suggestedAgent || 'architect';
        const label = response.suggestedAgent
          ? `→ ${response.suggestedAgent} / ${response.suggestedJob}`
          : `→ ${response.suggestedJob} job`;
        state.setLocalResolvedLabel(label);
        state.persistChoice(options.positive.action, label);
        if (response.suggestedAgent) {
          useStore.getState().setSelectedAgent(response.suggestedAgent);
        }
        await runJob(targetAgent, response.suggestedJob, response.directive, { skipTriage: true });
        // Switch job type AFTER runJob so SSE reconnect reads fully-persisted metadata.
        // setSelectedJobType triggers reconnectSSE → initial_state full replace of chatMessages.
        setSelectedJobType(response.suggestedJob as any);
      }

      // Handle proceedAnyway: continue despite blocked status (skip triage to avoid loop)
      if (response.type === 'continue' && response.action === 'proceedAnyway') {
        const currentAgent = useStore.getState().selectedAgent;
        const currentJob = useStore.getState().selectedJobType;
        const label = '진행됨';
        state.setLocalResolvedLabel(label);
        state.persistChoice(options.positive.action, label);
        await runJob(currentAgent, currentJob, response.directive, { skipTriage: true });
      }

      // Handle guide
      if (response.type === 'guide') {
        const label = '가이드 제공됨';
        state.setLocalResolvedLabel(label);
        state.persistChoice(options.positive.action, label);
      }
    } catch (error) {
      console.error('[ChoiceCard:Triage] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const handleNeutral = async () => {
    if (!options.neutral) return;
    if (!state.selectedProject || !state.selectedFeature || !jobId || state.isSelected) return;

    state.setIsLoading(true);
    setLoadingAction('neutral');
    state.setLocalSelectedChoice(options.neutral.action);

    try {
      const response = await submitTriageChoice(
        state.selectedProject, state.selectedFeature, jobId,
        options.neutral.action as TriageChoiceAction
      );

      // Handle proceed: continue with current agent/job (skip triage to avoid loop)
      if (response.type === 'continue' && response.action === 'proceed') {
        const currentAgent = useStore.getState().selectedAgent;
        const currentJob = useStore.getState().selectedJobType;
        const label = '현재 모드로 진행';
        state.setLocalResolvedLabel(label);
        state.persistChoice(options.neutral.action, label);
        await runJob(currentAgent, currentJob, response.directive, { skipTriage: true });
      }
    } catch (error) {
      console.error('[ChoiceCard:Triage] Neutral failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const handleNegative = async () => {
    if (!state.selectedProject || !state.selectedFeature || !jobId || state.isSelected) return;

    state.setIsLoading(true);
    state.setLocalSelectedChoice(options.negative.action);

    try {
      const response = await submitTriageChoice(
        state.selectedProject, state.selectedFeature, jobId,
        options.negative.action as TriageChoiceAction
      );

      if (response.type === 'dismiss') {
        state.setLocalResolvedLabel('Dismissed');
        state.persistChoice(options.negative.action, 'Dismissed');
        useStore.getState().addChatMessage({
          id: `msg-dismiss-${Date.now()}`,
          role: 'assistant',
          contents: [{ type: 'text', content: response.message || '작업이 취소되었습니다. 새 작업을 요청해주세요.' }],
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[ChoiceCard:Triage] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
    }
  };

  const displayResolvedLabel = state.resolvedLabel || content.metadata?.resolvedLabel;

  return (
    <ChoiceCardShell
      theme="blue"
      icon={<span className="text-sm">🔀</span>}
      title={content.content || 'Choice required'}
      isSelected={state.isSelected}
      resolvedLabel={displayResolvedLabel || null}
      resolvedIcon={state.selectedChoice === options.negative.action ? 'dismiss' : null}
    >
      {hasNeutral ? (
        <VerticalChoiceLayout
          theme="blue"
          positiveLabel={options.positive.label}
          neutralLabel={options.neutral!.label}
          negativeLabel={options.negative.label}
          isLoading={state.isLoading}
          loadingAction={loadingAction}
          onPositive={handlePositive}
          onNeutral={handleNeutral}
          onNegative={handleNegative}
        />
      ) : (
        <TwoButtonLayout
          theme="blue"
          positiveLabel={options.positive.label}
          positiveLoadingLabel="처리 중..."
          negativeLabel={options.negative.label}
          isLoading={state.isLoading}
          onPositive={handlePositive}
          onNegative={handleNegative}
        />
      )}
    </ChoiceCardShell>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: Cancelled / Interrupted (orange theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function CancelledChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const { t } = useTranslation('chat');
  const isRunning = useStore(state => state.isRunning);
  const kanbanData = useStore(state => state.kanban);
  const setDismissedInterruptTimestamp = useStore(state => state.setDismissedInterruptTimestamp);

  const jobId = content.metadata?.jobId;

  const state = useChoiceCardState({
    content, messageId,
    contentType: 'cancelled',
    metadataFilter: jobId ? { jobId } : undefined,
  });

  const originalType = content.metadata?.originalType;
  const reason = content.metadata?.reason;
  const designErrorType = content.metadata?.designErrorType;

  const workLabel = (() => {
    if (!originalType) return null;
    const translated = t(`cancelled.work.${originalType}`, { defaultValue: '' });
    return translated || null;
  })();

  const title = (() => {
    if (designErrorType) {
      const errTitle = t(`cancelled.designErrors.${designErrorType}`, { defaultValue: '' });
      if (errTitle) return errTitle;
    }
    if (reason) {
      const reasonTitle = t(`cancelled.reasons.${reason}`, { defaultValue: '' });
      if (reasonTitle) return reasonTitle;
    }
    if (workLabel) {
      return t('cancelled.workCancelled', { work: workLabel });
    }
    return t('cancelled.taskCancelled');
  })();

  const canResume = !isRunning && jobId && state.selectedProject && state.selectedFeature && !!reason;

  const handleResume = async () => {
    if (!canResume || state.isSelected || !state.selectedProject || !state.selectedFeature || !jobId) return;

    state.setIsLoading(true);
    state.setLocalSelectedChoice('resume');
    state.setLocalResolvedLabel(t('cancelled.resumed'));

    try {
      if (kanbanData?.interruption?.timestamp) {
        setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
      }
      useStore.getState().setRunning(true, jobId);

      const result = await resumeJob(jobId, state.selectedProject, state.selectedFeature, true);

      await state.persistToBackend('resume', t('cancelled.resumed'));
      state.persistChoice('resume', t('cancelled.resumed'));

      if (result.jobType && result.jobType !== useStore.getState().selectedJobType) {
        useStore.setState({ jobStartPending: true });
        useStore.getState().setSelectedJobType(result.jobType);
      }

      useStore.getState().setRunning(true, result.jobId);
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] Failed:', error);
      useStore.getState().setRunning(false);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
    }
  };

  const handleDismiss = async () => {
    if (state.isSelected || !state.selectedProject || !state.selectedFeature || !jobId) return;

    state.setLocalSelectedChoice('dismiss');
    state.setLocalResolvedLabel(t('cancelled.dismissed'));

    if (kanbanData?.interruption?.timestamp) {
      setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
    }

    try {
      await dismissInterruptedJob(state.selectedProject, state.selectedFeature, jobId);
      await state.persistToBackend('dismiss', t('cancelled.dismissed'));
      state.persistChoice('dismiss', t('cancelled.dismissed'));
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    }
  };

  const resolvedIcon: ResolvedIcon =
    state.selectedChoice === 'dismiss' ? 'dismiss' :
    state.selectedChoice === 'resume' ? 'resume' : null;

  return (
    <ChoiceCardShell
      theme="orange"
      icon={<XCircle className="w-4 h-4" />}
      title={title}
      subtitle={content.content || t('cancelled.defaultSubtitle')}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={resolvedIcon}
    >
      {canResume && (
        <TwoButtonLayout
          theme="orange"
          positiveLabel={t('cancelled.resume')}
          positiveIcon={<Play className="w-4 h-4" fill="currentColor" />}
          positiveLoadingLabel={t('cancelled.resuming')}
          negativeLabel={t('cancelled.dismiss')}
          isLoading={state.isLoading}
          disablePositive={isRunning}
          onPositive={handleResume}
          onNegative={handleDismiss}
        />
      )}
    </ChoiceCardShell>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: Eval Save (emerald theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function EvalSaveChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const evalType = content.metadata?.evalType;
  const evalContent = content.metadata?.evalContent;

  const state = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'eval_save',
    // ✅ Multi-pod safe: filter by cardType to target eval_save, not prd_apply
    metadataFilter: { cardType: 'eval_save' },
  });

  const handleSave = async () => {
    if (!state.selectedProject || !state.selectedFeature || !evalType || !evalContent || state.isSelected) return;

    state.setIsLoading(true);
    state.setLocalSelectedChoice('save');

    try {
      const response = await submitEvalSave(state.selectedProject, state.selectedFeature, evalType, evalContent);
      const label = response.resolvedLabel || 'Saved';
      state.setLocalResolvedLabel(label);
      state.persistChoice('save', label);
    } catch (error) {
      console.error('[ChoiceCard:EvalSave] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
    }
  };

  const handleSkip = async () => {
    if (state.isSelected) return;
    state.setLocalSelectedChoice('skip');
    state.setLocalResolvedLabel('Skipped');
    state.persistChoice('skip', 'Skipped');
    // ✅ Persist to backend (chat.json + Redis)
    await state.persistToBackend('skip', 'Skipped');
  };

  return (
    <ChoiceCardShell
      theme="emerald"
      icon={<Save className="w-4 h-4" />}
      title={content.content || 'Save evaluation report?'}
      subtitle={`outputs/evals/${evalType}/`}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={state.selectedChoice === 'skip' ? 'dismiss' : null}
    >
      <TwoButtonLayout
        theme="emerald"
        positiveLabel="Save"
        positiveIcon={<Save className="w-4 h-4" />}
        positiveLoadingLabel="Saving..."
        negativeLabel="Skip"
        isLoading={state.isLoading}
        onPositive={handleSave}
        onNegative={handleSkip}
      />
    </ChoiceCardShell>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: PRD Apply (violet theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function PrdApplyChoiceVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const state = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'prd_apply',
    // ✅ Multi-pod safe: filter by cardType to target prd_apply, not eval_save
    metadataFilter: { cardType: 'prd_apply' },
  });

  const handleApply = async () => {
    if (!state.selectedProject || !state.selectedFeature || state.isSelected) return;

    state.setIsLoading(true);
    state.setLocalSelectedChoice('apply');

    try {
      const response = await submitPrdApply(state.selectedProject, state.selectedFeature);
      const label = response.resolvedLabel || 'Applied to inputs/sources/prd.md';
      state.setLocalResolvedLabel(label);
      state.persistChoice('apply', label);
    } catch (error) {
      console.error('[ChoiceCard:PrdApply] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    } finally {
      state.setIsLoading(false);
    }
  };

  const handleKeepDraft = async () => {
    if (state.isSelected) return;
    state.setLocalSelectedChoice('keep_draft');
    state.setLocalResolvedLabel('Kept as draft');
    state.persistChoice('keep_draft', 'Kept as draft');
    // ✅ Persist to backend (chat.json + Redis)
    await state.persistToBackend('keep_draft', 'Kept as draft');
  };

  return (
    <ChoiceCardShell
      theme="violet"
      icon={<FileCheck className="w-4 h-4" />}
      title={content.content || 'Apply PRD to inputs/sources/prd.md?'}
      subtitle="outputs/plan/prd-refine.md → inputs/sources/prd.md"
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={state.selectedChoice === 'keep_draft' ? 'dismiss' : null}
    >
      <TwoButtonLayout
        theme="violet"
        positiveLabel="Apply"
        positiveIcon={<FileCheck className="w-4 h-4" />}
        positiveLoadingLabel="Applying..."
        negativeLabel="Keep as draft"
        isLoading={state.isLoading}
        onPositive={handleApply}
        onNegative={handleKeepDraft}
      />
    </ChoiceCardShell>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: Spec Complete (emerald theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SpecCompleteVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const setSelectedJobType = useStore(state => state.setSelectedJobType);
  const { runJob } = useJobExecution();
  const state = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'spec_complete',
    metadataFilter: { cardType: 'spec_complete' },
  });

  const specFile = content.metadata?.specFile || 'spec.md';

  const handleDevelop = async () => {
    if (!state.selectedProject || !state.selectedFeature || state.isSelected) return;
    state.setIsLoading(true);
    state.setLocalSelectedChoice('develop');
    const label = `Starting development with ${specFile}`;
    state.setLocalResolvedLabel(label);
    state.persistChoice('develop', label);
    await state.persistToBackend('develop', label);

    try {
      await runJob('architect', 'code', `Implement ${specFile}`, { skipTriage: true });
    } catch (error) {
      console.error('[ChoiceCard:SpecComplete] Failed to start code job:', error);
    } finally {
      state.setIsLoading(false);
    }

    // Switch job type AFTER persist + runJob so SSE reconnect reads fully-persisted metadata.
    // setSelectedJobType triggers reconnectSSE → initial_state full replace of chatMessages.
    // If called before persist settles, the replacement can overwrite the local choice state.
    setSelectedJobType('code');
  };

  const handleLater = async () => {
    if (state.isSelected) return;
    state.setLocalSelectedChoice('later');
    state.setLocalResolvedLabel('Dismissed');
    state.persistChoice('later', 'Dismissed');
    await state.persistToBackend('later', 'Dismissed');
  };

  return (
    <ChoiceCardShell
      theme="emerald"
      icon={<Play className="w-4 h-4" />}
      title={content.content || 'Spec Complete'}
      subtitle={`outputs/design/${specFile}`}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={state.selectedChoice === 'later' ? 'dismiss' : 'resume'}
    >
      <TwoButtonLayout
        theme="emerald"
        positiveLabel="Start Development"
        positiveIcon={<Play className="w-4 h-4" />}
        positiveLoadingLabel="Starting..."
        negativeLabel="Later"
        isLoading={state.isLoading}
        onPositive={handleDevelop}
        onNegative={handleLater}
      />
    </ChoiceCardShell>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Variant: Clarifying Questions — Compound Card (violet theme)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Single question block inside the compound card.
 * Shows option buttons + inline free input toggle.
 */
function ClarifyQuestionBlock({
  questionIndex,
  question,
  options,
  selectedAnswer,
  disabled,
  resolvedAnswer,
  onSelect,
}: {
  questionIndex: number;
  question: string;
  options: string[];
  selectedAnswer: string | undefined;
  disabled: boolean;
  /** When provided (including null for skipped), renders in read-only resolved mode */
  resolvedAnswer?: string | null;
  onSelect: (index: number, answer: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [showFreeInput, setShowFreeInput] = useState(false);
  const [freeText, setFreeText] = useState('');
  const isFreeInputActive = showFreeInput || (selectedAnswer != null && !options.includes(selectedAnswer));

  const handleOptionClick = (option: string) => {
    if (disabled) return;
    setShowFreeInput(false);
    onSelect(questionIndex, option);
  };

  const handleFreeInputToggle = () => {
    if (disabled) return;
    setShowFreeInput(true);
    setFreeText('');
  };

  const handleFreeTextConfirm = () => {
    if (!freeText.trim()) return;
    onSelect(questionIndex, freeText.trim());
    setShowFreeInput(false);
  };

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFreeTextConfirm();
    }
  };

  // ── Resolved mode: show question + static answer badge ──
  if (resolvedAnswer !== undefined) {
    const isSkipped = resolvedAnswer === null;
    return (
      <div className="space-y-1.5">
        {question && (
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            Q{questionIndex + 1}: {question}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          {isSkipped ? (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 italic">
              {t('clarify.skipped')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
              <span className="text-violet-500">✓</span>
              {resolvedAnswer}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Interactive mode: option buttons + free input ──
  return (
    <div className="space-y-2">
      {/* Question label */}
      {question && (
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Q{questionIndex + 1}: {question}
        </div>
      )}

      {/* Option buttons (wrap) */}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option, idx) => {
          const isActive = selectedAnswer === option && !isFreeInputActive;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleOptionClick(option)}
              disabled={disabled}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
                ${isActive
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 hover:text-violet-700 dark:hover:text-violet-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isActive && <span className="mr-1">✓</span>}
              {option}
            </button>
          );
        })}

        {/* Free input toggle / inline input */}
        {isFreeInputActive ? (
          <div className="w-full flex gap-1.5 mt-1">
            <input
              type="text"
              autoFocus
              value={freeText || (selectedAnswer && !options.includes(selectedAnswer) ? selectedAnswer : '')}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={handleFreeTextKeyDown}
              onBlur={() => { if (freeText.trim()) handleFreeTextConfirm(); }}
              placeholder={t('clarify.freeInput')}
              disabled={disabled}
              className="flex-1 px-3 py-1.5 rounded-md text-xs border border-violet-300 dark:border-violet-600 
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:outline-none focus:ring-1 focus:ring-violet-400
                         disabled:opacity-50"
            />
            {selectedAnswer && !options.includes(selectedAnswer) && (
              <span className="flex items-center text-xs text-violet-500 font-medium px-1">✓</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleFreeInputToggle}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150
              bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400
              border border-dashed border-gray-300 dark:border-gray-600
              hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-600 dark:hover:text-violet-400
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            ✏️ {t('clarify.freeInput')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Compound clarifying card: shows all questions in one card.
 * Selections are stored in Zustand (shared with ChatInput for hybrid submit).
 */
function ClarifyingVariant({ content, messageId }: { content: MessageContent; messageId: string }) {
  const { t } = useTranslation('chat');
  const selectedAgent = useStore(state => state.selectedAgent);
  const selectedJobType = useStore(state => state.selectedJobType);
  const pendingAnswers = useStore(state => state.pendingClarifyAnswers);
  const setPendingClarifyAnswer = useStore(state => state.setPendingClarifyAnswer);
  const setPendingClarifyContext = useStore(state => state.setPendingClarifyContext);
  const clearPendingClarify = useStore(state => state.clearPendingClarify);
  const chatMessages = useStore(state => state.chatMessages);
  const updateChatMessage = useStore(state => state.updateChatMessage);
  const { runJob } = useJobExecution();

  const cardState = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying',
    metadataFilter: { cardType: 'clarifying' },
  });

  const blocks = content.metadata?.clarifyBlocks || [];
  const totalQuestions = blocks.length;
  const answeredCount = Object.keys(pendingAnswers).filter(
    k => Number(k) < totalQuestions && pendingAnswers[Number(k)]
  ).length;
  const allAnswered = answeredCount === totalQuestions;
  const hasAnyAnswer = answeredCount > 0;

  // Register question texts in store on mount (for ChatInput hybrid submit)
  useEffect(() => {
    if (blocks.length > 0 && !cardState.isSelected) {
      setPendingClarifyContext(blocks.map((b: { question: string }) => b.question));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOptionSelect = (questionIndex: number, answer: string) => {
    setPendingClarifyAnswer(questionIndex, answer);
  };

  const handleSubmitAll = async () => {
    if (!cardState.selectedProject || !cardState.selectedFeature || cardState.isSelected || !hasAnyAnswer) return;

    cardState.setIsLoading(true);

    // Build combined directive from all answered questions
    const parts = Object.entries(pendingAnswers)
      .sort(([a], [b]) => Number(a) - Number(b))
      .filter(([idx]) => Number(idx) < totalQuestions)
      .map(([idx, answer]) => `- ${blocks[Number(idx)].question}: ${answer}`);
    const directive = parts.join('\n');

    // Build per-question resolved answers map for display after submission
    const resolvedAnswers: Record<number, string> = {};
    Object.entries(pendingAnswers).forEach(([idx, answer]) => {
      if (Number(idx) < totalQuestions) resolvedAnswers[Number(idx)] = answer;
    });

    // Resolve card UI — persist answers alongside the summary label
    const label = allAnswered
      ? t('clarify.resolvedAll', { total: totalQuestions })
      : t('clarify.resolvedPartial', { answered: answeredCount, total: totalQuestions });
    cardState.setLocalSelectedChoice('submitted');
    cardState.setLocalResolvedLabel(label);

    // Extended persist: store resolvedAnswers in metadata for resolved display
    const message = chatMessages.find(m => m.id === messageId);
    if (message) {
      const matchFn = (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'clarifying';
      const contentIndex = message.contents.findIndex(matchFn);
      if (contentIndex !== -1) {
        const updatedContents = [...message.contents];
        updatedContents[contentIndex] = {
          ...updatedContents[contentIndex],
          metadata: {
            ...updatedContents[contentIndex].metadata,
            choiceSelected: 'submitted',
            resolvedLabel: label,
            resolvedAnswers,
          },
        };
        updateChatMessage(messageId, { contents: updatedContents });
      }
    }
    await cardState.persistToBackend('submitted', label, { resolvedAnswers });

    try {
      clearPendingClarify();
      await runJob(selectedAgent, selectedJobType, directive);
    } catch (error) {
      console.error('[ChoiceCard:Clarifying] Failed:', error);
    } finally {
      cardState.setIsLoading(false);
    }
  };

  // Card title
  const title = totalQuestions === 1
    ? blocks[0].question
    : t('clarify.title', { count: totalQuestions });

  // Retrieve persisted per-question answers from metadata (survives remounts & SSE reloads)
  const resolvedAnswers: Record<number, string> | undefined = content.metadata?.resolvedAnswers;
  const isResolved = cardState.isSelected && !!resolvedAnswers;

  return (
    <ChoiceCardShell
      theme="violet"
      icon={<span className="text-sm">💬</span>}
      title={title}
      isSelected={cardState.isSelected}
      // Pass null for clarify variant so children are always rendered (resolved Q&A display instead of generic badge)
      resolvedLabel={cardState.isSelected && !resolvedAnswers ? cardState.resolvedLabel : null}
      resolvedIcon={null}
    >
      <div className="space-y-4">
        {/* Question blocks — resolved mode shows static Q&A, interactive mode shows buttons */}
        {blocks.map((block, idx) => {
          // In resolved state: string for answered, null for skipped, undefined for interactive
          const resolvedAnswer = isResolved
            ? (resolvedAnswers[idx] ?? null)
            : undefined;
          return (
            <ClarifyQuestionBlock
              key={idx}
              questionIndex={idx}
              question={totalQuestions === 1 ? '' : block.question}
              options={block.options}
              selectedAnswer={pendingAnswers[idx]}
              disabled={cardState.isLoading || cardState.isSelected}
              resolvedAnswer={resolvedAnswer}
              onSelect={handleOptionSelect}
            />
          );
        })}

        {/* Submit button — hidden when resolved */}
        {!isResolved && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleSubmitAll}
              disabled={!hasAnyAnswer || cardState.isLoading || cardState.isSelected}
              className={`w-full px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200
                ${hasAnyAnswer
                  ? 'bg-violet-500 hover:bg-violet-600 text-white hover:shadow-md'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }
                ${cardState.isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {cardState.isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('clarify.submitting')}
                </span>
              ) : allAnswered ? (
                t('clarify.submitAll', { answered: totalQuestions, total: totalQuestions })
              ) : hasAnyAnswer ? (
                t('clarify.submitPartial', { answered: answeredCount, total: totalQuestions })
              ) : (
                t('clarify.submitEmpty', { total: totalQuestions })
              )}
            </button>
            {hasAnyAnswer && !allAnswered && (
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-1.5">
                {t('clarify.partialHint')}
              </p>
            )}
          </div>
        )}
      </div>
    </ChoiceCardShell>
  );
}

export default ChoiceCard;
