/**
 * ant-ui sign-out — guards that the unified logout procedure is the only path.
 * Before unification the handler was an ad-hoc sequence (`signOut + clearUser +
 * window.location.href = '/'`) that worked, but each step was duplicated
 * outside the shared package. After unification the procedure MUST delegate to
 * `runUnifiedLogout` so any future change to it (e.g. adding cross-tab sync)
 * lands once in the package and propagates everywhere automatically.
 *
 * The procedure lives in `useSignOut` rather than inline in `AppNavBar`
 * because `AccountApprovalGate` also offers sign-out and deliberately mounts no
 * nav bar — so what is pinned here is the hook's body plus the fact that every
 * sign-out surface delegates to it rather than re-deriving the sequence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..', 'src');
const USE_SIGN_OUT = path.join(SRC, 'application', 'hooks', 'ui', 'useSignOut.ts');

/** Every surface that offers the user a way out. */
const SIGN_OUT_SURFACES = [
  path.join(SRC, 'presentation', 'components', 'AppNavBar.tsx'),
  path.join(SRC, 'presentation', 'components', 'auth', 'AccountApprovalGate.tsx'),
];

describe('useSignOut — the unified procedure has one home', () => {
  const src = readFileSync(USE_SIGN_OUT, 'utf-8');

  it('imports runUnifiedLogout from @ant/auth-client', () => {
    expect(src).toMatch(/runUnifiedLogout[^A-Za-z0-9_]/);
    expect(src).toMatch(/from\s+['"]@ant\/auth-client['"]/);
  });

  it('delegates to runUnifiedLogout', () => {
    expect(src).toMatch(/runUnifiedLogout\(/);
  });

  it('honors VITE_ANT_SITE_URL when set, defaults to "/"', () => {
    expect(src).toMatch(/VITE_ANT_SITE_URL/);
    expect(src).toMatch(/['"]\/['"]/);
  });

  it('clears local state and broadcasts, so no caller has to remember the steps', () => {
    expect(src).toMatch(/clearLocalState/);
    expect(src).toMatch(/broadcaster/);
  });
});

describe('every sign-out surface delegates rather than re-deriving the sequence', () => {
  it.each(SIGN_OUT_SURFACES)('%s uses the hook', (file) => {
    const src = readFileSync(file, 'utf-8');
    expect(src).toMatch(/useSignOut/);
    expect(src).not.toMatch(/runUnifiedLogout\(/);
  });

  it('no surface rolls its own fetch to /auth/signout', () => {
    for (const file of SIGN_OUT_SURFACES) {
      expect(readFileSync(file, 'utf-8')).not.toMatch(/fetch\([^)]*\/auth\/signout/);
    }
  });

  /**
   * The SET, not a remembered list: any component that clears the user AND
   * navigates away is a sign-out surface and must be enumerated above.
   */
  it('the surface list covers every component that hand-rolls a logout', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(SRC, 'presentation'));
    const offenders = files.filter(
      (f) => !SIGN_OUT_SURFACES.includes(f) && /runUnifiedLogout\(/.test(readFileSync(f, 'utf-8')),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
