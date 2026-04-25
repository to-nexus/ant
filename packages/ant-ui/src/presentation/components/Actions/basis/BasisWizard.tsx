import { useRef, useMemo, useCallback, useEffect } from 'react';
import { useStore } from '@/domain/store';
import { ScrollableTabNav, type TabItem } from '../ScrollableTabNav';
import { PageTransition } from '../PageTransition';
import { ActionFooter } from '../ActionFooter';
import { useBasisWizard } from './useBasisWizard';
import { StepHeader } from './StepHeader';
import { VariantCardGrid } from './VariantCardGrid';
import { BasisSummaryBar } from './BasisSummaryBar';
import { getTierDescriptor } from './constants';
import type { BasisWizardProps, TierKey } from './types';

export function BasisWizard({ basisSlot, onBack, lang, initialTier }: BasisWizardProps) {
  const wizard = useBasisWizard(basisSlot, initialTier);
  const dirRef = useRef<1 | -1>(1);
  const prevStepRef = useRef(wizard.state.stepIndex);
  const setBasisEditInitialTier = useStore(s => s.setBasisEditInitialTier);

  // The store's `basisEditInitialTier` is one-shot: it seeds the wizard's
  // activeTier on mount, then must be cleared so a subsequent global "Edit"
  // (which doesn't target a tier) doesn't inherit the previous tier choice.
  useEffect(() => {
    setBasisEditInitialTier(undefined);
  }, [setBasisEditInitialTier]);

  // Defensive routing: if live state turns the active tier unavailable
  // (e.g. user picks stack=backend → Visual Tier collapses), hop to the
  // first tier that is still available so we never render an empty active
  // tier. Generic over `availableTiers` — no per-tier branching.
  useEffect(() => {
    if (wizard.availableTiers.includes(wizard.state.activeTier)) return;
    const fallback = wizard.availableTiers[0];
    if (fallback) wizard.switchTier(fallback);
  }, [wizard.availableTiers, wizard.state.activeTier, wizard.switchTier]);

  if (wizard.state.stepIndex !== prevStepRef.current) {
    dirRef.current = wizard.state.stepIndex > prevStepRef.current ? 1 : -1;
    prevStepRef.current = wizard.state.stepIndex;
  }

  // "Unset = auto-detect" is the SSOT — pressuring users with "(needs setup)"
  // contradicts that. Always render the canonical label/icon regardless of
  // saved state. Tier identity (label, icon, colors) lives in TIER_REGISTRY,
  // so this is a one-line projection.
  const tierTabItems: TabItem[] = useMemo(
    () => wizard.availableTiers.map((tier) => {
      const def = getTierDescriptor(tier);
      return {
        id: def.id,
        label: def.label[lang] ?? def.label.en,
        description: def.description[lang] ?? def.description.en,
        icon: def.icon,
        iconBg: def.iconBg,
        iconColor: def.iconColor,
      };
    }),
    [wizard.availableTiers, lang],
  );

  // SSOT: every path that leaves the wizard or switches tier must auto-save
  // pending changes first. All exit/switch sites route through these two
  // wrappers so we can never regress to a "leaked staging" bug.
  const exitWithSave = useCallback(() => {
    if (wizard.hasPendingChanges) wizard.saveDraft();
    onBack();
  }, [wizard, onBack]);

  const switchTierWithSave = useCallback((tier: TierKey) => {
    if (wizard.hasPendingChanges) wizard.saveDraft();
    wizard.switchTier(tier);
  }, [wizard]);

  const handleTierSelect = useCallback((tierId: string) => {
    switchTierWithSave(tierId as TierKey);
  }, [switchTierWithSave]);

  const handleStepGoTo = useCallback((index: number) => {
    dirRef.current = index > wizard.state.stepIndex ? 1 : -1;
    wizard.goToStep(index);
  }, [wizard]);

  const handleSelect = useCallback((variantId: string) => {
    dirRef.current = 1;
    wizard.selectVariant(variantId);
  }, [wizard]);

  const handleNext = useCallback(() => {
    if (wizard.hasNextGroup) {
      wizard.advanceToNextGroup();
      return;
    }

    // After finishing the active tier, jump to the first *other* tier that's
    // available but not yet saved. If every other tier is already saved
    // (or there are none), exit. Generic over `availableTiers` — adding a
    // third tier doesn't touch this code.
    const nextTier = wizard.availableTiers.find(
      (tier) => tier !== wizard.state.activeTier && !wizard.isTierSaved(tier),
    );
    if (nextTier) {
      switchTierWithSave(nextTier);
    } else {
      exitWithSave();
    }
  }, [wizard, exitWithSave, switchTierWithSave]);

  // Auto-save policy: footer no longer requires explicit Save before Next.
  // - Multi-group (fullstack): Next-group enables once current group has all
  //   selections (real or AUTO).
  // - Last group / single-tier: Next enables only after the user has reached
  //   the genuinely-last step of the (cascade-pruned) activeSteps AND that
  //   step has a value. AUTO selections short-circuit the cascade so the last
  //   step is reached immediately — no busywork required.
  const currentStepValue = wizard.currentStep
    ? wizard.getSelectedForStep(wizard.currentStep)
    : undefined;
  const isAtLastStep = wizard.activeSteps.length > 0
    && wizard.state.stepIndex === wizard.activeSteps.length - 1;
  const nextEnabled = wizard.hasNextGroup
    ? wizard.currentGroupComplete
    : (isAtLastStep && currentStepValue !== undefined);

  const isSingleTier = wizard.availableTiers.length === 1;
  const nextLabel = (wizard.allTiersSaved || (isSingleTier && wizard.isTierSaved(wizard.state.activeTier)))
    ? (lang === 'ko' ? '완료' : 'Done')
    : (lang === 'ko' ? '다음' : 'Next');

  if (!wizard.currentStep) return null;

  const currentStepSelected = wizard.getSelectedForStep(wizard.currentStep);
  const options = wizard.getOptionsForStep(wizard.currentStep);
  const pageKey = `${wizard.state.activeTier}-${wizard.state.stepIndex}`;

  return (
    <div className="flex flex-col h-full overflow-x-hidden">
      <div className="shrink-0 px-5 pt-5">
        <ScrollableTabNav
          items={tierTabItems}
          selectedId={wizard.state.activeTier}
          onSelect={handleTierSelect}
          onBack={exitWithSave}
        />
      </div>

      <div className="shrink-0 px-5 pt-2">
        <BasisSummaryBar
          basisSlot={basisSlot}
          lang={lang}
          draftBasis={wizard.draftBasis}
          savedBasis={wizard.savedBasis}
          mode="inline"
        />
      </div>

      <PageTransition
        pageKey={pageKey}
        direction={dirRef.current}
        className="flex-1 overflow-y-auto p-5"
      >
        <StepHeader step={wizard.currentStep} lang={lang} />

        <VariantCardGrid
          options={options}
          selectedId={currentStepSelected}
          onSelect={handleSelect}
          tierKey={wizard.currentStep.tierKey}
          layerKey={wizard.currentStep.layerKey}
          lang={lang}
        />
      </PageTransition>

      <div className="shrink-0">
        <ActionFooter
          variant="wizard"
          steps={wizard.activeSteps}
          currentIndex={wizard.state.stepIndex}
          onStepClick={handleStepGoTo}
          lang={lang}
          getSelectedForStep={wizard.getSelectedForStep}
          hasPendingChanges={wizard.hasPendingChanges}
          onDiscard={wizard.discardDraft}
          onNext={handleNext}
          nextLabel={nextLabel}
          nextEnabled={nextEnabled}
          isAllComplete={wizard.allTiersSaved}
        />
      </div>
    </div>
  );
}
