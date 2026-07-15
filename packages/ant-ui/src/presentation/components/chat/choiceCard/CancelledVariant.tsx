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

  // Respect the BE's `canResume` verdict (job-type-aware: false for plan/visual
  // on infrastructure interruptions, which can only restart, not resume). Fall
  // back to `!!reason` only when the kanban interruption isn't loaded yet, so a
  // durable cancelled card from a genuinely-resumable job still offers Resume.
  const beCanResume = kanbanData?.interruption?.canResume;
  const resumeAllowed = beCanResume === undefined ? !!reason : beCanResume === true;
  const canResume = !isRunning && jobId && state.selectedProject && state.selectedFeature && resumeAllowed;

  const doResume = async () => {
    if (!state.selectedProject || !state.selectedFeature || !jobId) return;

    state.setIsLoading(true);
    const prevChoice = state.localSelectedChoice;
    const prevLabel = state.localResolvedLabel;
    state.setLocalSelectedChoice('resume');
    state.setLocalResolvedLabel(t('cancelled.resumed'));

    // Snapshot the dismissed marker so a FAILED resume can roll it back —
    // otherwise the optimistic set below hides the (still-live) interruption
    // locally while the BE still holds `paused`, and the card silently vanishes.
    const prevDismissed = useStore.getState().dismissedInterruptTimestamp;
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
      setDismissedInterruptTimestamp(prevDismissed);
      state.setLocalSelectedChoice(prevChoice);
      state.setLocalResolvedLabel(prevLabel);
    } finally {
      state.setIsLoading(false);
    }
  };

  const handleResume = async () => {
    if (!canResume || state.isSelected) return;
    await doResume();
  };

  const handleDismiss = async () => {
    if (state.isSelected || !state.selectedProject || !state.selectedFeature || !jobId) return;

    state.setLocalSelectedChoice('dismiss');
    state.setLocalResolvedLabel(t('cancelled.dismissed'));

    const prevDismissed = useStore.getState().dismissedInterruptTimestamp;
    if (kanbanData?.interruption?.timestamp) {
      setDismissedInterruptTimestamp(kanbanData.interruption.timestamp);
    }

    try {
      await dismissInterruptedJob(state.selectedProject, state.selectedFeature, jobId);
      await state.persistToBackend('dismiss', t('cancelled.dismissed'));
    } catch (error) {
      console.error('[ChoiceCard:Cancelled] Failed:', error);
      // Roll back the optimistic dismissal so a failed dismiss doesn't hide a
      // still-live interruption until the next kanban poll.
      setDismissedInterruptTimestamp(prevDismissed);
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

  // Dismissed work stays explicitly resumable (interruption.dismissed is
  // orthogonal to canResume on the BE) — offer a subdued re-open action on
  // the resolved card, but only while the kanban still points at this job
  // (a later job replaces the session state and the /resume would 404).
  const canReopen =
    state.selectedChoice === 'dismiss' &&
    !!jobId &&
    !isRunning &&
    kanbanData?.jobId === jobId;

  const reopenAction = canReopen ? (
    <div className="flex justify-center pt-2">
      <button
        onClick={() => { void doResume(); }}
        disabled={state.isLoading}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-colors disabled:opacity-50"
        style={{ color: 'var(--text-3)', border: '1px solid var(--border-1)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-1)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-3)'; }}
      >
        <Play className="w-3 h-3" fill="currentColor" />
        {state.isLoading ? t('cancelled.resuming') : t('cancelled.reopen')}
      </button>
    </div>
  ) : null;

  return (
    <ChoiceCardShell
      theme="orange"
      icon={<XCircle className="w-4 h-4" />}
      title={title}
      subtitle={subtitle}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={resolvedIcon}
      resolvedExtra={reopenAction}
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
