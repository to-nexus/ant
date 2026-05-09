import { signOut, type SignOutOptions } from './sign-out';
import { fetchAuthMeDetailed } from './fetch-auth';
import type { AuthBroadcaster } from './broadcaster';
import type { AuthMeResult, AuthUser } from './types';

/**
 * Unified logout procedure — both ant-site and ant-ui follow these 5 steps
 * identically. Order matters: state cleanup runs even when the API call
 * fails (so the UI never shows a stale signed-in shell after a failed
 * signout request).
 *
 *   1. POST /api/auth/signout      — surface failures via toast
 *   2. clearLocalState()           — app-specific cascade (Context vs Zustand)
 *   3. broadcaster.post('logout')  — notify other tabs
 *   4. window.location.assign(dest) — hard nav forces re-mount + re-verify
 *   5. on signout failure: showToast('Signed out locally; …') BEFORE step 4
 */
export interface RunUnifiedLogoutOptions {
  apiBase: string;
  destination: string;
  broadcaster: AuthBroadcaster;
  clearLocalState: () => void;
  showSignoutFailureToast?: () => void;
  /** Defaults to `window.location.assign` — overridable for tests. */
  navigate?: (url: string) => void;
}

export async function runUnifiedLogout(
  opts: RunUnifiedLogoutOptions,
): Promise<void> {
  const onError: SignOutOptions['onError'] = (error) => {
    console.warn('[Auth] signout failed; clearing local state anyway', error);
  };
  const result = await signOut({ apiBase: opts.apiBase, onError });

  // Step 2 — local cleanup runs whether or not the API call succeeded.
  try {
    opts.clearLocalState();
  } catch (err) {
    console.error('[Auth] clearLocalState threw', err);
  }

  // Step 3 — notify other tabs.
  try {
    opts.broadcaster.post({ type: 'logout', at: Date.now() });
  } catch (err) {
    console.error('[Auth] broadcaster.post threw', err);
  }

  // Step 5 — surface failure to the user before navigating.
  if (!result.ok) {
    try {
      opts.showSignoutFailureToast?.();
    } catch (err) {
      console.error('[Auth] showSignoutFailureToast threw', err);
    }
  }

  // Step 4 — hard nav. Use assign() so the entry remains in history.
  const navigate = opts.navigate ?? ((url) => window.location.assign(url));
  navigate(opts.destination);
}

/**
 * Unified mount-time session check. Both apps run this at startup with
 * their app-local set/clear callbacks; the discriminated `AuthMeResult`
 * is dispatched identically to avoid the silent-null-collapse trap that
 * masked stale-session bugs in ant-site.
 *
 * Returns the `AuthMeResult` so callers can do app-specific follow-up
 * (e.g. ant-ui dispatches `fetchProjects()` after a successful hydrate).
 */
export interface RunMountSessionCheckOptions {
  apiBase: string;
  /** True when we have a hydrated user from local storage / context. */
  hadHydratedUser: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  /** Called for non-`user` / non-`no-session` outcomes (server hiccup). */
  onNonFatal?: (result: AuthMeResult) => void;
}

export async function runMountSessionCheck(
  opts: RunMountSessionCheckOptions,
): Promise<AuthMeResult> {
  const result = await fetchAuthMeDetailed({ apiBase: opts.apiBase });
  switch (result.kind) {
    case 'user':
      opts.setUser(result.user);
      break;
    case 'no-session':
      if (opts.hadHydratedUser) opts.clearUser();
      break;
    case 'misconfigured':
    case 'http-error':
    case 'network':
    case 'shape':
      // Server hiccup ≠ logout. Do NOT clear user — the cookie may still be
      // valid; the next protected request's 401 interceptor will catch it
      // if it isn't.
      opts.onNonFatal?.(result);
      break;
  }
  return result;
}
