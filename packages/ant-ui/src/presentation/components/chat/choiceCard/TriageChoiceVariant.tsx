import { useState } from 'react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import { submitTriageChoice, TriageChoiceAction } from '@/infrastructure/http/api';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout, VerticalChoiceLayout } from './shared';

export function TriageChoiceVariant({ content, messageId }: VariantProps) {
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
        setSelectedJobType(response.suggestedJob as any);
      }

      if (response.type === 'continue' && response.action === 'proceedAnyway') {
        const currentAgent = useStore.getState().selectedAgent;
        const currentJob = useStore.getState().selectedJobType;
        const label = '진행됨';
        state.setLocalResolvedLabel(label);
        state.persistChoice(options.positive.action, label);
        await runJob(currentAgent, currentJob, response.directive, { skipTriage: true });
      }

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
