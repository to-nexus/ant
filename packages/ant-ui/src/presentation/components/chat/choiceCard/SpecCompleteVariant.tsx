import { Play } from 'lucide-react';
import { useStore } from '@/domain/store';
import { useJobExecution } from '@/application/hooks/features/useJobExecution';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

export function SpecCompleteVariant({ presented, resolved }: VariantProps) {
  const setSelectedJobType = useStore(state => state.setSelectedJobType);
  const { runJob } = useJobExecution();
  const state = useChoiceCardState({ presented, resolved });

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const specFile = (payload.specFile as string | undefined) || 'spec.md';

  const handleDevelop = async () => {
    if (!state.selectedProject || !state.selectedFeature || state.isSelected) return;
    state.setIsLoading(true);
    state.setLocalSelectedChoice('develop');
    const label = `Starting development with ${specFile}`;
    state.setLocalResolvedLabel(label);
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
    await state.persistToBackend('later', 'Dismissed');
  };

  return (
    <ChoiceCardShell
      theme="emerald"
      icon={<Play className="w-4 h-4" />}
      title={presented.prompt || 'Spec Complete'}
      subtitle={`outputs/design/spec/${specFile}`}
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
