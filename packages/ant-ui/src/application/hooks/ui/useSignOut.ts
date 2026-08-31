import { useCallback } from 'react';
import { runUnifiedLogout } from '@ant/auth-client';
import { useStore } from '@/domain/store';
import { API_BASE } from '@/infrastructure/http/api';
import { getAuthBroadcaster } from '@/infrastructure/auth/authBridge';

/**
 * The unified 5-step logout procedure (signout API → `clearUser` cascade →
 * cross-tab broadcast → hard nav), as a hook.
 *
 * Extracted from `AppNavBar` when `AccountApprovalGate` gained a sign-out
 * button: that screen deliberately does not mount the nav bar, and a second
 * hand-rolled copy of the sequence would fork the SSOT that
 * `tests/auth/unified-logout-procedure.test.ts` guards.
 *
 * Hard-nav target: `VITE_ANT_SITE_URL` when configured, else `/`.
 */
export function useSignOut(): () => Promise<void> {
  const clearUser = useStore((state) => state.clearUser);

  return useCallback(async () => {
    const siteUrl = (import.meta.env.VITE_ANT_SITE_URL as string | undefined) ?? '/';
    await runUnifiedLogout({
      apiBase: API_BASE(),
      destination: siteUrl,
      broadcaster: getAuthBroadcaster(),
      clearLocalState: () => clearUser(),
      showSignoutFailureToast: () => {
        console.warn(
          '[Auth] Signed out locally; the server session may persist until the cookie expires.',
        );
      },
    });
  }, [clearUser]);
}
