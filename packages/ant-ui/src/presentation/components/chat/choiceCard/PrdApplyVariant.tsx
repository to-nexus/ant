import { FileCheck } from 'lucide-react';
import { submitPrdApply } from '@/infrastructure/http/api';
import type { MessageContent } from '@/domain/models/chat';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

export function PrdApplyVariant({ content, messageId }: VariantProps) {
  const state = useChoiceCardState({
    content, messageId,
    contentType: 'choice_card',
    contentFilter: (c: MessageContent) => c.type === 'choice_card' && c.metadata?.cardType === 'prd_apply',
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
