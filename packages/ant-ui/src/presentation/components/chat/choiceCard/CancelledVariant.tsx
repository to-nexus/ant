import { useTranslation } from 'react-i18next';
import { Play, XCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { dismissInterruptedJob, resumeJob } from '@/infrastructure/http/api';
import type { VariantProps, ResolvedIcon } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';
import { Slot } from '@/presentation/extensions/slots';

export function CancelledVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('chat');
  const isRunning = useStore(state => state.isRunning);
  const kanbanData = useStore(state => state.kanban);
  const setDismissedInterruptTimestamp = useStore(state => state.setDismissedInterruptTimestamp);

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const jobId = payload.jobId as string | undefined;
  const originalType = payload.originalType as string | undefined;
  const reason = payload.reason as string | undefined;
  const designErrorType = payload.designErrorType as string | undefined;

  const state = useChoiceCardState({ presented, resolved });

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
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] Failed:', error);
      state.setLocalSelectedChoice(null);
      state.setLocalResolvedLabel(null);
    }
  };

  const subtitle = (() => {
    if (reason) {
      const reasonSubtitle = t(`cancelled.subtitles.${reason}`, { defaultValue: '' });
      if (reasonSubtitle) return reasonSubtitle;
    }
    return presented.prompt || t('cancelled.defaultSubtitle');
  })();

  // Surface the precise per-task failure detail (BE interruption.message) that
  // the static reason-subtitle would otherwise discard — e.g. WHICH tasks were
  // hit by an Anthropic overload. Shown only when it adds info beyond subtitle.
  const detail = (() => {
    const prompt = presented.prompt?.trim();
    if (!prompt || prompt === subtitle) return null;
    return prompt;
  })();

  const resolvedIcon: ResolvedIcon =
    state.selectedChoice === 'dismiss' ? 'dismiss' :
    state.selectedChoice === 'resume' ? 'resume' : null;

  return (
    <ChoiceCardShell
      theme="orange"
      icon={<XCircle className="w-4 h-4" />}
      title={title}
      subtitle={subtitle}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={resolvedIcon}
    >
      {detail && (
        <div
          className="text-xs mb-3 whitespace-pre-line"
          style={{ color: 'var(--text-2)' }}
        >
          {detail}
        </div>
      )}
      {/* Credit exhaustion — surface the recharge CTA so the user can top up
          before resuming. Resume itself stays available (it 402s until paid). */}
      {reason === 'insufficient_credits' && <Slot name="chat.rechargeCta" className="mb-3" />}
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
