import { API_BASE, authFetch } from './client';

export interface AuthUser {
  email: string;
  userId: string;
  organization: string;
  name?: string;
  picture?: string;
}

/**
 * Discriminated outcome of `/auth/me` — every branch maps to a distinct
 * deployment misconfiguration so the caller can surface a precise hint.
 * `kind: 'user'` is the only success state; everything else is a failure
 * mode the legacy `fetchAuthMe()` collapsed to `null`.
 */
export type AuthMeResult =
  | { kind: 'user'; user: AuthUser }
  | { kind: 'no-session' }
  | { kind: 'misconfigured' }
  | { kind: 'http-error'; status: number }
  | { kind: 'network'; message: string }
  | { kind: 'shape'; raw: unknown };

export async function fetchAuthMeDetailed(): Promise<AuthMeResult> {
  let response: Response;
  try {
    response = await authFetch(`${API_BASE()}/auth/me`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'network', message };
  }

  if (!response.ok) {
    if (response.status === 503) return { kind: 'misconfigured' };
    return { kind: 'http-error', status: response.status };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { kind: 'shape', raw: undefined };
  }

  if (typeof data !== 'object' || data === null || !('user' in data)) {
    return { kind: 'shape', raw: data };
  }

  const user = (data as { user: unknown }).user;
  if (user === null) return { kind: 'no-session' };
  if (typeof user !== 'object') return { kind: 'shape', raw: data };

  const u = user as Partial<AuthUser>;
  if (!u.email || !u.userId || !u.organization) {
    return { kind: 'shape', raw: data };
  }
  return {
    kind: 'user',
    user: {
      email: u.email,
      userId: u.userId,
      organization: u.organization,
      name: u.name,
      picture: u.picture,
    },
  };
}

/**
 * Fetch current user info from JWT cookie session.
 *
 * The endpoint always responds 200 with `{ user: User | null }` — `null`
 * means "no session" (cookie absent or invalid), not an error. Non-2xx
 * responses are reserved for genuine server faults (e.g. 503 when JWT
 * isn't configured) and are also collapsed to `null`.
 *
 * Thin shim over `fetchAuthMeDetailed` for callers that only need the
 * binary signed-in / not signed-in result.
 */
export async function fetchAuthMe(): Promise<AuthUser | null> {
  const result = await fetchAuthMeDetailed();
  return result.kind === 'user' ? result.user : null;
}

/**
 * Sign out - Clears the JWT cookie server-side.
 */
export async function signOut(): Promise<void> {
  try {
    await authFetch(`${API_BASE()}/auth/signout`, { method: 'POST' });
  } catch (error) {
    console.error('Error signing out:', error);
  }
}
