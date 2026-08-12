import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { useStore } from '@/domain/store';
import { resumeJob, executeJob } from '@/infrastructure/http/api';
import type { VariantProps, ResolvedIcon } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout, JobIdChip } from './shared';

/**
 * Resume-consent card — presented when the BE inline-ask dispatch classified
 * a chat turn as an explicit request to resume an interrupted (possibly
 * dismissed) job. Consent to re-open dismissed work stays a CLICK:
 *   - Resume → POST /jobs/:id/resume (BE clears the dismissed marker).
 *   - Start new → the turn's directive runs as a fresh job instead.
 *
 * Self-driven like CancelledVariant (no ChoiceService round-trip — there is
 * no pending in-graph choice behind this card).
 */
export function ResumeConfirmVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('chat');
  const isRunning = useStore(state => state.isRunning);
  const [loadingAction, setLoadingAction] = useState<'resume' | 'newJob' | null>(null);

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const resumeJobId = payload.resumeJobId as string | undefined;
  const resumeJobType = payload.resumeJobType as string | undefined;
  const originalDirective = payload.originalDirective as string | undefined;

  const state = useChoiceCardState({ presented, resolved });

  const handleResume = async () => {
    if (!state.selectedProject || !state.selectedFeature || !resumeJobId || state.isSelected) return;

    state.setIsLoading(true);
    setLoadingAction('resume');
    const prevChoice = state.localSelectedChoice;
    const prevLabel = state.localResolvedLabel;
    state.setLocalSelectedChoice('resume');
    state.setLocalResolvedLabel(t('resumeConfirm.resumed'));

    try {
      useStore.getState().setRunning(true, resumeJobId);
      const result = await resumeJob(resumeJobId, state.selectedProject, state.selectedFeature, true);
      await state.persistToBackend('resume', t('resumeConfirm.resumed'));

      if (result.jobType && result.jobType !== useStore.getState().selectedJobType) {
        useStore.setState({ jobStartPending: true });
        useStore.getState().setSelectedJobType(result.jobType);
      }
      useStore.getState().setRunning(true, result.jobId);
      useStore.getState().setLastJobFailed(false);
    } catch (error) {
      console.error('[ChoiceCard:ResumeConfirm] Resume failed:', error);
      useStore.getState().setRunning(false);
      state.setLocalSelectedChoice(prevChoice);
      state.setLocalResolvedLabel(prevLabel);
    } finally {
      state.setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const handleNewJob = async () => {
    if (!state.selectedProject || !state.selectedFeature || state.isSelected) return;

    state.setIsLoading(true);
    setLoadingAction('newJob');
    const prevChoice = state.localSelectedChoice;
    const prevLabel = state.localResolvedLabel;
    state.setLocalSelectedChoice('newJob');
    state.setLocalResolvedLabel(t('resumeConfirm.startedNew'));

    try {
      const s = useStore.getState() as any;
      const result = await executeJob({
        projectId: state.selectedProject,
        featureName: state.selectedFeature,
        jobType: s.selectedJobType || resumeJobType || 'code',
        agent: s.selectedAgent || 'architect',
        overrideDirective: originalDirective,
        chatSource: true,
      });
      await state.persistToBackend('newJob', t('resumeConfirm.startedNew'));
      useStore.getState().setRunning(true, result.jobId);
      useStore.getState().setLastJobFailed(false);
    } catch (error) {
      console.error('[ChoiceCard:ResumeConfirm] New job failed:', error);
      useStore.getState().setRunning(false);
      state.setLocalSelectedChoice(prevChoice);
      state.setLocalResolvedLabel(prevLabel);
    } finally {
      state.setIsLoading(false);
      setLoadingAction(null);
    }
  };

  const resolvedIcon: ResolvedIcon = state.selectedChoice === 'resume' ? 'resume' : null;

  const subtitle = originalDirective
    ? t('resumeConfirm.subtitle', { directive: originalDirective })
    : undefined;

  return (
    <ChoiceCardShell
      theme="orange"
      icon={<Play className="w-4 h-4" fill="currentColor" />}
      title={t('resumeConfirm.title', {
        work: resumeJobType ? t(`cancelled.work.${resumeJobType}`, { defaultValue: resumeJobType }) : '',
      })}
      subtitle={subtitle}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={resolvedIcon}
      headerMeta={resumeJobId ? <JobIdChip jobId={resumeJobId} /> : undefined}
    >
      <TwoButtonLayout
        theme="orange"
        positiveLabel={t('resumeConfirm.resume')}
        positiveIcon={<Play className="w-4 h-4" fill="currentColor" />}
        positiveLoadingLabel={loadingAction === 'resume' ? t('cancelled.resuming') : undefined}
        negativeLabel={t('resumeConfirm.newJob')}
        isLoading={state.isLoading}
        disablePositive={isRunning}
        onPositive={handleResume}
        onNegative={handleNewJob}
      />
    </ChoiceCardShell>
  );
}
