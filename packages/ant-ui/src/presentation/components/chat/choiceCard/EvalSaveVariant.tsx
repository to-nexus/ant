import { Save } from 'lucide-react';
import { submitEvalSave } from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

export function EvalSaveVariant({ content, messageId }: VariantProps) {
  const evalType = content.metadata?.evalType;
  const evalContent = content.metadata?.evalContent;

  const state = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'eval_save',
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
