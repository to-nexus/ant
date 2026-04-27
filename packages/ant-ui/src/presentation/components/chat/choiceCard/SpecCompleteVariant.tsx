import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ActionMetadata, Domain, IntentId } from '@ant/shared';
import { INTENT_DEFINITIONS } from '@ant/shared';
import { useStore } from '@/domain/store';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { executeCodeJob } from '@/infrastructure/http/cli';
import type { VariantProps } from './shared';
import { useChoiceCardState, ChoiceCardShell, TwoButtonLayout } from './shared';

const SPEC_INTENT: IntentId = 'gen-code-spec';

export function SpecCompleteVariant({ presented, resolved }: VariantProps) {
  const { t, i18n } = useTranslation('actions');
  const setSelectedJobType = useStore((s) => s.setSelectedJobType);
  const state = useChoiceCardState({ presented, resolved });

  const payload = (presented.payload ?? {}) as Record<string, any>;
  const specFile = (payload.specFile as string | undefined) || 'spec.md';
  const specPath = (payload.specPath as string | undefined) || `outputs/design/spec/${specFile}`;
  const sourceFiles = Array.isArray(payload.sourceFiles)
    ? (payload.sourceFiles as unknown[]).filter((n): n is string => typeof n === 'string')
    : [];
  const domain = payload.domain as Domain | undefined;

  const handleDevelop = async () => {
    if (!state.selectedProject || !state.selectedFeature || state.isSelected) return;
    state.setIsLoading(true);
    state.setLocalSelectedChoice('develop');

    const resolvedLabel = `Starting development with ${specFile}`;
    state.setLocalResolvedLabel(resolvedLabel);
    await state.persistToBackend('develop', resolvedLabel);

    // Treat "Start Development" as a Build for the `gen-code-spec`
    // intent. Pipeline mirrors `ActionFooter.handleBuild` so the chat
    // shows the auto-filled directive AND the explicit metadata badges
    // on the user_turn — instead of a silent backend redirect that
    // bypassed the chat SSOT.
    const lang = (i18n.language as 'en' | 'ko') === 'ko' ? 'ko' : 'en';
    const intentDef = INTENT_DEFINITIONS.find((d) => d.id === SPEC_INTENT);
    const buildDirective =
      t(`buildDirective.${SPEC_INTENT}`, { defaultValue: '' }) ||
      intentDef?.description[lang] ||
      intentDef?.description.en ||
      `Implement ${specFile}`;

    // Build the explicit ActionMetadata directly from the card payload.
    // We deliberately do NOT touch `store.actionMetadata` so the user's
    // currently-open Actions-panel selection is preserved.
    const metadata: ActionMetadata = {
      explicit: true,
      intent: SPEC_INTENT,
      refs: [specPath],
      ...(sourceFiles.length > 0
        ? { context: sourceFiles.map((n) => `inputs/sources/${n}`) }
        : {}),
      ...(domain ? { domain } : {}),
      locale: i18n.language,
    };

    const store = useStore.getState();
    store.setRunning(true, undefined, 'generate');
    setSelectedJobType('code');

    try {
      // Post the user_turn first so the chat renders prose + badges.
      await addChatUserMessage(
        state.selectedProject,
        state.selectedFeature,
        buildDirective,
        metadata,
      );

      const jobExecution = executeCodeJob({
        projectId: state.selectedProject,
        featureName: state.selectedFeature,
        jobType: 'code',
        agent: 'architect',
        overrideDirective: buildDirective,
        chatSource: true,
        skipTriage: true,
        actionMetadata: metadata,
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
    } catch (error) {
      console.error('[ChoiceCard:SpecComplete] Failed to start code job:', error);
      store.setRunning(false);
    } finally {
      state.setIsLoading(false);
    }
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
      subtitle={specPath}
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
