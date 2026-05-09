import type { AuthMeResult, AuthUser } from './types';

export interface FetchAuthOptions {
  /** Absolute API base, e.g. `https://ant-server.crosstoken.io/api` or `/api`. */
  apiBase: string;
}

/**
 * Detailed `/auth/me` fetch — returns a 5-mode discriminated result. Both
 * ant-site and ant-ui consume this; `App.tsx` uses every branch for
 * stale-session vs network-hiccup disambiguation.
 *
 * The endpoint always responds 200 with `{ user: User | null }`. Non-2xx is
 * reserved for genuine server faults (503 = JWT misconfigured).
 */
export async function fetchAuthMeDetailed(
  opts: FetchAuthOptions,
): Promise<AuthMeResult> {
  let response: Response;
  try {
    response = await fetch(`${opts.apiBase}/auth/me`, {
      credentials: 'include',
    });
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

/** Binary signed-in / not-signed-in shim over `fetchAuthMeDetailed`. */
export async function fetchAuthMe(opts: FetchAuthOptions): Promise<AuthUser | null> {
  const result = await fetchAuthMeDetailed(opts);
  return result.kind === 'user' ? result.user : null;
}
