'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

interface AuthSessionContextValue {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

// API base URL for split-host deployments (e.g. ant.crosstoken.io → ant-server.crosstoken.io)
// Empty string allows same-site relative URLs for single-origin deployments
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

async function fetchSessionUser(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  if (!res.ok) {
    console.warn('[Auth] /api/auth/me responded non-OK', res.status);
    return null;
  }
  const data = await res.json();
  return data?.user?.email ? (data.user as AuthUser) : null;
}

// Strip OAuth callback markers from the URL once consumed, so reloads
// don't reprocess them and the address bar stays clean.
function stripAuthQueryParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let mutated = false;
  for (const key of ['auth', 'error']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      mutated = true;
    }
  }
  if (mutated) {
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
}

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const oauthCallback = params.get('auth');
    const oauthError = params.get('error');

    if (oauthError) {
      console.warn('[Auth] OAuth error returned from callback:', oauthError);
    }

    (async () => {
      try {
        const fresh = await fetchSessionUser();
        if (cancelled) return;
        setUser(fresh);
        if (oauthCallback === 'success' && !fresh) {
          console.warn('[Auth] OAuth success returned but session is empty — verify cookie domain / FRONTEND_URL config');
        }
      } catch (err) {
        if (!cancelled) console.warn('[Auth] /api/auth/me failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (oauthCallback || oauthError) stripAuthQueryParams();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/signout`, { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
    }
  }, []);

  return (
    <AuthSessionContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error('useAuthSession must be used within <AuthSessionProvider>');
  }
  return ctx;
}

/**
 * Entry URL for "Get Started" / hero / pricing CTAs that should always land
 * the user inside ant-ui (`/app/`). Routes through OAuth when the visitor is
 * unauthenticated; bypasses straight to `/app/` once a session cookie is set.
 */
export function getAppEntryUrl(user: AuthUser | null): string {
  if (user) return '/app/';
  return `/api/auth/google?returnTo=${encodeURIComponent('/app/')}`;
}

/**
 * GNB "Sign In" URL. Preserves the marketing context by sending the visitor
 * back to the page they signed in from after OAuth.
 */
export function getSignInUrl(pathname: string): string {
  return `/api/auth/google?returnTo=${encodeURIComponent(pathname || '/')}`;
}
