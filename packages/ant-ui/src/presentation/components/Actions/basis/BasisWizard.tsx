import { useRef, useMemo, useCallback } from 'react';
import { Settings2, Palette, AlertCircle } from 'lucide-react';
import { ScrollableTabNav, type TabItem } from '../ScrollableTabNav';
import { PageTransition } from '../PageTransition';
import { useBasisWizard } from './useBasisWizard';
import { StepHeader } from './StepHeader';
import { VariantCardGrid } from './VariantCardGrid';
import { WizardFooter } from './WizardFooter';
import { BasisSummaryBar } from './BasisSummaryBar';
import { TIER_TAB_ITEMS } from './constants';
import type { BasisWizardProps } from './types';

export function BasisWizard({ basisSlot, onBack, lang }: BasisWizardProps) {
  const wizard = useBasisWizard(basisSlot);
  const dirRef = useRef<1 | -1>(1);
  const prevStepRef = useRef(wizard.state.stepIndex);

  if (wizard.state.stepIndex !== prevStepRef.current) {
    dirRef.current = wizard.state.stepIndex > prevStepRef.current ? 1 : -1;
    prevStepRef.current = wizard.state.stepIndex;
  }

  const tierTabItems: TabItem[] = useMemo(() => {
    const items: TabItem[] = [];
    if (wizard.hasTechTier) {
      const def = TIER_TAB_ITEMS[0];
      const configured = wizard.isTierSaved('techTier');
      const label = configured
        ? (def.label[lang] ?? def.label.en)
        : `${def.label[lang] ?? def.label.en} ${lang === 'ko' ? '(설정필요)' : '(needs setup)'}`;
      items.push({
        id: def.id,
        label,
        description: def.description[lang] ?? def.description.en,
        icon: configured ? Settings2 : AlertCircle,
        iconBg: configured ? 'bg-violet-50 dark:bg-violet-950/30' : 'bg-amber-50 dark:bg-amber-950/30',
        iconColor: configured ? 'text-violet-500 dark:text-violet-400' : 'text-amber-500 dark:text-amber-400',
      });
    }
    if (wizard.hasVisualTier) {
      const def = TIER_TAB_ITEMS[1];
      const configured = wizard.isTierSaved('visualTier');
      const label = configured
        ? (def.label[lang] ?? def.label.en)
        : `${def.label[lang] ?? def.label.en} ${lang === 'ko' ? '(설정필요)' : '(needs setup)'}`;
      items.push({
        id: def.id,
        label,
        description: def.description[lang] ?? def.description.en,
        icon: configured ? Palette : AlertCircle,
        iconBg: configured ? 'bg-pink-50 dark:bg-pink-950/30' : 'bg-amber-50 dark:bg-amber-950/30',
        iconColor: configured ? 'text-pink-500 dark:text-pink-400' : 'text-amber-500 dark:text-amber-400',
      });
    }
    return items;
  }, [wizard.hasTechTier, wizard.hasVisualTier, wizard.isTierSaved, wizard.savedBasis, lang]);

  const handleTierSelect = useCallback((tierId: string) => {
    wizard.switchTier(tierId as 'techTier' | 'visualTier');
  }, [wizard]);

  const handleStepGoTo = useCallback((index: number) => {
    dirRef.current = index > wizard.state.stepIndex ? 1 : -1;
    wizard.goToStep(index);
  }, [wizard]);

  const handleSelect = useCallback((variantId: string) => {
    dirRef.current = 1;
    wizard.selectVariant(variantId);
  }, [wizard]);

  const handleNext = useCallback(() => {
    const { activeTier } = wizard.state;
    const otherTier = activeTier === 'techTier' ? 'visualTier' : 'techTier';
    const hasOther = activeTier === 'techTier' ? wizard.hasVisualTier : wizard.hasTechTier;
    const otherSaved = hasOther ? wizard.isTierSaved(otherTier) : true;

    if (wizard.allTiersSaved) {
      onBack();
      return;
    }

    if (hasOther && !otherSaved) {
      wizard.switchTier(otherTier);
    } else {
      onBack();
    }
  }, [wizard, onBack]);

  const nextEnabled = !!wizard.savedBasis && (
    wizard.isTierSaved(wizard.state.activeTier) || !wizard.hasPendingChanges
  );

  const hasSingleTier = Number(wizard.hasTechTier) + Number(wizard.hasVisualTier) === 1;
  const nextLabel = (wizard.allTiersSaved || hasSingleTier)
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
          onBack={onBack}
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
        <WizardFooter
          steps={wizard.activeSteps}
          currentIndex={wizard.state.stepIndex}
          onStepClick={handleStepGoTo}
          lang={lang}
          getSelectedForStep={wizard.getSelectedForStep}
          hasPendingChanges={wizard.hasPendingChanges}
          onSave={wizard.saveDraft}
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
