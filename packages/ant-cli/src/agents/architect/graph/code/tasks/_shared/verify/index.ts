/**
 * `tasks/_shared/verify/` — verification responsibility SSOT.
 *
 * Barrel exports the public surface of the verify-mode infrastructure
 * shared by every task that owns a verification cycle:
 *
 *   - Tier 3/4 dedicated verification task — `tasks/verification/`
 *     bundle wires these hooks directly.
 *   - Tier 2 self-verify task (error/feature/ui/setup with
 *     `selfVerifyOnDone:true`) — composes verify-mode dispatch via
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
// pull `registry` into every task bundle's import graph (each bundle
// imports `composeBundle` from this barrel), creating a registry → bundle
// → barrel → registry cycle that returns `undefined` for every bundle
// member. Phase code imports them directly from `./activeHooks`.

// Model layer
export { VerificationSession, DEEP_DIAGNOSTIC_THRESHOLD } from './Session';
export type { VerificationSessionEnv } from './Session';
export type { VerificationSnapshot } from './snapshot';
export { EMPTY_SNAPSHOT } from './snapshot';
export {
  GATE_ORDER,
  getMissingStepDetail,
  isDiagnosticInspectCommand,
} from './gates';
export type { Gate, MissingStepDetail } from './gates';
export {
  VerificationTerminalError,
  classifyTerminalError,
} from './errors';
export type { VerificationTerminalKind, TerminalClassification } from './errors';
export { normalizePlanForHash, countRepeatedHash } from './planHash';

// Hook implementations
export { initSession } from './initSession';
export { buildPrompt, buildPrompt as buildPlanPrompt } from './buildPlanPrompt';
export { checkRetryTermination } from './checkRetryTermination';

// Session lifecycle SSOT — phase code uses these instead of touching
// Session methods or `markVerifyEntered` directly.
export {
  onReverifyEntry,
  onInstallObserved,
  onPlanApplied,
  onBatchSplit,
  clearForTaskBoundary,
} from './sessionLifecycle';

// emptyImpl predicates — `assertVerificationPlanIsFanoutOnly` is
// dev-only and consumed exclusively by `nodes/plan/outcome/finalize.ts`,
// so it is not re-exported here (single import path enforces single
// caller).
export {
  hasEmptyImplementation,
  isVerificationPassWithoutCodeGen,
} from './emptyImpl';
