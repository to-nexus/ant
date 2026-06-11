'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  fetchAuthMeDetailed,
  runUnifiedLogout,
  runMountSessionCheck,
  createAuthBroadcaster,
  getAppEntryUrl as buildAppEntryUrl,
  getSignInUrl as buildSignInUrl,
  type AuthBroadcaster,
  type AuthUser as SharedAuthUser,
} from '@ant/auth-client';
import { RAW_API_BASE, API_BASE, SERVER_MODE, type ServerMode } from './apiBase';

/**
 * ant-site keeps a slimmer AuthUser than ant-ui — picture / name come from
 * Google's payload but `userId` / `organization` (required by the shared
 * type) are surplus on the marketing surface. We narrow at the boundary.
 */
export interface AuthUser {
  email: string;
  name?: string;
  picture?: string;
}

export type { ServerMode };

interface AuthSessionContextValue {
  user: AuthUser | null;
  loading: boolean;
  serverMode: ServerMode;
  signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

const LOCAL_USER: AuthUser = {
  email: 'local@local',
  name: 'Local User',
};

function narrow(user: SharedAuthUser): AuthUser {
  return { email: user.email, name: user.name, picture: user.picture };
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
  // Local-mode build seeds the local user synchronously — no BE call, no
  // loading state, no broadcaster — so the GNB never flashes a Sign In
  // button on this dist.
  const [user, setUser] = useState<AuthUser | null>(
    SERVER_MODE === 'local' ? LOCAL_USER : null,
  );
  const [loading, setLoading] = useState(SERVER_MODE !== 'local');
  const broadcasterRef = useRef<AuthBroadcaster | null>(null);

  // Mount-time session check — cloud builds only. uses the same discriminated
  // handling as ant-ui's App.tsx so server hiccups (network/503/4xx/shape)
  // don't get collapsed to "logged out".
  useEffect(() => {
    if (SERVER_MODE === 'local') return;
    let cancelled = false;

    const params = new URLSearchParams(window.location.search);
    const oauthCallback = params.get('auth');
    const oauthError = params.get('error');

    if (oauthError) {
      console.warn('[Auth] OAuth error returned from callback:', oauthError);
    }

    (async () => {
      try {
        const result = await runMountSessionCheck({
          apiBase: API_BASE,
          hadHydratedUser: false, // ant-site has no localStorage hydration
          setUser: (u) => {
            if (!cancelled) setUser(narrow(u));
          },
          clearUser: () => {
            if (!cancelled) setUser(null);
          },
          onNonFatal: (r) => {
            console.warn(`[Auth] /auth/me non-fatal kind=${r.kind}`);
          },
        });
        if (cancelled) return;
        if (oauthCallback === 'success' && result.kind !== 'user') {
          console.warn(
            '[Auth] OAuth success returned but session is empty — verify cookie domain / FRONTEND_URL config',
          );
        }
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

  // Cross-tab broadcaster — cloud builds only. Other tabs that log out (or
  // hit a 401 → session-expired) tell us; we drop local state without
  // re-broadcasting and without navigating (the user keeps the marketing
  // page they're on, just sees the logged-out shell).
  useEffect(() => {
    if (SERVER_MODE === 'local') return;
    const broadcaster = createAuthBroadcaster();
    broadcasterRef.current = broadcaster;
    const unsub = broadcaster.subscribe((message) => {
      if (message.type === 'logout' || message.type === 'session-expired') {
        setUser(null);
      }
    });
    return () => {
      unsub();
      broadcaster.close();
      broadcasterRef.current = null;
    };
  }, []);

  // Unified 5-step logout: API → local cleanup → broadcast → hard nav.
  // The hard nav (step 4) is the missing piece in the previous implementation
  // that allowed the cookie to remain set when the API call silently failed.
  // Local-mode no-ops — there is no cookie to clear and no remote session.
  const signOut = useCallback(async () => {
    if (SERVER_MODE === 'local') return;
    const broadcaster = broadcasterRef.current;
    if (!broadcaster) {
      console.warn('[Auth] signOut called before broadcaster mounted');
      window.location.assign('/');
      return;
    }
    await runUnifiedLogout({
      apiBase: API_BASE,
      destination: '/',
      broadcaster,
      clearLocalState: () => setUser(null),
      showSignoutFailureToast: () => {
        // ant-site has no toast surface yet; surface in console so users
        // who watch devtools see it. UI affordance can be added when the
        // marketing site adopts a toast component.
        console.warn(
          '[Auth] Signed out locally; the server session may persist until the cookie expires.',
        );
      },
    });
  }, []);

  return (
    <AuthSessionContext.Provider value={{ user, loading, serverMode: SERVER_MODE, signOut }}>
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
  return buildAppEntryUrl({
    isSignedIn: !!user,
    oauthBase: RAW_API_BASE,
    appPath: '/app/',
  });
}

/**
 * GNB "Sign In" URL. Preserves the marketing context by sending the visitor
 * back to the page they signed in from after OAuth.
 */
export function getSignInUrl(pathname: string): string {
  return buildSignInUrl({
    oauthBase: RAW_API_BASE,
    returnTo: pathname || '/',
  });
}

// Re-exported for consumers that need direct access to the discriminated
// `/auth/me` result (e.g. test harnesses).
export { fetchAuthMeDetailed };
