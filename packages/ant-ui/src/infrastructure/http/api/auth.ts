import { API_BASE, authFetch } from './client';

export interface AuthUser {
  email: string;
  userId: string;
  organization: string;
  name?: string;
  picture?: string;
}

/**
 * Fetch current user info from JWT cookie session.
 *
 * The endpoint always responds 200 with `{ user: User | null }` — `null`
 * means "no session" (cookie absent or invalid), not an error. Non-2xx
 * responses are reserved for genuine server faults (e.g. 503 when JWT
 * isn't configured) and are also collapsed to `null`.
 */
export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const response = await authFetch(`${API_BASE()}/auth/me`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.user) return null;
    return {
      email: data.user.email,
      userId: data.user.userId,
      organization: data.user.organization,
      name: data.user.name,
      picture: data.user.picture,
    };
  } catch {
    return null;
  }
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
