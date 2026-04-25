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
export {
  collectConfigSnapshot,
  renderConfigBlock,
} from './configSnapshot';
export type { CollectedConfig } from './configSnapshot';

// Hook implementations
export { initSession } from './initSession';
export { buildPrompt, buildPrompt as buildPlanPrompt } from './buildPlanPrompt';
export { checkRetryTermination } from './checkRetryTermination';
