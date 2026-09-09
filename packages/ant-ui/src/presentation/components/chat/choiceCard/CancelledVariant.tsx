import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, XCircle } from 'lucide-react';
import { useStore } from '@/domain/store';
import { dismissInterruptedJob } from '@/infrastructure/http/api';
import { useResumeJob } from '@/application/hooks/features/useResumeJob';
import type { VariantProps, ResolvedIcon } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout, JobIdChip } from './shared';
import { Slot } from '@/presentation/extensions/slots';

export function CancelledVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('chat');
  const { resume } = useResumeJob();
  const isRunning = useStore(state => state.isRunning);
  const kanbanData = useStore(state => state.kanban);
  const setDismissedInterruptTimestamp = useStore(state => state.setDismissedInterruptTimestamp);
  // Set when a reopen attempt 404'd — the work is genuinely gone (deleted /
  // never archived), so the pill degrades to a muted note instead of a
  // permanently-failing button.
  const [reopenUnavailable, setReopenUnavailable] = useState(false);

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const jobId = payload.jobId as string | undefined;
  const originalType = payload.originalType as string | undefined;
  const reason = payload.reason as string | undefined;
  const designErrorType = payload.designErrorType as string | undefined;
  const payloadCanResume = payload.canResume as boolean | undefined;
  const resumeGranularity = payload.resumeGranularity as 'mid-graph' | 'turn' | undefined;

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

  // The BE's `canResume` verdict, in order of authority:
  //   1. the card's own durable payload — job-scoped and reload-proof
  //   2. the live kanban interruption
  //   3. `!!reason` — ONLY for cards written before (1) existed
  // (3) is a guess, and it guessed wrong for every universal job: the kanban
  // interruption is permanently absent there, so the card offered a Resume the
  // route refused. Legacy cards keep it so a genuinely-resumable old card does
  // not lose its button; new cards never reach it.
  const beCanResume = payloadCanResume ?? kanbanData?.interruption?.canResume;
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

      // Failures are surfaced by the resume owner — this card used to swallow
      // everything but a 404 into the console, which is what made a refused
      // resume look like a dead button.
      const outcome = await resume(jobId, state.selectedProject, state.selectedFeature);
      if (!outcome.ok) {
        useStore.getState().setRunning(false);
        setDismissedInterruptTimestamp(prevDismissed);
        state.setLocalSelectedChoice(prevChoice);
        state.setLocalResolvedLabel(prevLabel);
        // The work is genuinely gone — degrade the pill instead of leaving a
        // permanently-failing button.
        if (outcome.gone) setReopenUnavailable(true);
        return;
      }

      await state.persistToBackend('resume', t('cancelled.resumed'));

      if (outcome.jobType && outcome.jobType !== useStore.getState().selectedJobType) {
        useStore.setState({ jobStartPending: true });
        useStore.getState().setSelectedJobType(outcome.jobType);
      }

      useStore.getState().setRunning(true, outcome.jobId);
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
  // the resolved card. The card's own durable payload.jobId is the gate; the
  // old `kanban.jobId === jobId` coupling silently killed the pill across
  // reloads / job-tab switches / identity-less kanban frames, and the BE's
  // superseded-state archive keeps /resume valid even after later jobs. A
  // genuinely-gone job 404s once and the pill degrades to a muted note.
  const canReopen =
    state.selectedChoice === 'dismiss' &&
    !!jobId &&
    !isRunning &&
    !reopenUnavailable;

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
  ) : reopenUnavailable && state.selectedChoice === 'dismiss' ? (
    <div className="flex justify-center pt-2">
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>
        {t('cancelled.reopenUnavailable')}
      </span>
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
      // Every interruption card carries its job id so the user always knows
      // which job was stopped/dismissed — shown resolved or unresolved.
      headerMeta={jobId ? <JobIdChip jobId={jobId} /> : undefined}
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
          positiveLabel={
            resumeGranularity === 'turn' ? t('cancelled.rerunTurn') : t('cancelled.resume')
          }
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
