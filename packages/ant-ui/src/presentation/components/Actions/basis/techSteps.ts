/**
 * Pure tech-tier wizard step computation — extracted from `useBasisWizard.ts`
 * so the step-pruning contract is testable without importing the hook's
 * store/SSE dependency chain (node-environment policy tests).
 */
import {
  getValidFrameworks,
  type SupportedLanguage,
  type SupportedStack,
  type Domain,
} from '@ant/shared';
import { TECH_STEPS, FULLSTACK_STEPS } from './constants';
import { GAME_ENGINE_STEP } from './TierStepDef';
import type { BasisWizardState, WizardStepDef } from './types';

export const AUTO = '__auto__';

export function isReal(val: string | undefined): val is string {
  return !!val && val !== AUTO;
}

// Pure step-set computation. Module-scoped so `selectVariant` can compute the
// post-pick step set inline (and avoid the closure-staleness bug where
// `isLastStep` was judged against a pre-prune snapshot, blocking the natural
// advance after the user picks a real upstream value).
export function computeTechSteps(
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
    if (isReal(sel.language)) {
      // Zero-framework languages (e.g. html) have no framework layer — the
      // step would render an empty option list, so it is pruned entirely.
      const stack = isReal(sel.stack) ? (sel.stack as SupportedStack) : undefined;
      const frameworkless = !!stack && stack !== 'fullstack'
        && getValidFrameworks(stack, sel.language as SupportedLanguage).length === 0;
      if (!frameworkless) steps.push(TECH_STEPS[2]);
    }
  }
  // Game-engine 5th slot (game domain only, frontend or fullstack).
  if (domain === 'game' && (sel.stack === 'frontend' || sel.stack === 'fullstack')) {
    steps.push(GAME_ENGINE_STEP);
  }
  return steps;
}
