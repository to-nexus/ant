import { ClipboardList } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UNIVERSAL_FEATURE } from '@ant/shared';
import { useStore } from '@/domain/store';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, VerticalChoiceLayout } from './shared';
import { planContinuationPins } from './planContinuation';

/**
 * plan_complete — a universal plan turn (`@plan`) finished and wrote plan
 * docs. Claude Code's post-plan trio adapted to ANT: proceed (auto-accept),
 * review & edit (ANT's approval surface is the composer, so "manual
 * approval" = arm chips + prefill and let the user edit before sending),
 * keep planning (re-arm `@plan`), plus a dismiss.
 *
 * Everything pins from the CARD PAYLOAD, never the current store selection —
 * the composer's (agent, job) pair and chips may have drifted since this
 * card landed.
 */
export function PlanCompleteVariant({ presented, resolved }: VariantProps) {
  const { t } = useTranslation('chat');
  const state = useChoiceCardState({ presented, resolved });

  const payload = (presented.payload ?? {}) as Record<string, unknown>;
  const planFiles = Array.isArray(payload.planFiles)
    ? (payload.planFiles as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  const customJobRef = typeof payload.customJobRef === 'string' ? payload.customJobRef : undefined;
  const pins = planContinuationPins(payload);
  const directive = t('universal.planComplete.proceedDirective', { files: planFiles.join(', ') });

  /** Align the composer/SSE identity with the card's (agent, job) pair.
   *  MUST run before mention-arming — a pair switch wipes universalTurnMeta. */
  const alignJobPair = (): boolean => {
    if (!customJobRef) return false;
    const [agentId, jobId] = customJobRef.split('/');
    if (!agentId || !jobId) return false;
    const store = useStore.getState();
    store.selectCustomJob(agentId, jobId);
    if (store.selectedJobType !== 'universal' || store.selectedAgent !== 'universal') {
      store.applyJobIdentity({ jobType: 'universal', agent: 'universal' });
    }
    return true;
  };

  const handleProceed = async () => {
    if (!state.selectedProject || state.isSelected || state.isLoading) return;
    if (!alignJobPair()) return;
    state.setIsLoading(true);
    state.setLocalSelectedChoice('proceed');

    const store = useStore.getState();
    store.setRunning(true, undefined, 'generate');

    try {
      // Post the user_turn first; the pre-allocated turnId MUST ride to the
      // job start (BE chat-copy dedup keys on turnId — a worker minting its
      // own id appends a second user_turn).
      const { turnId } = await addChatUserMessage(
        state.selectedProject,
        UNIVERSAL_FEATURE,
        directive,
        undefined,
        'universal',
      );

      const jobExecution = executeCodeJob({
        projectId: state.selectedProject,
        featureName: UNIVERSAL_FEATURE,
        jobType: 'universal',
        agent: 'universal',
        overrideDirective: directive,
        chatSource: true,
        skipTriage: true,
        customJobRef,
        intents: pins.intents,
        context: pins.context,
        seedTurnId: turnId,
      });

      store.setCurrentJob(jobExecution);
      jobExecution.onJobIdReady((jobId) => {
        useStore.getState().setRunning(true, jobId);
      });
      jobExecution.on('exit', (code, _signal) => {
        const jobFailed = code !== 0 && code !== null;
        useStore.getState().setLastJobFailed(jobFailed);
        useStore.getState().setRunning(false);
        useStore.getState().setCurrentJob(null);
      });

      // Resolve AFTER a successful dispatch — persisting first would take the
      // per-cardId NX lock and brick the card for 24h if the launch fails.
      const label = t('universal.planComplete.resolvedProceed');
      state.setLocalResolvedLabel(label);
      await state.persistToBackend('proceed', label);
    } catch (error) {
      console.error('[ChoiceCard:PlanComplete] Failed to start follow-up universal turn:', error);
      useStore.getState().setRunning(false);
      state.setLocalSelectedChoice(null);
    } finally {
      state.setIsLoading(false);
    }
  };

  const handleEdit = async () => {
    if (state.isSelected || state.isLoading) return;
    if (!alignJobPair()) return;
    const store = useStore.getState();
    store.setUniversalPlanMention(false);
    pins.intents?.forEach((i) => store.addUniversalIntentMention(i));
    pins.context?.forEach((p) => store.addUniversalContextMention(p));
    store.setPendingChatInput({ message: directive, source: 'plan_complete' });

    const label = t('universal.planComplete.resolvedEdit');
    state.setLocalSelectedChoice('edit');
    state.setLocalResolvedLabel(label);
    await state.persistToBackend('edit', label);
  };

  const handleKeepPlanning = async () => {
    if (state.isSelected || state.isLoading) return;
    if (!alignJobPair()) return;
    const store = useStore.getState();
    store.setUniversalPlanMention(true);
    // No @ctx re-pin: resolve re-lists plan/{agentId}/{jobId}/ into the
    // Plan Documents band on every turn — prior docs reach the next plan
    // turn without being pinned.
    pins.intents?.forEach((i) => store.addUniversalIntentMention(i));

    const label = t('universal.planComplete.resolvedKeepPlanning');
    state.setLocalSelectedChoice('keep_planning');
    state.setLocalResolvedLabel(label);
    await state.persistToBackend('keep_planning', label);
  };

  const handleLater = async () => {
    if (state.isSelected) return;
    const label = t('universal.planComplete.dismissed');
    state.setLocalSelectedChoice('later');
    state.setLocalResolvedLabel(label);
    await state.persistToBackend('later', label);
  };

  return (
    <ChoiceCardShell
      theme="violet"
      icon={<ClipboardList className="w-4 h-4" />}
      title={presented.prompt || 'Plan Complete'}
      subtitle={planFiles.join('\n')}
      isSelected={state.isSelected}
      resolvedLabel={state.resolvedLabel}
      resolvedIcon={state.selectedChoice === 'later' ? 'dismiss' : 'resume'}
    >
      <VerticalChoiceLayout
        theme="violet"
        positiveLabel={t('universal.planComplete.proceed')}
        neutralLabel={t('universal.planComplete.edit')}
        negativeLabel={t('universal.planComplete.keepPlanning')}
        isLoading={state.isLoading}
        loadingAction={state.isLoading ? 'positive' : null}
        loadingLabel={t('universal.planComplete.proceedLoading')}
        onPositive={handleProceed}
        onNeutral={handleEdit}
        onNegative={handleKeepPlanning}
        dismissLabel={t('universal.planComplete.later')}
        onDismiss={handleLater}
      />
    </ChoiceCardShell>
  );
}

