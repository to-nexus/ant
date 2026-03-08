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
 * Called after OIDC redirect to populate Zustand store.
 * Returns null if not authenticated.
 */
export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const response = await authFetch(`${API_BASE()}/auth/me`);
    if (!response.ok) return null;
    const data = await response.json();
    return {
      email: data.email,
      userId: data.userId,
      organization: data.organization,
      name: data.name,
      picture: data.picture,
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
