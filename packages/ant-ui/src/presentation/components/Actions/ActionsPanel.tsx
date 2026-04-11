import { useRef, useMemo, useCallback } from 'react';
import { useStore } from '@/domain/store';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, getIntentsForAction, type IntentGroup } from '@ant/shared';
import { ActionChipGrid, IntentChipGrid, type ChipItem } from './ActionChipGrid';
import { ActionConfigView } from './ActionConfigView';
import { ACTION_VISUALS, getIntentVisual } from './actionVisuals';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { PageTransition } from './PageTransition';

const STEP_ORDER = ['pick-action', 'pick-intent', 'config'] as const;

export function ActionsPanel() {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const readiness = useActionReadiness();
  const step = useStore(s => s.actionsStep);
  const selectedActionId = useStore(s => s.selectedActionId) as IntentGroup | null;
  const selectedIntentId = useStore(s => s.selectedIntentId);
  const setActionsStep = useStore(s => s.setActionsStep);
  const selectAction = useStore(s => s.selectAction);
  const selectIntent = useStore(s => s.selectIntent);

  const stepDirRef = useRef<1 | -1>(1);
  const prevStepRef = useRef(step);
  const actionDirRef = useRef<1 | -1>(1);

  if (step !== prevStepRef.current) {
    const oldIdx = STEP_ORDER.indexOf(prevStepRef.current);
    const newIdx = STEP_ORDER.indexOf(step);
    stepDirRef.current = newIdx >= oldIdx ? 1 : -1;
    prevStepRef.current = step;
  }

  const handleActionSelect = useCallback((actionId: IntentGroup) => {
    if (selectedActionId) {
      const oldIdx = ACTION_DEFINITIONS.findIndex(d => d.id === selectedActionId);
      const newIdx = ACTION_DEFINITIONS.findIndex(d => d.id === actionId);
      actionDirRef.current = newIdx >= oldIdx ? 1 : -1;
    }
    selectAction(actionId);
    setActionsStep('pick-intent');
  }, [selectedActionId, selectAction, setActionsStep]);

  const handleActionTabSwitch = useCallback((actionId: string) => {
    if (selectedActionId) {
      const oldIdx = ACTION_DEFINITIONS.findIndex(d => d.id === selectedActionId);
      const newIdx = ACTION_DEFINITIONS.findIndex(d => d.id === actionId);
      actionDirRef.current = newIdx >= oldIdx ? 1 : -1;
    }
    selectAction(actionId as IntentGroup);
  }, [selectedActionId, selectAction]);

  const handleIntentSelect = useCallback((intentId: string) => {
    selectIntent(intentId);
    setActionsStep('config');
  }, [selectIntent, setActionsStep]);

  const handleBack = useCallback(() => {
    if (step === 'config') {
      const intents = selectedActionId ? getIntentsForAction(selectedActionId) : [];
      if (intents.length > 1) {
        setActionsStep('pick-intent');
      } else {
        setActionsStep('pick-action');
      }
    } else {
      setActionsStep('pick-action');
    }
  }, [step, selectedActionId, setActionsStep]);

  const actionTabItems: TabItem[] = useMemo(() =>
    ACTION_DEFINITIONS.map(def => {
      const visual = ACTION_VISUALS[def.id];
      return {
        id: def.id,
        label: def.label[lang] || def.label.en,
        description: def.description[lang] || def.description.en,
        icon: visual?.icon,
        iconBg: visual?.bg,
        iconColor: visual?.text,
      };
    }),
    [lang],
  );

  const intentChipItems = useCallback((): ChipItem[] => {
    if (!selectedActionId) return [];
    const intents = getIntentsForAction(selectedActionId);

    return intents.map(intent => {
      const v = getIntentVisual(intent.id, selectedActionId);
      return {
        id: intent.id,
        label: intent.label[lang] || intent.label.en,
        description: intent.description[lang] || intent.description.en,
        icon: v.icon,
        bg: v.bg,
        text: v.text,
      };
    });
  }, [selectedActionId, lang]);

  const renderStep = () => {
    if (step === 'pick-action') {
      return (
        <div className="h-full flex items-center justify-center p-8 overflow-y-auto">
          <ActionChipGrid
            readiness={readiness}
            variant="large"
            onSelect={handleActionSelect}
            title={t('title')}
          />
        </div>
      );
    }

    if (step === 'pick-intent' && selectedActionId) {
      return (
        <div className="h-full flex flex-col">
          <div className="shrink-0 px-5 pt-5">
            <ScrollableTabNav
              items={actionTabItems}
              selectedId={selectedActionId}
              onSelect={handleActionTabSwitch}
              onBack={() => setActionsStep('pick-action')}
            />
          </div>
          <PageTransition
            pageKey={selectedActionId}
            direction={actionDirRef.current}
            className="flex-1 flex items-center justify-center p-5 overflow-y-auto"
          >
            <IntentChipGrid
              items={intentChipItems()}
              onSelect={handleIntentSelect}
            />
          </PageTransition>
        </div>
      );
    }

    if (step === 'config' && selectedActionId && selectedIntentId) {
      return (
        <div className="h-full">
          <ActionConfigView
            actionId={selectedActionId}
            intentId={selectedIntentId}
            onBack={handleBack}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#161b22]">
      <div className="flex-1 overflow-y-auto">
        <PageTransition pageKey={step} direction={stepDirRef.current} className="h-full">
          {renderStep()}
        </PageTransition>
      </div>
    </div>
  );
}
