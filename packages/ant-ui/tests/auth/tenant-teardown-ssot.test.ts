/**
 * `clearUser` cascade SSOT — regression guard for plan
 * `stale-session-lifecycle-cascade`.
 *
 * Pre-538d9e74 the page silently trusted hydrated `userEmail` and never
 * re-verified the JWT cookie, so dev cloud-mode page entries with stale
 * sessionStorage didn't manifest as 401 storms. After 538d9e74 introduced
 * mount-time `fetchAuthMe()` + `clearUser()` on expiry, the cleanup was
 * partial — only `userEmail` / `userOrganization` were cleared while
 * `selectedProject` / `selectedFeature` lingered, so lifecycle hooks
 * kept firing protected requests under a half-cleared identity.
 *
 * The fix consolidates the cleanup inside `authSlice.clearUser` (so both
 * the explicit sign-out flow and the implicit stale-session path share a
 * single SSOT). This source-level lint guards against the cascade being
 * accidentally split back out into ad-hoc inline cleanup.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const AUTH_SLICE = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'domain',
  'store',
  'slices',
  'authSlice.ts',
);

const APP_NAVBAR = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'presentation',
  'components',
  'AppNavBar.tsx',
);

describe('authSlice.clearUser cascade SSOT', () => {
  it('clearUser sets userEmail/userOrganization to undefined', () => {
    const src = readFileSync(AUTH_SLICE, 'utf-8');
    expect(src).toMatch(/userEmail:\s*undefined/);
    expect(src).toMatch(/userOrganization:\s*undefined/);
  });

  it('clearUser transitions authStatus to "expired"', () => {
    const src = readFileSync(AUTH_SLICE, 'utf-8');
    expect(src).toMatch(/authStatus:\s*['"]expired['"]/);
  });

  it('clearUser invokes reset() so kanban/job/feature state is cascaded', () => {
    const src = readFileSync(AUTH_SLICE, 'utf-8');
    // Match within a clearUser-shaped block — the helper relies on
    // `reset` being a slice action available via `get()`.
    expect(src).toMatch(/state\.reset\(\)/);
  });

  it('clearUser clears the projects list and resets projectsStatus', () => {
    const src = readFileSync(AUTH_SLICE, 'utf-8');
    expect(src).toMatch(/projects:\s*\[\]/);
    expect(src).toMatch(/projectsStatus:\s*['"]idle['"]/);
  });

  it('clearUser scrubs SELECTED_PROJECT / PROJECT_LAST_FEATURES storage', () => {
    const src = readFileSync(AUTH_SLICE, 'utf-8');
    expect(src).toMatch(/removeFromStorage\(STORAGE_KEYS\.SELECTED_PROJECT\)/);
    expect(src).toMatch(/removeFromStorage\(STORAGE_KEYS\.PROJECT_LAST_FEATURES\)/);
  });
});

describe('AppNavBar.handleSignOut delegates to clearUser SSOT', () => {
  it('handleSignOut does not duplicate setProjects([]) / setSelectedProject(undefined) inline', () => {
    const src = readFileSync(APP_NAVBAR, 'utf-8');
    // Locate the handleSignOut body and assert it only calls signOut +
    // clearUser + window.location, not the legacy inline cleanup that
    // would drift away from the single SSOT.
    const match = src.match(/const\s+handleSignOut\s*=\s*async\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\s\s\};/);
    expect(match, 'handleSignOut function should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/clearUser\(\)/);
    expect(body).not.toMatch(/setProjects\(\[\]\)/);
    expect(body).not.toMatch(/setSelectedProject\(undefined\)/);
    expect(body).not.toMatch(/setSelectedFeature\(undefined\)/);
    expect(body).not.toMatch(/\breset\(\)/);
  });
});
