import { Save } from 'lucide-react';
import { submitEvalSave } from '@/infrastructure/http/api';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

export function EvalSaveVariant({ presented, resolved }: VariantProps) {
  const payload = (presented.payload ?? {}) as Record<string, any>;
  const evalType = payload.evalType as string | undefined;
  const evalContent = payload.evalContent as string | undefined;

  const state = useChoiceCardState({ presented, resolved });

  const handleSave = async () => {
    if (!state.selectedProject || !state.selectedFeature || !evalType || !evalContent || state.isSelected) return;

    state.setIsLoading(true);
    state.setLocalSelectedChoice('save');

    const cardId = presented.cardId;
    if (!cardId) {
      state.setIsLoading(false);
      return;
    }

    try {
      const response = await submitEvalSave(
        state.selectedProject,
        state.selectedFeature,
        cardId,
        evalType,
        evalContent,
      );
      const label = response.resolvedLabel || 'Saved';
      state.setLocalResolvedLabel(label);
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
    await state.persistToBackend('skip', 'Skipped');
  };

  return (
    <ChoiceCardShell
      theme="emerald"
      icon={<Save className="w-4 h-4" />}
      title={presented.prompt || 'Save evaluation report?'}
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
