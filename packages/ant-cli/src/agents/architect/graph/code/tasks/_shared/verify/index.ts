/**
 * `tasks/_shared/verify/` — verification responsibility SSOT.
 *
 * Barrel exports the public surface of the verify-mode infrastructure
 * shared by every task that owns a verification cycle:
 *
 *   - Tier 3/4 dedicated verification task — `tasks/verification/`
 *     bundle wires these hooks directly.
 *   - Tier 2 self-verify task (error/feature/ui/setup with
 *     `selfVerifyOnDone:true`) — composes verify-mode router via
 *     `composeBundle({...})`.
 *
 * Phase nodes and external consumers should import from this barrel
 * (preferred) or from individual sibling modules (when only one symbol
 * is needed).
 *
 * R2 — none of these modules import from `nodes/`, `routers/`, or
 * `parallel/`.
 */

// Predicate + state helper
export { requiresVerification } from './predicate';
export {
  markVerifyEntered,
  isVerifyEntered,
  resetVerifyEntered,
} from './markVerifyEntered';

// Bundle composition helper
export { composeBundle, isVerifyModeActive } from './composeBundle';
export type { ComposeBundleInput } from './composeBundle';

// NOTE: phase-mode hook resolvers (`activeExecuteHook`, `activePlanBuildPrompt`)
// live in `./activeHooks` and MUST NOT be re-exported here — they import
// from `../registry`, and re-exporting them through this barrel would
// pull `registry` into every task bundle's import graph.

export {
  VerificationTerminalError,
  classifyTerminalError,
} from './terminal/errors';
export type { VerificationTerminalKind, TerminalClassification } from './terminal/errors';

// Verify-mode plan-prompt builder (consumed by activeHooks dispatcher).
export { buildPrompt, buildPrompt as buildPlanPrompt } from './prompt/buildPlanPrompt';

// VerificationBudget aggregate — read+write surface for the axes that
// determine "should this verification cycle continue?".
export {
  VerificationBudget,
  BUDGET_THRESHOLDS,
} from './terminal/budget';
export type { BudgetSnapshot, TerminalReason } from './terminal/budget';

// emptyImpl predicates.
export {
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
} from './emptyImpl';
