/**
 * `_shared/verify/freshEntry` — verification's `plan.handleFreshEntry`
 * implementation.
 *
 * Bundles the four side-effects that fire on a brand-new verification
 * task entry: Session creation/hydration, fresh-vs-rehydrated banner,
 * verificationAttempts log, and the install-observation request flag.
 * Returning the `verificationDelta` lets the caller commit the Session
 * reference on the LangGraph reducer delta alongside other entry writes.
 */

import type { ArchitectGraphState } from '../../../state';
import type { FreshEntryResult, InitSessionEnv } from '../types';
import { initSession } from './initSession';

export function handleFreshEntry(
  state: ArchitectGraphState,
  env: InitSessionEnv,
): FreshEntryResult {
  const isResumed = !!state.verification && state.verification.attempts() > 0;
  initSession(state, env);
  const session = state.verification;
  console.log(
    `🔍 [Plan] VerificationSession ${isResumed ? 'rehydrated' : 'initialised'}: ` +
    `required=${session?.required().join('+') ?? ''}, passed=${session?.passed().join('+') ?? ''}`,
  );
  console.log(`🎫 [Plan] verificationAttempts=${session?.attempts() ?? 0}`);
  return {
    verificationDelta: session,
    needsInstallObservation: true,
  };
}
