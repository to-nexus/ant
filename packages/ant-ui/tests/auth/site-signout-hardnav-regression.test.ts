/**
 * Regression guard for THE bug — ant-site logout that didn't actually log
 * the user out on refresh.
 *
 * The pre-fix `signOut` in `packages/ant-site/lib/AuthSessionProvider.tsx`
 * fired POST `/api/auth/signout` then called `setUser(null)` and STOPPED.
 * If the request silently failed (CORS, network, non-2xx) the cookie was
 * never cleared server-side, and on refresh `/auth/me` saw a valid JWT and
 * re-hydrated the signed-in shell.
 *
 * The unified procedure REQUIRES a hard-nav after the cleanup so the next
 * mount re-verifies against the server. This test asserts the ant-site
 * provider participates in `runUnifiedLogout` (whose contract enforces
 * step 4 — the navigation). If a future refactor re-introduces a bespoke
 * `signOut` that doesn't navigate, this test fails before it ships.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const PROVIDER = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'ant-site',
  'lib',
  'AuthSessionProvider.tsx',
);

describe('ant-site AuthSessionProvider.signOut hard-navigates (THE bug regression)', () => {
  const src = readFileSync(PROVIDER, 'utf-8');

  it('imports runUnifiedLogout from @ant/auth-client', () => {
    expect(src).toMatch(/runUnifiedLogout[^A-Za-z0-9_]/);
    expect(src).toMatch(/from\s+['"]@ant\/auth-client['"]/);
  });

  it('signOut calls runUnifiedLogout (delegates to the 5-step contract)', () => {
    // Locate the provider's signOut callback body and assert it dispatches
    // the unified procedure rather than rolling its own POST + setState.
    const match = src.match(/const\s+signOut\s*=\s*useCallback\(\s*async[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/);
    expect(match, 'signOut useCallback should exist').toBeTruthy();
    const body = match![0];
    expect(body).toMatch(/runUnifiedLogout\(/);
  });

  it('does NOT roll its own fetch(/auth/signout) — single SSOT lives in @ant/auth-client', () => {
    // The only acceptable signout fetch lives inside the @ant/auth-client
    // package itself; ant-site must not duplicate it.
    expect(src).not.toMatch(/fetch\([^)]*\/auth\/signout/);
  });

  it('does NOT silently swallow signout failures (the legacy try/finally pattern is gone)', () => {
    // The legacy bug had the shape:
    //   try { await fetch(.../auth/signout, ...) } finally { setUser(null) }
    // and crucially nothing else. Forbid that exact swallowing pattern in
    // this file going forward.
    expect(src).not.toMatch(/try\s*\{\s*await\s+fetch\([^)]*\/auth\/signout[\s\S]*?\}\s*finally\s*\{[\s\S]*?setUser\(null\)/);
  });
});
