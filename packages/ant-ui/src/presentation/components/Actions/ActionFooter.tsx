import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { deriveFromIntent, INTENT_DEFINITIONS, getIntentDescriptionLocalized, type IntentGroup } from '@ant/shared';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';
import { Button, WizardStepIndicator, type WizardStep } from '@/presentation/components/aurora';
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

export type ActionFooterProps = IntentFooterProps | WizardFooterProps;

export function ActionFooter(props: ActionFooterProps) {
  if (props.variant === 'wizard') return <WizardVariant {...props} />;
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
    // D28-revised — pass the workspace domain through i18next `context`
    // so plan-related directives (`gen-plan` / `explain-plan`) resolve
    // their `_game` variant when the workspace is a game project.
    const i18nDirective = intentId ? t(`buildDirective.${intentId}`, { defaultValue: '', context: metadata.domain }) : '';
    const intentDef = INTENT_DEFINITIONS.find(d => d.id === intentId);
    const buildDirective = i18nDirective
      || (intentDef ? getIntentDescriptionLocalized(intentDef, metadata.domain, lang) : '')
      || t('footer.build');

    try {
      await addChatUserMessage(
        selectedProject,
        selectedFeature,
        buildDirective,
        hasMetadata ? metadata : undefined,
      );

      const jobExecution = executeCodeJob({
        projectId: selectedProject,
        featureName: selectedFeature,
        jobType: derived.jobType as any,
        agent: derived.agent,
        overrideDirective: buildDirective,
        chatSource: true,
        actionMetadata: hasMetadata ? metadata : undefined,
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
