/**
 * @ant/auth-client — unified browser auth primitives shared by ant-site
 * (Next.js) and ant-ui (Vite).
 *
 * Owns: /auth/me fetch (5-mode discriminated), /auth/signout, OAuth URL
 * builders, cross-tab BroadcastChannel bus, and the unified logout / mount
 * procedures. Does NOT own state — each app keeps its own container
 * (Context vs Zustand) and injects state callbacks into the procedure.
 */

export type {
  AuthUser,
  AuthMeResult,
  AuthBroadcastMessage,
} from './types';
export { AUTH_BROADCAST_CHANNEL } from './types';

export type { FetchAuthOptions } from './fetch-auth';
export { fetchAuthMe, fetchAuthMeDetailed } from './fetch-auth';

export type { SignOutOptions, SignOutResult } from './sign-out';
export { signOut } from './sign-out';

export type { AuthBroadcaster } from './broadcaster';
export { createAuthBroadcaster } from './broadcaster';

export { getSignInUrl, getAppEntryUrl } from './oauth';

export type {
  RunUnifiedLogoutOptions,
  RunMountSessionCheckOptions,
} from './procedures';
export { runUnifiedLogout, runMountSessionCheck } from './procedures';
