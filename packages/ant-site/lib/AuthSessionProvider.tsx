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

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.email) setUser(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
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
  return `/api/auth/google?returnTo=${encodeURIComponent(pathname)}`;
}
