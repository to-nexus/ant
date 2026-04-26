import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useStore } from '@/domain/store';
import {
  type Basis,
  type BasisSlotConfig,
  type BasisOption,
  type SupportedLanguage,
  type SupportedStack,
  type TechTierConfig,
  type VisualTier,
  type GameArtTier,
  type GameContentTier,
  type Domain,
  type GameEngine,
  STACK_OPTIONS,
  TECH_TIER_LANGUAGES,
  VALID_LANGUAGES_BY_STACK,
  getFrameworkOptions,
  buildBasisPreset,
  VISUAL_LANGUAGE_OPTIONS,
  SURFACE_SYSTEM_OPTIONS,
  GAME_ENGINE_OPTIONS,
  GAME_ART_CONCEPT_OPTIONS,
  GAME_ART_PERSPECTIVE_OPTIONS,
  GAME_GENRE_OPTIONS,
  GAME_CORE_LOOP_OPTIONS,
  deriveInteractionGrammar,
  listActiveTiers,
  getEffectiveDomain,
  pathsContainUiDoc,
  type VisualLanguageVariant,
} from '@ant/shared';
import {
  TECH_STEPS,
  FULLSTACK_STEPS,
  VISUAL_STEPS,
  pickInitialTier,
} from './constants';
import {
  GAME_ENGINE_STEP,
  GAME_ART_STEPS,
  GAME_CONTENT_STEPS,
} from './TierStepDef';
import type { BasisWizardState, TierKey, WizardStepDef } from './types';

const AUTO = '__auto__';

function isReal(val: string | undefined): val is string {
  return !!val && val !== AUTO;
}

/**
 * Build a `Basis` from wizard selections (Phase 1 — 4 tiers).
 *
 * Uses `buildBasisPreset` for techTier+visualTier. gameArtTier+gameContentTier
 * are passed through directly because their shape matches the runtime
 * Basis fields 1:1 (no derivation needed). The `gameEngine` 5th slot is
 * stored on the active TechTier entry (frontend or single stack).
 */
function buildBasisFromSelections(
  selections: BasisWizardState['selections'],
  domain: Domain,
): Basis | undefined {
  const stack = isReal(selections.techTier.stack) ? selections.techTier.stack : undefined;

  const tiers: Record<string, { language?: string; framework?: string; gameEngine?: GameEngine }> = {};
  const wantsGameEngine = domain === 'game' && isReal(selections.techTier.gameEngine);
  const gameEngineValue = wantsGameEngine ? (selections.techTier.gameEngine as GameEngine) : undefined;
  if (stack === 'fullstack') {
    const feLang = isReal(selections.techTier.feLanguage) ? selections.techTier.feLanguage : undefined;
    const beLang = isReal(selections.techTier.beLanguage) ? selections.techTier.beLanguage : undefined;
    const feFw = isReal(selections.techTier.feFramework) ? selections.techTier.feFramework : undefined;
    const beFw = isReal(selections.techTier.beFramework) ? selections.techTier.beFramework : undefined;
    if (feLang) {
      tiers.frontend = { language: feLang, framework: feFw, gameEngine: gameEngineValue };
    } else if (wantsGameEngine) {
      // D3 — gameEngine alone (no FE language picked yet) still gets a
      // frontend tier so downstream LLM sees the engine hint. Without
      // this, fullstack + game projects with gameEngine=phaser but
      // no feLanguage would silently drop the engine value.
      tiers.frontend = { gameEngine: gameEngineValue };
    }
    if (beLang) tiers.backend = { language: beLang, framework: beFw };
  } else {
    const lang = isReal(selections.techTier.language) ? selections.techTier.language : undefined;
    const fw = isReal(selections.techTier.framework) ? selections.techTier.framework : undefined;
    if (stack && lang) {
      tiers[stack] = {
        language: lang,
        framework: fw,
        // Game engine attaches to frontend tier in single-frontend stacks.
        gameEngine: stack === 'frontend' ? gameEngineValue : undefined,
      };
    } else if (wantsGameEngine && stack === 'frontend') {
      // gameEngine alone (no language picked yet) — still expose so
      // downstream LLM gets at least the engine hint.
      tiers.frontend = { gameEngine: gameEngineValue };
    }
  }

  const vt: Partial<VisualTier> = {};
  const vl = selections.visualTier.visualLanguage;
  const ss = selections.visualTier.surfaceSystem;
  if (isReal(vl)) vt.visualLanguage = vl as any;
  if (isReal(ss)) vt.surfaceSystem = ss as any;

  const gat: Partial<GameArtTier> = {};
  if (isReal(selections.gameArtTier.concept)) gat.concept = selections.gameArtTier.concept as any;
  if (isReal(selections.gameArtTier.perspective)) gat.perspective = selections.gameArtTier.perspective as any;

  const gct: Partial<GameContentTier> = {};
  if (isReal(selections.gameContentTier.genre)) gct.genre = selections.gameContentTier.genre as any;
  if (isReal(selections.gameContentTier.coreLoop)) gct.coreLoop = selections.gameContentTier.coreLoop as any;

  const ds = selections.visualTier.designSystem;
  const basis = buildBasisPreset({
    stack: stack || undefined,
    tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
    designSystem: isReal(ds) ? ds : undefined,
    visualTier: Object.keys(vt).length > 0 ? (vt as any) : undefined,
    gameArtTier: Object.keys(gat).length > 0 ? gat : undefined,
    gameContentTier: Object.keys(gct).length > 0 ? gct : undefined,
  });

  return (basis.techTier || basis.visualTier || basis.gameArtTier || basis.gameContentTier) ? basis : undefined;
}

// Pure step-set computation. Hoisted to module scope so `selectVariant` can
// compute the post-pick step set inline (and avoid the closure-staleness bug
// where `isLastStep` was judged against a pre-prune snapshot, blocking the
// natural advance after the user picks a real upstream value).
function computeTechSteps(
  selections: BasisWizardState['selections'],
  hasTechTier: boolean,
  hasDefaultStack: boolean,
  domain: Domain,
  hasLockedStack: boolean,
): WizardStepDef[] {
  if (!hasTechTier) return [];
  const sel = selections.techTier;
  const isFullstack = sel.stack === 'fullstack';
  const steps: WizardStepDef[] = [];
  // `lockedStack` (intent identity already pins the stack — gen-sys-fe / -be
  // / -full) and `hasDefaultStack` (per-domain seed) both make the Stack
  // step redundant; the wizard should never let the user pick a value the
  // intent matrix has already decided.
  if (!hasDefaultStack && !hasLockedStack) {
    steps.push(TECH_STEPS[0]);
    if (!isReal(sel.stack)) return steps;
  }
  if (isFullstack) {
    steps.push(FULLSTACK_STEPS[0]);
    if (isReal(sel.feLanguage)) steps.push(FULLSTACK_STEPS[1]);
    steps.push(FULLSTACK_STEPS[2]);
    if (isReal(sel.beLanguage)) steps.push(FULLSTACK_STEPS[3]);
  } else {
    steps.push(TECH_STEPS[1]);
    if (isReal(sel.language)) steps.push(TECH_STEPS[2]);
  }
  // Game-engine 5th slot (game domain only, frontend or fullstack).
  if (domain === 'game' && (sel.stack === 'frontend' || sel.stack === 'fullstack')) {
    steps.push(GAME_ENGINE_STEP);
  }
  return steps;
}

function computeVisualSteps(
  selections: BasisWizardState['selections'],
  hasVisualTier: boolean,
): WizardStepDef[] {
  if (!hasVisualTier) return [];
  const sel = selections.visualTier;
  const steps: WizardStepDef[] = [];
  steps.push(VISUAL_STEPS[0]);
  if (isReal(sel.visualLanguage)) steps.push(VISUAL_STEPS[1]);
  return steps;
}

function computeGameArtSteps(hasGameArtTier: boolean): WizardStepDef[] {
  return hasGameArtTier ? [...GAME_ART_STEPS] : [];
}

function computeGameContentSteps(hasGameContentTier: boolean): WizardStepDef[] {
  return hasGameContentTier ? [...GAME_CONTENT_STEPS] : [];
}

function getSelectionValue(sel: BasisWizardState['selections'], step: WizardStepDef): string | undefined {
  switch (step.tierKey) {
    case 'techTier':
      return (sel.techTier as Record<string, string | undefined>)[step.layerKey];
    case 'visualTier':
      return (sel.visualTier as Record<string, string | undefined>)[step.layerKey];
    case 'gameArtTier':
      return (sel.gameArtTier as Record<string, string | undefined>)[step.layerKey];
    case 'gameContentTier':
      return (sel.gameContentTier as Record<string, string | undefined>)[step.layerKey];
  }
}

function findNextGroupStart(steps: WizardStepDef[], currentIdx: number): number | null {
  const currentGroup = steps[currentIdx]?.group;
  if (!currentGroup) return null;
  for (let i = currentIdx + 1; i < steps.length; i++) {
    if (steps[i].group !== currentGroup) return i;
  }
  return null;
}

export function useBasisWizard(
  basisSlot: BasisSlotConfig,
  initialTier?: TierKey,
) {
  const actionMetadata = useStore(s => s.actionMetadata);
  const updateActionMetadata = useStore(s => s.updateActionMetadata);
  const currentBasis = actionMetadata.basis;
  const effectiveDomain = getEffectiveDomain(actionMetadata.domain);

  const savedBasisRef = useRef<Basis | undefined>(currentBasis);

  const [state, setState] = useState<BasisWizardState>(() => {
    // Seed priority (highest → lowest):
    //   1. `lockedStack` — intent identity decides the stack (gen-sys-*).
    //   2. saved `currentBasis.techTier.stack` — user's prior pick.
    //   3. `defaults[domain]` — per-domain seed.
    // When `lockedStack` overrides a previously-different stack, dependent
    // fields (language / framework / feLanguage / etc.) must be cleared:
    // a fullstack `feLanguage` makes no sense once the lock pins us to a
    // single-side stack, and vice versa.
    const lockedStack = basisSlot.lockedStack;
    const domainDefaults = basisSlot.defaults?.[effectiveDomain];
    const stashedStack = currentBasis?.techTier?.stack;
    const seedStack = lockedStack ?? stashedStack ?? domainDefaults?.stack;
    const lockOverridesStashed = !!lockedStack && !!stashedStack && lockedStack !== stashedStack;

    const seedGameEngine = currentBasis?.techTier?.frontend?.gameEngine
      ?? currentBasis?.techTier?.backend?.gameEngine
      ?? domainDefaults?.gameEngine;

    return {
      activeTier: pickInitialTier(basisSlot, initialTier),
      stepIndex: 0,
      selections: {
        techTier: {
          stack: seedStack,
          language: lockOverridesStashed
            ? undefined
            : currentBasis?.techTier?.frontend?.language ?? currentBasis?.techTier?.backend?.language,
          framework: lockOverridesStashed
            ? undefined
            : currentBasis?.techTier?.frontend?.framework ?? currentBasis?.techTier?.backend?.framework,
          feLanguage: lockOverridesStashed ? undefined : currentBasis?.techTier?.frontend?.language,
          feFramework: lockOverridesStashed ? undefined : currentBasis?.techTier?.frontend?.framework,
          beLanguage: lockOverridesStashed ? undefined : currentBasis?.techTier?.backend?.language,
          beFramework: lockOverridesStashed ? undefined : currentBasis?.techTier?.backend?.framework,
          gameEngine: seedGameEngine,
        },
        visualTier: {
          designSystem: currentBasis?.visualTier?.designSystem,
          visualLanguage: currentBasis?.visualTier?.visualLanguage,
          surfaceSystem: currentBasis?.visualTier?.surfaceSystem,
        },
        gameArtTier: {
          concept: currentBasis?.gameArtTier?.concept,
          perspective: currentBasis?.gameArtTier?.perspective,
        },
        gameContentTier: {
          genre: currentBasis?.gameContentTier?.genre,
          coreLoop: currentBasis?.gameContentTier?.coreLoop,
        },
      },
    };
  });

  const hasTechTier = !!basisSlot.tiers?.includes('techTier');
  const hasDefaultStack = !!basisSlot.defaults?.[effectiveDomain]?.stack;
  const hasLockedStack = !!basisSlot.lockedStack;
  const isFullstack = state.selections.techTier.stack === 'fullstack';

  // Runtime Visual Tier gate: backend-only stacks have no visual policy.
  // Reacts to live stack selection so the tab appears/disappears as the user edits.
  const currentTechTierForGate = useMemo<TechTierConfig | undefined>(() => {
    const stack = state.selections.techTier.stack;
    if (!stack || stack === AUTO) return undefined;
    return { stack: stack as any };
  }, [state.selections.techTier.stack]);

  // UI design docs (ant / figma / handoff) that the user included in RAC
  // (refs or context) act as the design-system authority — when present,
  // the Visual Tier gate must close regardless of other inputs. SSOT'd
  // with BE via the matrix gate (`isTierActive('visualTier', ...)`).
  const hasUiDoc = useMemo(
    () => pathsContainUiDoc([
      ...(actionMetadata.refs ?? []),
      ...(actionMetadata.context ?? []),
    ]),
    [actionMetadata.refs, actionMetadata.context],
  );

  // SSOT D27 — `listActiveTiers` (in @ant/shared) is the single facade
  // that combines slot opt-in, the domain × tier matrix, and runtime
  // suppressors. The `TIER_REGISTRY.isConfigured` check is redundant with
  // step 1 inside `isTierActive` (`slot.tiers?.includes(tier)`); we keep
  // the registry as the canonical iteration order via `availableTiers`'s
  // ordering downstream.
  const availableTiers = useMemo<TierKey[]>(
    () => listActiveTiers(basisSlot, effectiveDomain, {
      techTier: currentTechTierForGate,
      hasUiDoc,
    }),
    [basisSlot, effectiveDomain, currentTechTierForGate, hasUiDoc],
  );

  const isTierAvailable = useCallback(
    (tier: TierKey): boolean => availableTiers.includes(tier),
    [availableTiers],
  );

  const hasVisualTier = isTierAvailable('visualTier');
  const hasGameArtTier = isTierAvailable('gameArtTier');
  const hasGameContentTier = isTierAvailable('gameContentTier');

  // Cascade prune: when an upstream layer resolves to AUTO/undefined, downstream
  // steps are dropped from the wizard entirely. "Not set = auto-detect" is the
  // SSOT for UI — we never force the user through a step whose context already
  // says "let the system decide". `getOptionsForStep`'s `isReal()` gating is
  // kept as defense-in-depth against a future regression here.
  const techSteps = useMemo(
    () => computeTechSteps(state.selections, hasTechTier, hasDefaultStack, effectiveDomain, hasLockedStack),
    [state.selections, hasTechTier, hasDefaultStack, effectiveDomain, hasLockedStack],
  );

  const visualSteps = useMemo(
    () => computeVisualSteps(state.selections, hasVisualTier),
    [state.selections, hasVisualTier],
  );

  const gameArtSteps = useMemo(
    () => computeGameArtSteps(hasGameArtTier),
    [hasGameArtTier],
  );

  const gameContentSteps = useMemo(
    () => computeGameContentSteps(hasGameContentTier),
    [hasGameContentTier],
  );

  const activeSteps = useMemo<WizardStepDef[]>(() => {
    switch (state.activeTier) {
      case 'techTier': return techSteps;
      case 'visualTier': return visualSteps;
      case 'gameArtTier': return gameArtSteps;
      case 'gameContentTier': return gameContentSteps;
    }
  }, [state.activeTier, techSteps, visualSteps, gameArtSteps, gameContentSteps]);

  const currentStep = activeSteps[state.stepIndex];

  // Cascade prune (techSteps/visualSteps useMemo) can shrink activeSteps below
  // the current stepIndex (e.g. user picks AUTO on language → framework step
  // disappears). Clamp so we never index past the end.
  useEffect(() => {
    if (state.stepIndex >= activeSteps.length) {
      setState(prev => ({ ...prev, stepIndex: Math.max(0, activeSteps.length - 1) }));
    }
  }, [activeSteps.length, state.stepIndex]);

  const getOptionsForStep = useCallback((step: WizardStepDef): BasisOption[] => {
    const { layerKey } = step;
    const sel = state.selections;

    if (step.tierKey === 'techTier') {
      switch (layerKey) {
        case 'stack':
          return STACK_OPTIONS;
        case 'language': {
          const stack = isReal(sel.techTier.stack) ? (sel.techTier.stack as SupportedStack) : undefined;
          if (!stack) return [];
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK[stack] as readonly string[])?.includes(opt.id),
          );
        }
        case 'framework': {
          const stack = isReal(sel.techTier.stack) ? (sel.techTier.stack as SupportedStack) : undefined;
          const lang = isReal(sel.techTier.language) ? (sel.techTier.language as SupportedLanguage) : undefined;
          if (!stack || !lang || stack === 'fullstack') return [];
          return getFrameworkOptions(stack as 'frontend' | 'backend', lang);
        }
        case 'feLanguage':
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK['frontend'] as readonly string[])?.includes(opt.id),
          );
        case 'feFramework': {
          const lang = isReal(sel.techTier.feLanguage) ? (sel.techTier.feLanguage as SupportedLanguage) : undefined;
          if (!lang) return [];
          return getFrameworkOptions('frontend', lang);
        }
        case 'beLanguage':
          return TECH_TIER_LANGUAGES.filter(opt =>
            (VALID_LANGUAGES_BY_STACK['backend'] as readonly string[])?.includes(opt.id),
          );
        case 'beFramework': {
          const lang = isReal(sel.techTier.beLanguage) ? (sel.techTier.beLanguage as SupportedLanguage) : undefined;
          if (!lang) return [];
          return getFrameworkOptions('backend', lang);
        }
        case 'gameEngine':
          return GAME_ENGINE_OPTIONS;
      }
    }

    if (step.tierKey === 'visualTier') {
      switch (layerKey) {
        case 'visualLanguage': return VISUAL_LANGUAGE_OPTIONS;
        case 'surfaceSystem': return SURFACE_SYSTEM_OPTIONS;
      }
    }

    if (step.tierKey === 'gameArtTier') {
      switch (layerKey) {
        case 'concept': return GAME_ART_CONCEPT_OPTIONS;
        case 'perspective': return GAME_ART_PERSPECTIVE_OPTIONS;
      }
    }

    if (step.tierKey === 'gameContentTier') {
      switch (layerKey) {
        case 'genre': return GAME_GENRE_OPTIONS;
        case 'coreLoop': return GAME_CORE_LOOP_OPTIONS;
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
        const changed = (techSel as Record<string, string | undefined>)[step.layerKey] !== value;

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
              // gameEngine is stack-aware; backend-only stack invalidates it.
              if (value === 'backend') techSel.gameEngine = undefined;
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
          case 'gameEngine':
            techSel.gameEngine = value;
            break;
        }

        next.selections.techTier = techSel;
      } else if (step.tierKey === 'visualTier') {
        const visSel = { ...next.selections.visualTier };
        (visSel as Record<string, string | undefined>)[step.layerKey] = value;
        next.selections.visualTier = visSel;
      } else if (step.tierKey === 'gameArtTier') {
        const gatSel = { ...next.selections.gameArtTier };
        (gatSel as Record<string, string | undefined>)[step.layerKey] = value;
        next.selections.gameArtTier = gatSel;
      } else if (step.tierKey === 'gameContentTier') {
        const gctSel = { ...next.selections.gameContentTier };
        (gctSel as Record<string, string | undefined>)[step.layerKey] = value;
        next.selections.gameContentTier = gctSel;
      }

      // AUTO selection prunes downstream steps. Don't advance — the user's
      // intent ("let it auto-detect") is fully expressed without further input.
      const valueIsAuto = value === AUTO;
      if (valueIsAuto) return next;

      // Compute the *post-pick* step set. Critical: judging `isLastStep` from
      // the closure-captured `activeSteps` is wrong, because picking a real
      // upstream value (e.g. stack=frontend on initial render where activeSteps
      // was [stack]) un-prunes downstream steps. Recompute from the new
      // selections so the natural advance happens on the first click.
      let newActiveSteps: WizardStepDef[];
      switch (step.tierKey) {
        case 'techTier':
          newActiveSteps = computeTechSteps(next.selections, hasTechTier, hasDefaultStack, effectiveDomain, hasLockedStack);
          break;
        case 'visualTier':
          newActiveSteps = computeVisualSteps(next.selections, hasVisualTier);
          break;
        case 'gameArtTier':
          newActiveSteps = computeGameArtSteps(hasGameArtTier);
          break;
        case 'gameContentTier':
          newActiveSteps = computeGameContentSteps(hasGameContentTier);
          break;
      }

      const isLastStep = prev.stepIndex >= newActiveSteps.length - 1;
      const nextStep = newActiveSteps[prev.stepIndex + 1];
      const isGroupBoundary = !!step.group && !!nextStep?.group && step.group !== nextStep.group;

      if (isLastStep || isGroupBoundary) return next;
      return { ...next, stepIndex: prev.stepIndex + 1 };
    });
  }, [activeSteps, state.stepIndex, hasTechTier, hasDefaultStack, hasLockedStack, hasVisualTier, hasGameArtTier, hasGameContentTier, effectiveDomain]);

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
              case 'gameEngine': techSel.gameEngine = undefined; break;
            }
          }
          next.selections.techTier = techSel;
        } else if (prev.activeTier === 'visualTier') {
          const visSel = { ...next.selections.visualTier };
          for (let i = index + 1; i < visualSteps.length; i++) {
            (visSel as Record<string, string | undefined>)[visualSteps[i].layerKey] = undefined;
          }
          next.selections.visualTier = visSel;
        } else if (prev.activeTier === 'gameArtTier') {
          const gatSel = { ...next.selections.gameArtTier };
          for (let i = index + 1; i < gameArtSteps.length; i++) {
            (gatSel as Record<string, string | undefined>)[gameArtSteps[i].layerKey] = undefined;
          }
          next.selections.gameArtTier = gatSel;
        } else if (prev.activeTier === 'gameContentTier') {
          const gctSel = { ...next.selections.gameContentTier };
          for (let i = index + 1; i < gameContentSteps.length; i++) {
            (gctSel as Record<string, string | undefined>)[gameContentSteps[i].layerKey] = undefined;
          }
          next.selections.gameContentTier = gctSel;
        }
      }

      return next;
    });
  }, [techSteps, visualSteps, gameArtSteps, gameContentSteps]);

  const switchTier = useCallback((tier: TierKey) => {
    setState(prev => ({
      ...prev,
      activeTier: tier,
      stepIndex: 0,
    }));
  }, []);

  const getSelectedForStep = useCallback((step: WizardStepDef): string | undefined => {
    return getSelectionValue(state.selections, step);
  }, [state.selections]);

  // visualHierarchyRules (VL + spatial) cannot be previewed in the wizard
  // because spatialSystem is decided at decompose time. Only interactionGrammar
  // is pure-function of visualLanguage and can be shown live.
  const derivedLayers = useMemo(() => {
    const vl = state.selections.visualTier.visualLanguage;
    return {
      interactionGrammar: vl ? deriveInteractionGrammar(vl as VisualLanguageVariant) : undefined,
    };
  }, [state.selections.visualTier.visualLanguage]);

  const draftBasis = useMemo(
    () => buildBasisFromSelections(state.selections, effectiveDomain),
    [state.selections, effectiveDomain],
  );

  const isTierSaved = useCallback((tier: TierKey): boolean => {
    const saved = savedBasisRef.current;
    if (!saved) return false;
    // gameArtTier / gameContentTier / techTier / visualTier are 1:1 keys
    // on Basis. The cast is safe because TierKey enumerates exactly those
    // four keys (D23 removed `'domain'`).
    return !!(saved as Record<string, unknown>)[tier];
  }, []);

  const allTiersSaved = useMemo(() => {
    return availableTiers.every((tier) => isTierSaved(tier));
  }, [availableTiers, isTierSaved]);

  const hasPendingChanges = useMemo(() => {
    return JSON.stringify(draftBasis) !== JSON.stringify(savedBasisRef.current);
  }, [draftBasis]);

  const saveDraft = useCallback(() => {
    const basis = buildBasisFromSelections(state.selections, effectiveDomain);
    savedBasisRef.current = basis;
    updateActionMetadata({ basis });
  }, [state.selections, effectiveDomain, updateActionMetadata]);

  const discardDraft = useCallback(() => {
    const saved = savedBasisRef.current;
    const domainDefaults = basisSlot.defaults?.[effectiveDomain];
    const lockedStack = basisSlot.lockedStack;
    setState(prev => ({
      ...prev,
      selections: {
        techTier: {
          stack: lockedStack ?? saved?.techTier?.stack ?? domainDefaults?.stack,
          language: saved?.techTier?.frontend?.language ?? saved?.techTier?.backend?.language,
          framework: saved?.techTier?.frontend?.framework ?? saved?.techTier?.backend?.framework,
          feLanguage: saved?.techTier?.frontend?.language,
          feFramework: saved?.techTier?.frontend?.framework,
          beLanguage: saved?.techTier?.backend?.language,
          beFramework: saved?.techTier?.backend?.framework,
          gameEngine: saved?.techTier?.frontend?.gameEngine ?? saved?.techTier?.backend?.gameEngine ?? domainDefaults?.gameEngine,
        },
        visualTier: {
          designSystem: saved?.visualTier?.designSystem,
          visualLanguage: saved?.visualTier?.visualLanguage,
          surfaceSystem: saved?.visualTier?.surfaceSystem,
        },
        gameArtTier: {
          concept: saved?.gameArtTier?.concept,
          perspective: saved?.gameArtTier?.perspective,
        },
        gameContentTier: {
          genre: saved?.gameContentTier?.genre,
          coreLoop: saved?.gameContentTier?.coreLoop,
        },
      },
    }));
  }, [basisSlot.defaults, basisSlot.lockedStack, effectiveDomain]);

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
    /** Tiers currently available (configured + runtime-gated), in registry order. */
    availableTiers,
    /** Per-tier availability check; pairs with `availableTiers` for callers
     *  that just want a boolean for a specific tier. */
    isTierAvailable,
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
