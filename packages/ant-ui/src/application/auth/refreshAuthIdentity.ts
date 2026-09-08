/**
 * Single owner of "re-read `/auth/me` and apply it to the store".
 *
 * The apply is all-or-nothing by construction — `applyAuthMe` takes the whole
 * envelope — which is the invariant three hand-rolled refetch helpers used to
 * break: they refreshed the join surface and dropped `memberships`, so an
 * accepted invite or a domain join never reached the account switcher (or the
 * org panel's own team list) until a page refresh.
 *
 * Failure policy stays with the caller — boot wants `clearUser` on
 * `no-session` and a project fan-out on success, an in-app refresh wants a
 * silent no-op — so the raw discriminated result is returned, not absorbed.
 */

import { fetchAuthMeDetailed } from '@/infrastructure/http/api/auth';
import { useStore } from '@/domain/store';
import type { AuthMeResult } from '@ant/auth-client/types';

export interface AuthIdentityRefresh {
  result: AuthMeResult;
  /**
   * `userEmail` presence sampled immediately BEFORE the apply — boot's "is
   * this the first restore of this session?" test, which is unreadable once
   * the envelope has landed.
   */
  hadUserBefore: boolean;
}

export async function refreshAuthIdentity(): Promise<AuthIdentityRefresh> {
  const result = await fetchAuthMeDetailed();
  const hadUserBefore = !!useStore.getState().userEmail;
  if (result.kind === 'user') useStore.getState().applyAuthMe(result);
  return { result, hadUserBefore };
}
