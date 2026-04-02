import { Play } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import type { MessageContent } from '@/domain/models/chat';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

export function SpecCompleteVariant({ content, messageId }: VariantProps) {
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
