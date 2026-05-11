/**
 * Shared auth types — single source of truth for the BE↔FE auth contract
 * consumed by both ant-site and ant-ui.
 */

export interface AuthUser {
  email: string;
  userId: string;
  organization: string;
  name?: string;
  picture?: string;
}

/**
 * Discriminated outcome of `/auth/me`. Each branch maps to a distinct
 * deployment misconfiguration so the caller can surface a precise hint.
 * `kind: 'user'` is the only success state.
 *
 *   kind=user           → signed-in user payload (carries onboarding flags too)
 *   kind=no-session     → cookie absent or invalid (200 + {user: null})
 *   kind=misconfigured  → backend returned 503 (ANT_JWT_SECRET unset)
 *   kind=http-error     → any other non-2xx
 *   kind=network        → fetch threw (CORS, offline, abort)
 *   kind=shape          → 200 but body shape unrecognised
 *
 * `needsOnboarding` / `suggestedOrganizationName` ride on the success
 * branch — they describe the user (the `_pending` sentinel state) and
 * are meaningless when there's no session.
 */
export type AuthMeResult =
  | {
      kind: 'user';
      user: AuthUser;
      needsOnboarding: boolean;
      suggestedOrganizationName: string | null;
    }
  | { kind: 'no-session' }
  | { kind: 'misconfigured' }
  | { kind: 'http-error'; status: number }
  | { kind: 'network'; message: string }
  | { kind: 'shape'; raw: unknown };

/**
 * Cross-tab auth message envelope. Posted on `BroadcastChannel('ant-auth')`
 * (or the localStorage `storage`-event fallback). Receivers should NOT
 * re-broadcast — the bridge is one-way to avoid feedback loops.
 *
 *   logout           → user-initiated logout in another tab
 *   session-expired  → 401 detected (server cookie invalid / expired)
 */
export type AuthBroadcastMessage =
  | { type: 'logout'; at: number }
  | { type: 'session-expired'; at: number };

export const AUTH_BROADCAST_CHANNEL = 'ant-auth';
