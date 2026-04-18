import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { deriveFromIntent, INTENT_DEFINITIONS, type IntentGroup } from '@ant/shared';
import { MessageSquare, Zap, Check, X, Save, ArrowRight, CheckCircle } from 'lucide-react';
import { Spinner } from '@/presentation/components/common/async';
import { executeCodeJob } from '@/infrastructure/http/cli';
import { addChatUserMessage } from '@/infrastructure/http/api';
import { useActionFooterPolicy } from '@/application/hooks/ui/useActionFooterPolicy';
import type { WizardStepDef } from './basis/types';

const SHELL = 'border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-[#161b22]';
const BTN = 'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors';
const ICON = 'w-4 h-4';

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
  onSave: () => void;
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

  const policy = useActionFooterPolicy();

  const derived = actionMetadata.intent ? deriveFromIntent(actionMetadata.intent) : null;

  const handleChatStart = () => {
    if (!derived || !policy.canStartChat) return;
    const store = useStore.getState();
    store.updateActionMetadata({ explicit: true });
    requestAnimationFrame(() => {
      const input = document.querySelector('textarea[data-chat-input]') as HTMLTextAreaElement | null;
      input?.focus();
    });
  };

  const handleBuild = async () => {
    if (!derived || !policy.canBuild || !selectedProject || !selectedFeature) return;

    const store = useStore.getState();
    store.updateActionMetadata({ explicit: true });
    store.setRunning(true, undefined, 'generate');

    const metadata = { ...useStore.getState().actionMetadata, locale: i18n.language };
    const hasMetadata = Object.keys(metadata).length > 0;
    const intentId = metadata.intent || '';
    const lang = i18n.language as 'en' | 'ko';
    const i18nDirective = intentId ? t(`buildDirective.${intentId}`, { defaultValue: '' }) : '';
    const buildDirective = i18nDirective
      || INTENT_DEFINITIONS.find(d => d.id === intentId)?.description[lang]
      || INTENT_DEFINITIONS.find(d => d.id === intentId)?.description.en
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
    <div className={`${SHELL} flex items-center gap-3`}>
      <button
        type="button"
        onClick={handleChatStart}
        disabled={!policy.canStartChat}
        className={`${BTN} ${
          policy.canStartChat
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        <MessageSquare className={ICON} />
        {t('footer.chatStart')}
      </button>

      <button
        type="button"
        onClick={handleBuild}
        disabled={!policy.canBuild}
        className={`${BTN} ${
          policy.isBuilding
            ? 'bg-emerald-600 text-white cursor-wait'
            : policy.canBuild
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
        }`}
      >
        {policy.isBuilding
          ? <Spinner size="md" tone="inherit" />
          : <Zap className={ICON} />}
        {policy.isBuilding ? t('footer.building') : t('footer.build')}
      </button>

      {policy.buildDisabledReason && !policy.isBuilding && (
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">
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
  onSave,
  onDiscard,
  onNext,
  nextLabel,
  nextEnabled,
  isAllComplete,
}: WizardFooterProps) {
  return (
    <div className={`${SHELL} flex items-center justify-between gap-3`}>
      {/* Left: step indicators */}
      <div className="flex items-center gap-0 min-w-0 overflow-x-auto scrollbar-hide shrink">
        {steps.map((step, idx) => {
          const isActive = idx === currentIndex;
          const hasValue = getSelectedForStep(step) !== undefined;
          const isCompleted = hasValue && !isActive;
          const isClickable = !isActive && hasValue;

          const prevStep = idx > 0 ? steps[idx - 1] : undefined;
          const isGroupBoundary = !!step.group && !!prevStep?.group && step.group !== prevStep.group;

          return (
            <div key={step.id} className="flex items-center shrink-0">
              {isGroupBoundary ? (
                <div className="flex items-center mx-2 shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                </div>
              ) : idx > 0 ? (
                <div className={`w-5 h-px mx-0.5 transition-colors duration-300 ${
                  idx <= currentIndex ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              ) : null}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(idx)}
                disabled={!isClickable}
                className={`
                  flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap
                  ${isActive
                    ? hasValue
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-800'
                      : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-800'
                    : isCompleted
                      ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                      : 'text-gray-400 dark:text-gray-500'}
                `}
              >
                {(isCompleted || (isActive && hasValue)) && (
                  <Check className="w-3 h-3 text-emerald-500" strokeWidth={3} />
                )}
                <span>{step.title[lang] ?? step.title.en}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {hasPendingChanges && (
          <button
            type="button"
            onClick={onDiscard}
            className={`${BTN} text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800`}
          >
            <X className={ICON} />
            <span>{lang === 'ko' ? '취소' : 'Discard'}</span>
          </button>
        )}

        {hasPendingChanges && (
          <button
            type="button"
            onClick={onSave}
            className={`${BTN} text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/40`}
          >
            <Save className={ICON} />
            <span>{lang === 'ko' ? '저장' : 'Save'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          disabled={!nextEnabled}
          className={`${BTN} font-semibold ${
            nextEnabled
              ? isAllComplete
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed'
          }`}
        >
          {isAllComplete
            ? <><CheckCircle className={ICON} /><span>{nextLabel}</span></>
            : <><span>{nextLabel}</span><ArrowRight className={ICON} /></>
          }
        </button>
      </div>
    </div>
  );
}
