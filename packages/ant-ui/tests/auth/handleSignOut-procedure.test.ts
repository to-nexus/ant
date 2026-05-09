/**
 * ant-ui `AppNavBar.handleSignOut` — guards that the unified logout
 * procedure is the only path. Before unification the handler was an
 * ad-hoc sequence (`signOut + clearUser + window.location.href = '/'`)
 * that worked, but each step was duplicated outside the shared package.
 * After unification, the handler MUST delegate to `runUnifiedLogout` so
 * any future change to the procedure (e.g. adding cross-tab sync)
 * lands once in the package and propagates here automatically.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const APP_NAVBAR = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'presentation',
  'components',
  'AppNavBar.tsx',
);

describe('AppNavBar.handleSignOut — unified procedure delegate', () => {
  const src = readFileSync(APP_NAVBAR, 'utf-8');

  it('imports runUnifiedLogout from @ant/auth-client', () => {
    expect(src).toMatch(/runUnifiedLogout[^A-Za-z0-9_]/);
    expect(src).toMatch(/from\s+['"]@ant\/auth-client['"]/);
  });

  it('handleSignOut delegates to runUnifiedLogout', () => {
    const match = src.match(/const\s+handleSignOut\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    expect(match, 'handleSignOut function should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/runUnifiedLogout\(/);
  });

  it('honors VITE_ANT_SITE_URL when set, defaults to "/"', () => {
    const match = src.match(/const\s+handleSignOut\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    const body = match![1];
    // Either env var read OR a default to "/" — both shapes are acceptable
    // as long as one of them is present.
    expect(body).toMatch(/VITE_ANT_SITE_URL/);
    expect(body).toMatch(/['"]\/['"]/);
  });

  it('does NOT roll its own fetch to /auth/signout', () => {
    expect(src).not.toMatch(/fetch\([^)]*\/auth\/signout/);
  });
});
