import { createAuthBroadcaster, type AuthBroadcaster } from '@ant/auth-client';

/**
 * Singleton cross-tab auth broadcaster for ant-ui. Mounted by the
 * `useAuthBridge()` hook in `App.tsx`; consumed by the 401 interceptor
 * (`http/api/client.ts`), the GNB sign-out handler, and the SSE auth-failure
 * path (`SSEManager`).
 *
 * The bridge has three writers and one reader:
 *
 *   writer   readers
 *   -------  -------
 *   user logout       → other tabs (subscribe → clearUser)
 *   401 interceptor   → other tabs (subscribe → clearUser + banner)
 *   SSE auth-failure  → same as 401
 *
 * Self-tab does NOT receive its own broadcasts (matches BroadcastChannel
 * semantics + avoids feedback loops with the dispatching tab's clearUser).
 */

let instance: AuthBroadcaster | null = null;
let sessionExpiredFlag = false;

export function getAuthBroadcaster(): AuthBroadcaster {
  if (instance) return instance;
  instance = createAuthBroadcaster();
  return instance;
}

/**
 * SSE-side flag: set when a `session-expired` event is observed (locally
 * dispatched OR received from another tab). Suppresses auto-reconnect in
 * `SSEManager` until the next successful login (which clears it via
 * `clearSessionExpired`).
 */
export function isSessionExpired(): boolean {
  return sessionExpiredFlag;
}

export function markSessionExpired(): void {
  sessionExpiredFlag = true;
}

export function clearSessionExpired(): void {
  sessionExpiredFlag = false;
}
