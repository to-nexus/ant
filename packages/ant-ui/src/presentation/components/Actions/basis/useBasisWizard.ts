import { useState, useCallback, useMemo, useRef } from 'react';
import { useStore } from '@/domain/store';
import {
  type Basis,
  type BasisSlotConfig,
  type BasisOption,
  type SupportedLanguage,
  type SupportedStack,
  type VisualTier,
  STACK_OPTIONS,
  TECH_TIER_LANGUAGES,
  VALID_LANGUAGES_BY_STACK,
  getFrameworkOptions,
  buildBasisPreset,
  VISUAL_LANGUAGE_OPTIONS,
  SURFACE_SYSTEM_OPTIONS,
  SPATIAL_SYSTEM_OPTIONS,
  deriveInteractionGrammar,
  deriveVisualHierarchyRules,
  type VisualLanguageVariant,
  type SpatialSystemVariant,
} from '@ant/shared';
import { TECH_STEPS, FULLSTACK_STEPS, VISUAL_STEPS } from './constants';
import type { BasisWizardState, WizardStepDef } from './types';

const AUTO = '__auto__';

function isReal(val: string | undefined): val is string {
  return !!val && val !== AUTO;
}

function buildBasisFromSelections(selections: BasisWizardState['selections']): Basis | undefined {
  const stack = isReal(selections.techTier.stack) ? selections.techTier.stack : undefined;

  const tiers: Record<string, { language?: string; framework?: string }> = {};
  if (stack === 'fullstack') {
    const feLang = isReal(selections.techTier.feLanguage) ? selections.techTier.feLanguage : undefined;
    const beLang = isReal(selections.techTier.beLanguage) ? selections.techTier.beLanguage : undefined;
    const feFw = isReal(selections.techTier.feFramework) ? selections.techTier.feFramework : undefined;
    const beFw = isReal(selections.techTier.beFramework) ? selections.techTier.beFramework : undefined;
    if (feLang) tiers.frontend = { language: feLang, framework: feFw };
    if (beLang) tiers.backend = { language: beLang, framework: beFw };
  } else {
    const lang = isReal(selections.techTier.language) ? selections.techTier.language : undefined;
    const fw = isReal(selections.techTier.framework) ? selections.techTier.framework : undefined;
    if (stack && lang) {
      tiers[stack] = { language: lang, framework: fw };
    }
  }

  const vt: Partial<VisualTier> = {};
  const vl = selections.visualTier.visualLanguage;
  const ss = selections.visualTier.surfaceSystem;
  const sp = selections.visualTier.spatialSystem;
  if (isReal(vl)) vt.visualLanguage = vl as any;
  if (isReal(ss)) vt.surfaceSystem = ss as any;
  if (isReal(sp)) vt.spatialSystem = sp as any;

  const ds = selections.visualTier.designSystem;
  const basis = buildBasisPreset({
    stack: stack || undefined,
    tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
    designSystem: isReal(ds) ? ds : undefined,
    visualTier: Object.keys(vt).length > 0 ? (vt as any) : undefined,
  });

  return (basis.techTier || basis.visualTier) ? basis : undefined;
}

function autoSelectLanguage(stack: string | undefined, sel: BasisWizardState['selections']['techTier']): void {
  if (stack === 'fullstack') {
    const feLangs = VALID_LANGUAGES_BY_STACK['frontend'];
    if (feLangs.length === 1) sel.feLanguage = feLangs[0];
    const beLangs = VALID_LANGUAGES_BY_STACK['backend'];
    if (beLangs.length === 1) sel.beLanguage = beLangs[0];
  } else if (stack) {
    const langs = VALID_LANGUAGES_BY_STACK[stack as SupportedStack];
    if (langs && langs.length === 1) sel.language = langs[0];
  }
}

function getSelectionValue(sel: BasisWizardState['selections'], step: WizardStepDef): string | undefined {
  if (step.tierKey === 'techTier') {
    return (sel.techTier as Record<string, string | undefined>)[step.layerKey];
  }
  return (sel.visualTier as Record<string, string | undefined>)[step.layerKey];
}

function findNextGroupStart(steps: WizardStepDef[], currentIdx: number): number | null {
  const currentGroup = steps[currentIdx]?.group;
  if (!currentGroup) return null;
  for (let i = currentIdx + 1; i < steps.length; i++) {
    if (steps[i].group !== currentGroup) return i;
  }
  return null;
}

export function useBasisWizard(basisSlot: BasisSlotConfig) {
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const currentBasis = actionMetadata.basis;

  const savedBasisRef = useRef<Basis | undefined>(currentBasis);

  const [state, setState] = useState<BasisWizardState>(() => {
    const initStack = currentBasis?.techTier?.stack ?? basisSlot.defaults?.stack;
    const initLang = currentBasis?.techTier?.frontend?.language ?? currentBasis?.techTier?.backend?.language;
    const initFw = currentBasis?.techTier?.frontend?.framework ?? currentBasis?.techTier?.backend?.framework;
    const initFeLang = currentBasis?.techTier?.frontend?.language;
    const initFeFw = currentBasis?.techTier?.frontend?.framework;
    const initBeLang = currentBasis?.techTier?.backend?.language;
    const initBeFw = currentBasis?.techTier?.backend?.framework;

    const initActiveTier: 'techTier' | 'visualTier' = basisSlot.techTier ? 'techTier' : 'visualTier';

    let initStepIndex = 0;
    if (initActiveTier === 'techTier') {
      if (initStack === 'fullstack') {
        const layerValues: (string | undefined | null)[] = [];
        if (!basisSlot.defaults?.stack) layerValues.push(initStack);
        layerValues.push(initFeLang);
        layerValues.push(initFeFw);
        layerValues.push(initBeLang);
        layerValues.push(initBeFw);
        const firstEmpty = layerValues.findIndex(v => v === undefined);
        initStepIndex = firstEmpty === -1 ? layerValues.length - 1 : firstEmpty;
      } else {
        const layerValues: (string | undefined | null)[] = [];
        if (!basisSlot.defaults?.stack) layerValues.push(initStack);
        if (initStack) layerValues.push(initLang);
        layerValues.push(initFw);
        const firstEmpty = layerValues.findIndex(v => v === undefined);
        initStepIndex = firstEmpty === -1 ? layerValues.length - 1 : firstEmpty;
      }
    } else {
      const visValues = [
        currentBasis?.visualTier?.visualLanguage,
        currentBasis?.visualTier?.surfaceSystem,
        currentBasis?.visualTier?.spatialSystem,
      ];
      const firstEmpty = visValues.findIndex(v => v === undefined);
      initStepIndex = firstEmpty === -1 ? visValues.length - 1 : firstEmpty;
    }

    const techSel: BasisWizardState['selections']['techTier'] = {
      stack: initStack,
      language: initLang,
      framework: initFw,
      feLanguage: initFeLang,
      feFramework: initFeFw,
      beLanguage: initBeLang,
      beFramework: initBeFw,
    };

    if (initStack && !initLang && !initFeLang) {
      autoSelectLanguage(initStack, techSel);
    }

    return {
      activeTier: initActiveTier,
      stepIndex: initStepIndex,
      selections: {
        techTier: techSel,
        visualTier: {
          designSystem: currentBasis?.visualTier?.designSystem,
          visualLanguage: currentBasis?.visualTier?.visualLanguage,
          surfaceSystem: currentBasis?.visualTier?.surfaceSystem,
          spatialSystem: currentBasis?.visualTier?.spatialSystem,
        },
      },
    };
  });

  const hasTechTier = !!basisSlot.techTier;
  const hasVisualTier = !!basisSlot.visualTier;
  const hasDefaultStack = !!basisSlot.defaults?.stack;
  const isFullstack = state.selections.techTier.stack === 'fullstack';

  const techSteps = useMemo((): WizardStepDef[] => {
    if (!hasTechTier) return [];
    const steps: WizardStepDef[] = [];
    if (!hasDefaultStack) steps.push(TECH_STEPS[0]);
    if (isFullstack) {
      steps.push(...FULLSTACK_STEPS);
    } else {
      steps.push(TECH_STEPS[1]);
      steps.push(TECH_STEPS[2]);
    }
    return steps;
  }, [hasTechTier, hasDefaultStack, isFullstack]);

  const visualSteps = useMemo((): WizardStepDef[] => {
    if (!hasVisualTier) return [];
    return [...VISUAL_STEPS];
  }, [hasVisualTier]);

  const activeSteps = state.activeTier === 'techTier' ? techSteps : visualSteps;
  const currentStep = activeSteps[state.stepIndex];

  const getOptionsForStep = useCallback((step: WizardStepDef): BasisOption[] => {
    const { layerKey } = step;
    const sel = state.selections;

    if (step.tierKey === 'techTier') {
      switch (layerKey) {
        case 'stack':
          return STACK_OPTIONS;
        case 'language': {
          const stack = sel.techTier.stack as SupportedStack | undefined;
          if (!stack) return [];
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK[stack] as readonly string[])?.includes(opt.id),
          );
        }
        case 'framework': {
          const stack = sel.techTier.stack as SupportedStack | undefined;
          const lang = sel.techTier.language as SupportedLanguage | undefined;
          if (!stack || !lang) return [];
          return getFrameworkOptions(stack as 'frontend' | 'backend', lang);
        }
        case 'feLanguage':
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK['frontend'] as readonly string[])?.includes(opt.id),
          );
        case 'feFramework': {
          const lang = sel.techTier.feLanguage as SupportedLanguage | undefined;
          if (!lang) return [];
          return getFrameworkOptions('frontend', lang);
        }
        case 'beLanguage':
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK['backend'] as readonly string[])?.includes(opt.id),
          );
        case 'beFramework': {
          const lang = sel.techTier.beLanguage as SupportedLanguage | undefined;
          if (!lang) return [];
          return getFrameworkOptions('backend', lang);
        }
      }
    }

    if (step.tierKey === 'visualTier') {
      switch (layerKey) {
        case 'visualLanguage': return VISUAL_LANGUAGE_OPTIONS;
        case 'surfaceSystem': return SURFACE_SYSTEM_OPTIONS;
        case 'spatialSystem': return SPATIAL_SYSTEM_OPTIONS;
      }
    }

    return [];
  }, [state.selections]);

  const selectVariant = useCallback((variantId: string) => {
    const step = activeSteps[state.stepIndex];
    if (!step) return;

    const value = variantId;

    setState(prev => {
      const next = { ...prev, selections: { ...prev.selections } };

      if (step.tierKey === 'techTier') {
        const techSel = { ...next.selections.techTier };
        const changed = techSel[step.layerKey as keyof typeof techSel] !== value;

        switch (step.layerKey) {
          case 'stack':
            if (changed) {
              techSel.stack = value;
              techSel.language = undefined;
              techSel.framework = undefined;
              techSel.feLanguage = undefined;
              techSel.feFramework = undefined;
              techSel.beLanguage = undefined;
              techSel.beFramework = undefined;
              autoSelectLanguage(value, techSel);
            }
            break;
          case 'language':
            if (changed) { techSel.language = value; techSel.framework = undefined; }
            break;
          case 'framework':
            techSel.framework = value;
            break;
          case 'feLanguage':
            if (changed) { techSel.feLanguage = value; techSel.feFramework = undefined; }
            break;
          case 'feFramework':
            techSel.feFramework = value;
            break;
          case 'beLanguage':
            if (changed) { techSel.beLanguage = value; techSel.beFramework = undefined; }
            break;
          case 'beFramework':
            techSel.beFramework = value;
            break;
        }

        next.selections.techTier = techSel;
      } else {
        const visSel = { ...next.selections.visualTier };
        (visSel as any)[step.layerKey] = value;
        next.selections.visualTier = visSel;
      }

      const isLastStep = prev.stepIndex >= activeSteps.length - 1;
      const nextStep = activeSteps[prev.stepIndex + 1];
      const isGroupBoundary = !!step.group && !!nextStep?.group && step.group !== nextStep.group;

      if (isLastStep || isGroupBoundary) return next;
      return { ...next, stepIndex: prev.stepIndex + 1 };
    });
  }, [activeSteps, state.stepIndex]);

  const goToStep = useCallback((index: number) => {
    setState(prev => {
      if (index === prev.stepIndex) return prev;

      const next = { ...prev, stepIndex: index, selections: { ...prev.selections } };

      if (index < prev.stepIndex) {
        if (prev.activeTier === 'techTier') {
          const techSel = { ...next.selections.techTier };
          const steps = techSteps;
          for (let i = index + 1; i < steps.length; i++) {
            const s = steps[i];
            switch (s.layerKey) {
              case 'language': techSel.language = undefined; techSel.framework = undefined; break;
              case 'framework': techSel.framework = undefined; break;
              case 'feLanguage': techSel.feLanguage = undefined; techSel.feFramework = undefined; break;
              case 'feFramework': techSel.feFramework = undefined; break;
              case 'beLanguage': techSel.beLanguage = undefined; techSel.beFramework = undefined; break;
              case 'beFramework': techSel.beFramework = undefined; break;
            }
          }
          next.selections.techTier = techSel;
        } else {
          const visSel = { ...next.selections.visualTier };
          for (let i = index + 1; i < visualSteps.length; i++) {
            (visSel as any)[visualSteps[i].layerKey] = undefined;
          }
          next.selections.visualTier = visSel;
        }
      }

      return next;
    });
  }, [techSteps, visualSteps]);

  const switchTier = useCallback((tier: 'techTier' | 'visualTier') => {
    setState(prev => ({
      ...prev,
      activeTier: tier,
      stepIndex: 0,
    }));
  }, []);

  const getSelectedForStep = useCallback((step: WizardStepDef): string | undefined => {
    return getSelectionValue(state.selections, step);
  }, [state.selections]);

  const derivedLayers = useMemo(() => {
    const vl = state.selections.visualTier.visualLanguage;
    const ss = state.selections.visualTier.spatialSystem;
    return {
      interactionGrammar: vl ? deriveInteractionGrammar(vl as VisualLanguageVariant) : undefined,
      visualHierarchyRules: vl && ss ? deriveVisualHierarchyRules(vl as VisualLanguageVariant, ss as SpatialSystemVariant) : undefined,
    };
  }, [state.selections.visualTier.visualLanguage, state.selections.visualTier.spatialSystem]);

  const draftBasis = useMemo(
    () => buildBasisFromSelections(state.selections),
    [state.selections],
  );

  const isTierSaved = useCallback((tier: 'techTier' | 'visualTier') => {
    const saved = savedBasisRef.current;
    if (tier === 'techTier') return !!saved?.techTier;
    return !!saved?.visualTier;
  }, []);

  const allTiersSaved = useMemo(() => {
    const saved = savedBasisRef.current;
    const techOk = !hasTechTier || !!saved?.techTier;
    const visOk = !hasVisualTier || !!saved?.visualTier;
    return techOk && visOk;
  }, [hasTechTier, hasVisualTier, savedBasisRef.current]);

  const hasPendingChanges = useMemo(() => {
    return JSON.stringify(draftBasis) !== JSON.stringify(savedBasisRef.current);
  }, [draftBasis]);

  const saveDraft = useCallback(() => {
    const basis = buildBasisFromSelections(state.selections);
    savedBasisRef.current = basis;
    updateActionMetadata({ basis });
  }, [state.selections, updateActionMetadata]);

  const discardDraft = useCallback(() => {
    const saved = savedBasisRef.current;
    setState(prev => ({
      ...prev,
      selections: {
        techTier: {
          stack: saved?.techTier?.stack ?? basisSlot.defaults?.stack,
          language: saved?.techTier?.frontend?.language ?? saved?.techTier?.backend?.language,
          framework: saved?.techTier?.frontend?.framework ?? saved?.techTier?.backend?.framework,
          feLanguage: saved?.techTier?.frontend?.language,
          feFramework: saved?.techTier?.frontend?.framework,
          beLanguage: saved?.techTier?.backend?.language,
          beFramework: saved?.techTier?.backend?.framework,
        },
        visualTier: {
          designSystem: saved?.visualTier?.designSystem,
          visualLanguage: saved?.visualTier?.visualLanguage,
          surfaceSystem: saved?.visualTier?.surfaceSystem,
          spatialSystem: saved?.visualTier?.spatialSystem,
        },
      },
    }));
  }, [basisSlot.defaults?.stack]);

  // --- Group navigation ---

  const nextGroupStartIdx = useMemo(() => {
    return findNextGroupStart(activeSteps, state.stepIndex);
  }, [activeSteps, state.stepIndex]);

  const hasNextGroup = nextGroupStartIdx !== null;

  const currentGroupComplete = useMemo(() => {
    if (!currentStep?.group) return true;
    const group = currentStep.group;
    return activeSteps
      .filter(s => s.group === group)
      .every(s => getSelectionValue(state.selections, s) !== undefined);
  }, [currentStep, activeSteps, state.selections]);

  const advanceToNextGroup = useCallback(() => {
    if (nextGroupStartIdx === null) return;
    setState(prev => ({ ...prev, stepIndex: nextGroupStartIdx }));
  }, [nextGroupStartIdx]);

  return {
    state,
    activeSteps,
    currentStep,
    isFullstack,
    hasTechTier,
    hasVisualTier,
    derivedLayers,
    draftBasis,
    savedBasis: savedBasisRef.current,
    hasPendingChanges,
    allTiersSaved,
    getOptionsForStep,
    getSelectedForStep,
    selectVariant,
    goToStep,
    switchTier,
    saveDraft,
    discardDraft,
    isTierSaved,
    hasNextGroup,
    currentGroupComplete,
    advanceToNextGroup,
  };
}
