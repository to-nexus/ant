/**
 * Clarify gate facade.
 *
 * Re-exports the intent-commit SSOT in a clarify-scoped namespace so
 * consumers looking for "clarify gating" land on the right predicate
 * without having to know the broader `intentCommit` module.
 *
 * The ONLY clarify surface currently gated by this predicate is
 * `<specClarify>` (decompose). See `intentCommit.ts` for the reasoning.
 */

export {
  isIntentCommitted,
  buildIntentClarifyTemplateVars,
} from '../intentCommit';
export type { IntentCommittedState } from '../intentCommit';
