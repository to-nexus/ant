import {
  fetchAuthMeDetailed as fetchAuthMeDetailedShared,
  fetchAuthMe as fetchAuthMeShared,
  signOut as signOutShared,
  type AuthMeResult,
  type AuthUser,
} from '@ant/auth-client';
import { API_BASE } from './client';

/**
 * Thin app-local shims over `@ant/auth-client`. Both ant-site and ant-ui
 * share the same fetch / signout primitives — this file binds them to
 * ant-ui's `API_BASE()` resolver (cloud / local / Vite-proxy aware).
 */

export type { AuthMeResult, AuthUser };

export async function fetchAuthMeDetailed(): Promise<AuthMeResult> {
  return fetchAuthMeDetailedShared({ apiBase: API_BASE() });
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  return fetchAuthMeShared({ apiBase: API_BASE() });
}

/**
 * Sign out — clears the JWT cookie server-side. Always resolves; failures
 * are surfaced via the optional `onError` callback (the unified logout
 * procedure uses this to show a toast). Local cleanup + navigation are
 * the caller's responsibility — see `runUnifiedLogout` in `@ant/auth-client`.
 */
export async function signOut(opts?: {
  onError?: (error: unknown) => void;
}): Promise<void> {
  await signOutShared({
    apiBase: API_BASE(),
    onError: opts?.onError,
  });
}
