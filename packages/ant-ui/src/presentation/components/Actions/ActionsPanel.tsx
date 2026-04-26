import { useRef, useMemo, useCallback } from 'react';
import { useStore } from '@/domain/store';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import { useTranslation } from 'react-i18next';
import { ACTION_DEFINITIONS, getIntentsForAction, getConfigSlots, isActionVisibleForDomain, type IntentGroup, type IntentId } from '@ant/shared';
import { ActionChipGrid, IntentChipGrid, type ChipItem } from './ActionChipGrid';
import { ActionConfigView } from './ActionConfigView';
import { ACTION_VISUALS, getIntentVisual } from './actionVisuals';
import { ScrollableTabNav, type TabItem } from './ScrollableTabNav';
import { PageTransition } from './PageTransition';
import { BasisWizard } from './basis';
import { DomainToggle } from './DomainToggle';

const STEP_ORDER = ['pick-action', 'pick-intent', 'config', 'basis-edit'] as const;

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
  const basisEditInitialTier = useStore(s => s.basisEditInitialTier);

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

  const actionMetadata = useStore(s => s.actionMetadata);
  // Phase 2 (D22): domain gate applies to pick-intent's ScrollableTabNav too.
  // When workspace.domain === 'service', design-art tab disappears so the
  // user cannot side-step the gate via tab switching.
  const currentDomain = actionMetadata.domain;

  const handleIntentSelect = useCallback((intentId: string) => {
    selectIntent(intentId);
    const slots = getConfigSlots(intentId as Parameters<typeof getConfigSlots>[0]);
    // rev-* intents carry `basis: { tiers: [] }` — treat as no wizard.
    const basisHasTiers = (slots?.basis?.tiers?.length ?? 0) > 0;
    if (basisHasTiers && !actionMetadata.basis) {
      setActionsStep('basis-edit');
    } else {
      setActionsStep('config');
    }
  }, [selectIntent, setActionsStep, actionMetadata.basis]);

  const handleBack = useCallback(() => {
    if (step === 'basis-edit') {
      setActionsStep('config');
    } else if (step === 'config') {
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
    ACTION_DEFINITIONS
      .filter(def => isActionVisibleForDomain(def, currentDomain))
      .map(def => {
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
    [lang, currentDomain],
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
      // Phase 2 (D22) — workspace-level domain selector lives on the
      // ActionsPanel top screen. Selecting a domain is a sticky workspace
      // decision; descending into any wizard surfaces the same chip but
      // disables editing (see `ActionConfigView` / `pick-intent` below).
      return (
        <div className="h-full flex flex-col overflow-y-auto">
          <div className="shrink-0 px-5 pt-5 flex justify-end">
            <DomainToggle topLevel />
          </div>
          <div className="flex-1 flex items-center justify-center p-8">
            <ActionChipGrid
              readiness={readiness}
              variant="large"
              onSelect={handleActionSelect}
              title={t('title')}
            />
          </div>
        </div>
      );
    }

    if (step === 'pick-intent' && selectedActionId) {
      // D22: workspace domain is set ONLY on the top `pick-action` screen.
      // Lower depths (pick-intent / config / basis-edit) do NOT surface the
      // chip — the user has already locked the domain in.
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
            actionId={selectedActionId as IntentGroup}
            intentId={selectedIntentId as IntentId}
            onBack={handleBack}
          />
        </div>
      );
    }

    if (step === 'basis-edit' && selectedIntentId) {
      const slots = getConfigSlots(selectedIntentId as Parameters<typeof getConfigSlots>[0]);
      // BasisWizard requires at least one configurable tier — rev-* intents
      // (`tiers: []`) fall through and the panel renders nothing here, but
      // the navigation path that brings the user to `basis-edit` already
      // routes around them via `handleIntentSelect`.
      if (slots?.basis && (slots.basis.tiers?.length ?? 0) > 0) {
        return (
          <div className="h-full">
            <BasisWizard
              basisSlot={slots.basis}
              onBack={() => setActionsStep('config')}
              lang={lang}
              initialTier={basisEditInitialTier}
            />
          </div>
        );
      }
    }

    return null;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-[#161b22]">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <PageTransition pageKey={step} direction={stepDirRef.current} className="h-full">
          {renderStep()}
        </PageTransition>
      </div>
    </div>
  );
}
