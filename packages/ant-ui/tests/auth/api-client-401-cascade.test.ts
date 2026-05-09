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

  it('cascade is single-flight (debounced) so a 401 burst does not double-fire', () => {
    expect(src).toMatch(/session401Cascading/);
  });
});
