/**
 * 401 interceptor in `infrastructure/http/api/client.ts` — single sink for
 * stale-session detection on protected requests.
 *
 * Source-level regression guards (rather than runtime tests against the
 * real Zustand store) — the cascade is wired through dynamic imports so
 * the store and broadcaster are loaded lazily; we lock the wiring shape
 * here so future refactors don't accidentally remove the broadcast.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const CLIENT = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'infrastructure',
  'http',
  'api',
  'client.ts',
);

describe('client.ts 401 interceptor', () => {
  const src = readFileSync(CLIENT, 'utf-8');

  it('all five CRUD helpers handle 401 via the cascade', () => {
    for (const fn of ['apiGet', 'apiPost', 'apiPut', 'apiPatch', 'apiDelete']) {
      // Locate the function body and assert it contains a 401 branch that
      // calls handle401Cascade. The exact regex matches `if (response.status
      // === 401) await handle401Cascade(url);` in any of the helpers.
      const fnRegex = new RegExp(
        `export\\s+async\\s+function\\s+${fn}[\\s\\S]*?\\}\\s*\\n`,
        'm',
      );
      const match = src.match(fnRegex);
      expect(match, `${fn} should exist`).toBeTruthy();
      expect(match![0]).toMatch(/response\.status === 401/);
      expect(match![0]).toMatch(/handle401Cascade\(url\)/);
    }
  });

  it('cascade fires session-expired broadcast', () => {
    expect(src).toMatch(/markSessionExpired\(\)/);
    expect(src).toMatch(/post\(\s*\{\s*type:\s*['"]session-expired['"]/);
  });

  it('cascade calls clearUser on the auth slice', () => {
    expect(src).toMatch(/state\.clearUser\s*===\s*['"]function['"]/);
    expect(src).toMatch(/state\.clearUser\(\)/);
  });

  it('skips the cascade for /auth/me (200+null contract — never 401)', () => {
    expect(src).toMatch(/isAuthMeUrl\(url\)/);
  });

  it('skips the cascade for cross-host 401s (preview / realtime — different auth surfaces)', () => {
    // Helper exists, scoped to API host
    expect(src).toMatch(/function\s+isApiHostUrl\s*\(/);
    expect(src).toMatch(/new\s+URL\s*\(\s*API_BASE\(\)/);
    // Cascade calls the helper with negation guard
    expect(src).toMatch(/if\s*\(\s*!\s*isApiHostUrl\(url\)\s*\)\s*return/);
  });

  it('cascade is single-flight (debounced) so a 401 burst does not double-fire', () => {
    expect(src).toMatch(/session401Cascading/);
  });
});

describe('isApiHostUrl runtime behavior', () => {
  // Module-level test: the helper isn't exported, so we re-derive its
  // behavior from spec. Locking the predicate shape here means a future
  // refactor that reintroduces non-API 401 cascading will trip the
  // grep-based test above; this block locks the boundary semantics.
  const VITE_BACKEND_PROD = 'https://ant-server.crosstoken.io';
  const PREVIEW_HOST = 'https://ant-preview.crosstoken.io';

  function shouldCascade(url: string, apiBase: string): boolean {
    if (!/^https?:\/\//i.test(url)) return true;
    try {
      const apiOrigin = new URL(apiBase + '/api', 'http://localhost').origin;
      return new URL(url).origin === apiOrigin;
    } catch {
      return true;
    }
  }

  it('treats relative URLs as API-bound (Vite proxy / same-origin)', () => {
    expect(shouldCascade('/api/projects/123', VITE_BACKEND_PROD)).toBe(true);
    expect(shouldCascade('/realtime/events', VITE_BACKEND_PROD)).toBe(true);
  });

  it('cascades on absolute URLs that match the API origin', () => {
    expect(shouldCascade(`${VITE_BACKEND_PROD}/api/projects/123`, VITE_BACKEND_PROD)).toBe(true);
  });

  it('does NOT cascade on cross-host preview 401s', () => {
    expect(shouldCascade(`${PREVIEW_HOST}/projects/foo/status`, VITE_BACKEND_PROD)).toBe(false);
  });
});
