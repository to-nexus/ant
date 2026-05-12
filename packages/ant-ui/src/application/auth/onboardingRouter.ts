/**
 * Onboarding Routing SSOT
 *
 * Two trigger sources converge into a single boolean (`shouldShowOnboarding`)
 * that App.tsx renders against:
 *
 *  1. URL query `?onboarding=true` — set by the BE OAuth callback when
 *     the JWT was minted with the `_pending` sentinel.
 *  2. `/auth/me` response `needsOnboarding === true` — runs on every
 *     mount AND after the OAuth callback's `auth=success` redirect, so
 *     refreshes also catch in-flight onboarding state.
 *
 * The URL flag is only useful as an early "switch immediately" signal —
 * the authoritative source is `/auth/me`. We strip the flag after
 * reading so the URL stays clean on subsequent navigations.
 */

/**
 * Look at the current location and return `true` when the OAuth
 * callback flagged the user as needing onboarding. The implementation
 * is intentionally trivial — the App effect that consumes this should
 * also call `clearOnboardingQueryFlag` so the URL doesn't keep
 * re-triggering the prompt across remounts.
 */
export function detectOnboardingFlagFromUrl(search?: string): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(search ?? window.location.search);
  return params.get('onboarding') === 'true';
}

/**
 * Strip `?onboarding=...` from the URL without disrupting React Router
 * state. Use `replaceState` so the back button doesn't bring the flag
 * back.
 */
export function clearOnboardingQueryFlag(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('onboarding')) return;
  url.searchParams.delete('onboarding');
  window.history.replaceState({}, '', url.toString());
}

/**
 * Final decision predicate. Renders OnboardingScreen iff:
 *   - server mode is cloud (local mode has no remote identity)
 *   - the user is authenticated (`userEmail` is set), AND
 *   - the BE indicated onboarding is required.
 *
 * `serverMode === null` (BE config not yet loaded) returns `false` so we
 * don't pop the onboarding modal before the BE has confirmed cloud.
 */
export function shouldShowOnboarding(params: {
  serverMode: 'local' | 'cloud' | null;
  userEmail: string | undefined;
  needsOnboarding: boolean;
}): boolean {
  return params.serverMode === 'cloud' && !!params.userEmail && params.needsOnboarding;
}
