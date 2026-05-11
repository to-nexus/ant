import { useRef, useMemo, useCallback } from 'react';
import { useStore } from '@/domain/store';
import { useActionReadiness } from '@/application/hooks/features/useActionReadiness';
import {
  useActiveTiers,
  decideActionsStepAfterIntent,
} from '@/application/hooks/features/useActiveTiers';
import { useTranslation } from 'react-i18next';
import {
  ACTION_DEFINITIONS,
  getIntentsForAction,
  getConfigSlots,
  isActionSurfaced,
  getActionLabel,
  getActionDescription,
  getIntentLabel,
  getIntentDescriptionLocalized,
  type IntentGroup,
  type IntentId,
} from '@ant/shared';
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
  // Phase 2 (D22/D28): domain gate applies to pick-intent's ScrollableTabNav too.
  // When workspace.domain === 'service', design-game-art tab disappears, and
  // when workspace.domain === 'game', design-ui tab disappears, so the user
  // cannot side-step the gate via tab switching.
  const currentDomain = actionMetadata.domain;

  const handleIntentSelect = useCallback((intentId: string) => {
    selectIntent(intentId);
    const slots = getConfigSlots(intentId as Parameters<typeof getConfigSlots>[0]);
    // SSOT D27 — `decideActionsStepAfterIntent` funnels through
    // `listActiveTiers` so static `slot.tiers` that the domain × runtime
    // matrix has fully closed (e.g. service + gen-plan with PLAN_TIERS =
    // ['gameContentTier']) route to `'config'` instead of `'basis-edit'`.
    // Routing on the static count alone would mount a `BasisWizard` whose
    // `availableTiers === []` triggers its `!currentStep → return null`
    // defensive guard, leaving the panel completely blank.
    setActionsStep(decideActionsStepAfterIntent(slots?.basis, actionMetadata));
  }, [selectIntent, setActionsStep, actionMetadata]);

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
      .filter(def => isActionSurfaced(def, currentDomain))
      .map(def => {
        const visual = ACTION_VISUALS[def.id];
        return {
          id: def.id,
          label: getActionLabel(def, currentDomain, lang),
          description: getActionDescription(def, currentDomain, lang),
          icon: visual?.icon,
          iconBg: visual?.bg,
          iconColor: visual?.text,
        };
      }),
    [lang, currentDomain],
  );

  // Pre-compute the active-tier set for the currently-selected intent so
  // the `basis-edit` render guard below can match `handleIntentSelect`'s
  // routing decision exactly. Using `useActiveTiers` here keeps both
  // sides on the same SSOT (`listActiveTiers`) and the same runtime
  // context (`actionMetadata.{domain,basis,refs,context}`).
  const selectedSlots = selectedIntentId
    ? getConfigSlots(selectedIntentId as Parameters<typeof getConfigSlots>[0])
    : null;
  const selectedActiveTiers = useActiveTiers(selectedSlots?.basis);

  const intentChipItems = useCallback((): ChipItem[] => {
    if (!selectedActionId) return [];
    const intents = getIntentsForAction(selectedActionId);

    return intents.map(intent => {
      const v = getIntentVisual(intent.id, selectedActionId);
      return {
        id: intent.id,
        label: getIntentLabel(intent, currentDomain, lang),
        description: getIntentDescriptionLocalized(intent, currentDomain, lang),
        icon: v.icon,
        bg: v.bg,
        text: v.text,
      };
    });
  }, [selectedActionId, lang, currentDomain]);

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

    if (step === 'basis-edit' && selectedIntentId && selectedSlots?.basis) {
      // Mirrors `handleIntentSelect`'s SSOT (`listActiveTiers`). Falls
      // through to `null` only when every static-opted-in tier has been
      // closed by the matrix — same condition that would make
      // `BasisWizard` render `null` internally — so we never mount a
      // wizard that can't render anything.
      if (selectedActiveTiers.length > 0) {
        return (
          <div className="h-full">
            <BasisWizard
              basisSlot={selectedSlots.basis}
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
