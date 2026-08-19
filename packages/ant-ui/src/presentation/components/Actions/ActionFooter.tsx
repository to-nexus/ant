import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import {
  deriveFromIntent,
  UNIVERSAL_FEATURE,
  type IntentGroup,
  type LogJobType,
} from '@ant/shared';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { selectUniversalExecuteContext } from '@/domain/store/selectors/universalExecuteContext';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';
import { Button, WizardStepIndicator, type WizardStep } from '@/presentation/components/aurora';
import { canonicalBuildDirective, universalBuildDirective } from './buildDirective';
import type { WizardStepDef } from './basis/types';

const SHELL_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--border-2)',
  padding: '12px 16px',
  background: 'var(--bg-app)',
};

/* ---------- Props ---------- */

interface IntentFooterProps {
  variant: 'intent';
  actionId: IntentGroup;
}

interface WizardFooterProps {
  variant: 'wizard';
  steps: WizardStepDef[];
  currentIndex: number;
  onStepClick: (index: number) => void;
  lang: 'en' | 'ko';
  getSelectedForStep: (step: WizardStepDef) => string | undefined;
  hasPendingChanges: boolean;
  onDiscard: () => void;
  onNext: () => void;
  nextLabel: string;
  nextEnabled: boolean;
  isAllComplete: boolean;
}

interface UniversalIntentFooterProps {
  variant: 'universal-intent';
  /**
   * The custom-job intent this detail page shows — its ID ONLY. Passing the
   * whole `CustomIntentDef` is what let its `infer` criterion become the
   * directive; narrowing the prop makes that a type error.
   */
  intentId: string;
}

export type ActionFooterProps = IntentFooterProps | WizardFooterProps | UniversalIntentFooterProps;

export function ActionFooter(props: ActionFooterProps) {
  if (props.variant === 'wizard') return <WizardVariant {...props} />;
  if (props.variant === 'universal-intent') return <UniversalIntentVariant {...props} />;
  return <IntentVariant {...props} />;
}

/* ================================================================
 *  Intent variant
 * ================================================================ */

function IntentVariant(_props: IntentFooterProps) {
  const { t, i18n } = useTranslation('actions');

  const selectedProject = useStore(s => s.selectedProject);
  const selectedFeature = useStore(s => s.selectedFeature);
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);

  const policy = useActionFooterPolicy();

  const derived = actionMetadata.intent ? deriveFromIntent(actionMetadata.intent) : null;

  const handleChatStart = () => {
    if (!derived || !policy.canStartChat) return;
    // Manual set path for `explicit` — gated by canStartChat per the invariant
    // in useExplicitAutoSync. Restores the badge if user previously removed it;
    // no-op when already on.
    if (actionMetadata.explicit !== true) {
      updateActionMetadata({ explicit: true });
    }
    requestAnimationFrame(() => {
      const input = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null;
      input?.focus();
    });
  };

  const handleBuild = async () => {
    if (!derived || !policy.canBuild || !selectedProject || !selectedFeature) return;

    const store = useStore.getState();
    store.setRunning(true, undefined, 'generate');

    const metadata = { ...useStore.getState().actionMetadata, locale: i18n.language };
    const hasMetadata = Object.keys(metadata).length > 0;
    const intentId = metadata.intent || '';
    const lang = i18n.language as 'en' | 'ko';
    const buildDirective = canonicalBuildDirective({ intentId, domain: metadata.domain, lang, t });

    try {
      const { turnId } = await addChatUserMessage(
        selectedProject,
        selectedFeature,
        buildDirective,
        hasMetadata ? metadata : undefined,
        derived.jobType as LogJobType,
      );

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: derived.jobType as any,
        agent: derived.agent,
        overrideDirective: buildDirective,
        chatSource: true,
        actionMetadata: hasMetadata ? metadata : undefined,
        seedTurnId: turnId,
      });

      store.setCurrentJob(jobExecution);

      if (hasMetadata) {
        store.resetActionMetadata();
      }

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
      console.error('[Actions] BUILD failed:', error);
      store.setRunning(false);
    }
  };

  return (
    <div style={SHELL_STYLE} className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="md"
        iconLeft="message-square"
        onClick={handleChatStart}
        disabled={!policy.canStartChat}
      >
        {t('footer.chatStart')}
      </Button>

      <Button
        variant="primary"
        size="md"
        glow
        iconLeft="zap"
        loading={policy.isBuilding}
        onClick={handleBuild}
        disabled={!policy.canBuild && !policy.isBuilding}
      >
        {policy.isBuilding ? t('footer.building') : t('footer.build')}
      </Button>

      {policy.buildDisabledReason && !policy.isBuilding && (
        <span
          className="text-xs ml-auto"
          style={{ color: 'var(--text-3)' }}
        >
          {policy.buildDisabledReason === 'context-not-selected'
            ? t('footer.contextRequired')
            : policy.buildDisabledReason === 'refs-not-selected'
              ? t('footer.refsRequired')
              : ''}
        </span>
      )}
    </div>
  );
}

/* ================================================================
 *  Universal-intent variant — the custom-agent detail page's bottom menu.
 *  Same shell + button vocabulary as the canonical intent variant; the
 *  actions ride the universal wire instead of the RAC pipeline:
 *  - Chat  = arm this intent as an `@intent:` mention + focus the composer
 *            (canonical parity: prepare, never send).
 *  - Build = post a localized run request as the user turn and dispatch a
 *            universal run with this intent pinned (the
 *            PlanCompleteVariant.handleProceed precedent — composer-
 *            independent, so a collapsed chat sidebar cannot defer it).
 * ================================================================ */

function UniversalIntentVariant({ intentId }: UniversalIntentFooterProps) {
  const { t } = useTranslation('actions');

  const selectedProject = useStore((s) => s.selectedProject);
  const isRunning = useStore((s) => s.isRunning);
  const armed = useStore((s) => s.universalTurnMeta.intents.includes(intentId));
  const addIntent = useStore((s) => s.addUniversalIntentMention);
  const removeIntent = useStore((s) => s.removeUniversalIntentMention);

  const handleChatStart = () => {
    if (!selectedProject) return;
    addIntent(intentId);
    requestAnimationFrame(() => {
      const input = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null;
      input?.focus();
    });
  };

  const handleBuild = async () => {
    if (!selectedProject || isRunning) return;

    const store = useStore.getState();
    // One localized template covers every custom intent: the work statement
    // already rides the pinned intent's prompt.md and the job/agent base
    // prompts, so the directive only states that this run carries no further
    // input. Minting it from the intent's criterion instead double-injected
    // the same prose and dragged the turn's locale to the author's language.
    const directive = universalBuildDirective({ intentId, t });

    if (store.selectedJobType !== 'universal' || store.selectedAgent !== 'universal') {
      store.applyJobIdentity({ jobType: 'universal', agent: 'universal' });
    }
    // BUILD is a self-contained atomic run of exactly this intent: drop any
    // pre-armed @ctx/@plan leftovers, then pin this intent and read the wire
    // params off the ONE mapping SSOT.
    store.resetUniversalTurnMeta();
    store.addUniversalIntentMention(intentId);
    const ctx = selectUniversalExecuteContext(useStore.getState());
    if (!ctx) return;

    store.setRunning(true, undefined, 'generate');
    try {
      // Post the user_turn first; the pre-allocated turnId MUST ride to the
      // job start (BE chat-copy dedup keys on turnId).
      const { turnId } = await addChatUserMessage(
        selectedProject,
        UNIVERSAL_FEATURE,
        directive,
        undefined,
        'universal',
      );

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: UNIVERSAL_FEATURE,
        jobType: 'universal',
        agent: 'universal',
        overrideDirective: directive,
        chatSource: true,
        skipTriage: ctx.skipTriage,
        customJobRef: ctx.customJobRef,
        intents: ctx.intents,
        context: ctx.context,
        plan: ctx.plan,
        seedTurnId: turnId,
      });
      // Mentions apply to the run just dispatched; following turns re-infer.
      useStore.getState().resetUniversalTurnMeta();

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
      console.error('[Actions] Universal BUILD failed:', error);
      useStore.getState().setRunning(false);
    }
  };

  return (
    <div style={SHELL_STYLE} className="flex items-center gap-3">
      <Button
        variant="secondary"
        size="md"
        iconLeft="message-square"
        onClick={handleChatStart}
        disabled={!selectedProject}
      >
        {t('footer.chatStart')}
      </Button>

      <Button
        variant="primary"
        size="md"
        glow
        iconLeft="zap"
        loading={isRunning}
        onClick={handleBuild}
        disabled={!selectedProject || isRunning}
      >
        {isRunning ? t('footer.building') : t('footer.build')}
      </Button>

      {armed && !isRunning && (
        <span className="text-xs ml-auto inline-flex items-center gap-2" style={{ color: 'var(--text-3)' }}>
          {t('universal.armedHint', { defaultValue: 'Armed — this intent rides the next chat turn.' })}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-[color:var(--text-2)]"
            onClick={() => removeIntent(intentId)}
          >
            {t('universal.disarm', { defaultValue: 'Disarm' })}
          </button>
        </span>
      )}
    </div>
  );
}

/* ================================================================
 *  Wizard variant
 * ================================================================ */

function WizardVariant({
  steps,
  currentIndex,
  onStepClick,
  lang,
  getSelectedForStep,
  hasPendingChanges,
  onDiscard,
  onNext,
  nextLabel,
  nextEnabled,
  isAllComplete,
}: WizardFooterProps) {
  // Project the wizard's step definitions to the shared Aurora primitive shape.
  const auroraSteps: WizardStep[] = steps.map((step) => ({
    id: step.id,
    label: step.title[lang] ?? step.title.en,
    hasValue: getSelectedForStep(step) !== undefined,
    group: step.group,
  }));

  return (
    <div
      style={SHELL_STYLE}
      className="flex items-center justify-between gap-3"
    >
      {/* Left: step indicators (shared Aurora primitive) */}
      <div className="min-w-0 shrink">
        <WizardStepIndicator
          steps={auroraSteps}
          currentIndex={currentIndex}
          onStepClick={onStepClick}
          size="md"
        />
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {hasPendingChanges && (
          <Button
            variant="ghost"
            size="sm"
            iconLeft="x"
            onClick={onDiscard}
          >
            {lang === 'ko' ? '취소' : 'Discard'}
          </Button>
        )}

        <Button
          variant="primary"
          size="sm"
          glow
          iconLeft={isAllComplete ? 'check-circle' : undefined}
          iconRight={!isAllComplete ? 'arrow-right' : undefined}
          onClick={onNext}
          disabled={!nextEnabled}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
