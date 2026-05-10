/**
 * MainContentArea auth-blocked surface — regression guard.
 *
 * When the user becomes auth-blocked (cloud mode + no userEmail or
 * authStatus='verifying') with a project/feature still selected, the
 * default branches (kanban / workflow / config editor) silently render
 * nothing because `setProjects([])` has wiped the project list. We add
 * an explicit early-return that shows "Sign in to continue" + an OAuth
 * CTA, gated on `selectIsAuthBlocked`, BEFORE the connectionStatus
 * branch — so a future refactor can't accidentally let auth-blocked
 * fall through to the empty kanban path again.
 *
 * Source-grep regression instead of a JSDOM render test — same pattern
 * as `api-client-401-cascade.test.ts`. Cheap, deterministic, locks the
 * exact shape of the integration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

const COMPONENT = path.resolve(
  __dirname,
  '..',
  '..',
  'src',
  'presentation',
  'components',
  'layout',
  'MainContentArea.tsx',
);

describe('MainContentArea auth-blocked surface', () => {
  const src = readFileSync(COMPONENT, 'utf-8');

  it('imports the SSOT auth-blocked selector (no parallel predicate)', () => {
    expect(src).toMatch(/import\s*\{[^}]*selectIsAuthBlocked[^}]*\}\s*from\s*['"]@\/domain\/store\/selectors['"]/);
    expect(src).toMatch(/useStore\(\s*selectIsAuthBlocked\s*\)/);
  });

  it('reuses @ant/auth-client getSignInUrl (no inline OAuth URL builder)', () => {
    expect(src).toMatch(/import\s*\{[^}]*getSignInUrl[^}]*\}\s*from\s*['"]@ant\/auth-client['"]/);
    expect(src).toMatch(/getSignInUrl\(\s*\{\s*oauthBase:\s*OAUTH_BASE\(\)/);
  });

  it('reuses existing i18n keys (explorer.panel.signInRequired / signInHint)', () => {
    // Both keys already exist for the Explorer signed-out state — reuse,
    // don't add new copy under a different namespace.
    expect(src).toMatch(/t\(['"]panel\.signInRequired['"]\)/);
    expect(src).toMatch(/t\(['"]panel\.signInHint['"]\)/);
  });

  it('auth-blocked branch is FIRST in the conditional ladder', () => {
    // The blank-screen bug occurred because connectionStatus === 'connected'
    // with auth-blocked fell through to the kanban branch with empty
    // projects. The auth-blocked check must run BEFORE connectionStatus so
    // that future refactors can't reintroduce the fall-through.
    const innerJsx = src.split('return (')[1] ?? '';
    const authBlockedIdx = innerJsx.indexOf('isAuthBlocked');
    const connectionStatusIdx = innerJsx.indexOf("connectionStatus !== 'connected'");
    expect(authBlockedIdx).toBeGreaterThan(-1);
    expect(connectionStatusIdx).toBeGreaterThan(-1);
    expect(authBlockedIdx).toBeLessThan(connectionStatusIdx);
  });

  it('renders the OAuth sign-in anchor (so the user has a path forward)', () => {
    // The CTA must be a real <a href={...}> — a button with an onClick
    // would lose the OAuth state-param flow and be harder to keyboard-test.
    expect(src).toMatch(/<a[^>]*href=\{getSignInUrl\(/);
  });
});
