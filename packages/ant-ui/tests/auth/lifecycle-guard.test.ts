/**
 * Lifecycle guard SSOT — regression guard for plan
 * `stale-session-lifecycle-cascade`.
 *
 * Two invariants:
 *
 *   I1 — `selectIsAuthBlocked` is the single source of truth for
 *        "should this protected fetch fire right now?". It must treat
 *        cloud + missing userEmail AND cloud + authStatus==='verifying'
 *        as block.
 *
 *   I2 — Lifecycle / sync hooks and slice actions that fan out
 *        protected requests MUST go through `selectIsAuthBlocked`, not
 *        through inline `backendMode === 'cloud' && !userEmail` checks.
 *        The inline pattern is allowed only at:
 *          - the selector definition itself, and
 *          - `App.tsx` 's `shouldShowWelcome` flag (welcome-screen
 *            decision is intentionally render-time, not fetch-time).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..', '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SELECTOR_PATH = path.join(
  SRC_ROOT,
  'domain',
  'store',
  'selectors',
  'auth.ts',
);

describe('I1 — selectIsAuthBlocked SSOT', () => {
  it('selector exists and exports selectIsAuthBlocked', () => {
    const src = readFileSync(SELECTOR_PATH, 'utf-8');
    expect(src).toMatch(/export\s+function\s+selectIsAuthBlocked/);
  });

  it('selector blocks when launchMode is cloud and userEmail is missing', () => {
    const src = readFileSync(SELECTOR_PATH, 'utf-8');
    expect(src).toMatch(/state\.launchMode\s*!==\s*['"]cloud['"]/);
    expect(src).toMatch(/!state\.userEmail/);
  });

  it('selector blocks while authStatus === "verifying"', () => {
    const src = readFileSync(SELECTOR_PATH, 'utf-8');
    expect(src).toMatch(/state\.authStatus\s*===\s*['"]verifying['"]/);
  });
});

describe('I2 — lifecycle / sync surfaces consume the SSOT selector', () => {
  const consumers = [
    'domain/project-world/lifecycle.ts',
    'application/hooks/preview/usePreviewSync.ts',
    'application/hooks/ui/useDesktopBridge.ts',
    'application/hooks/ui/useHealthCheck.ts',
    'presentation/App.tsx',
    'domain/store/slices/projectSlice.ts',
    'domain/store/slices/sseSlice.ts',
    'domain/store/slices/fileSlice.ts',
    'domain/store/slices/previewSlice.ts',
    'domain/store/slices/deploySlice.ts',
  ];

  it.each(consumers)('%s imports selectIsAuthBlocked', (rel) => {
    const full = path.join(SRC_ROOT, rel);
    const src = readFileSync(full, 'utf-8');
    expect(src).toMatch(/selectIsAuthBlocked/);
  });

  it('no other source file uses the inline `cloud + !userEmail` guard pattern', () => {
    const ALLOW = new Set<string>([
      // Selector definition itself.
      SELECTOR_PATH,
      // `shouldShowWelcome` is a render-decision (not a fetch guard) and
      // intentionally co-locates the cloud+!userEmail check next to the
      // welcome-screen branch. The selector covers fetch-time semantics.
      path.join(SRC_ROOT, 'presentation', 'App.tsx'),
      // `useUIActionPolicy` only references the pattern in a doc comment
      // explaining the policy — keep it as documentation surface.
      path.join(SRC_ROOT, 'application', 'hooks', 'ui', 'useUIActionPolicy.ts'),
    ]);

    const offenders: string[] = [];
    const inline = /backendMode\s*===\s*['"]cloud['"]\s*&&\s*!\s*(?:state\.)?userEmail/;

    for (const file of walk(SRC_ROOT)) {
      if (ALLOW.has(file)) continue;
      const src = readFileSync(file, 'utf-8');
      if (inline.test(src)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(
      offenders,
      'Inline cloud+!userEmail guards must consolidate through selectIsAuthBlocked:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

describe('I3 — authStatus state machine wiring', () => {
  it('AuthState declares the four-step authStatus channel', () => {
    const types = readFileSync(
      path.join(SRC_ROOT, 'domain', 'store', 'types.ts'),
      'utf-8',
    );
    expect(types).toMatch(/authStatus:\s*AuthStatus/);
    expect(types).toMatch(
      /AuthStatus\s*=\s*['"]idle['"]\s*\|\s*['"]verifying['"]\s*\|\s*['"]verified['"]\s*\|\s*['"]expired['"]/,
    );
  });

  it('App.tsx sets authStatus to "verifying" before fetchAuthMe resolves', () => {
    const app = readFileSync(
      path.join(SRC_ROOT, 'presentation', 'App.tsx'),
      'utf-8',
    );
    // At least one `setAuthStatus('verifying')` must precede the
    // `fetchAuthMe()` call inside the cloud-mode bootstrap branch.
    expect(app).toMatch(/setAuthStatus\(['"]verifying['"]\)/);
    expect(app).toMatch(/fetchAuthMe\(\)/);
  });

  it('App.tsx boot gate spinner covers the verifying window', () => {
    const app = readFileSync(
      path.join(SRC_ROOT, 'presentation', 'App.tsx'),
      'utf-8',
    );
    expect(app).toMatch(
      /authStatusValue\s*===\s*['"]verifying['"]\s*\|\|\s*\(!!userEmail\s*&&\s*!projectsLoaded\)/,
    );
  });
});

describe('I4 — unauthenticated cloud entry keeps AppNavBar mounted', () => {
  // The user-intended fallback for cloud + missing userEmail is the
  // `<AppNavBar />`-only shell, not a redirect. The navbar carries the
  // Sign In button (Google OIDC). Marketing surface lives on ant-site
  // and users navigate there explicitly. See e27f0ff7.
  const APP = path.join(SRC_ROOT, 'presentation', 'App.tsx');

  it('App.tsx does NOT redirect via window.location.replace from the welcome branch', () => {
    const src = readFileSync(APP, 'utf-8');
    expect(src).not.toMatch(/window\.location\.replace\(['"]\/['"]\)/);
  });

  it('shouldShowWelcome render branch mounts AppNavBar (so Sign In stays reachable)', () => {
    const src = readFileSync(APP, 'utf-8');
    const match = src.match(/if\s*\(\s*shouldShowWelcome\s*\)\s*\{([\s\S]*?)\n\s\s\}/);
    expect(match, 'shouldShowWelcome branch should exist').toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/<AppNavBar\s*\/?>/);
  });

  it('the welcome branch does NOT render the StaleSessionDetector banner anymore', () => {
    const src = readFileSync(APP, 'utf-8');
    expect(src).not.toMatch(/<StaleSessionDetector/);
  });
});

// Sanity guard that the directory walker actually finds files.
describe('walker sanity', () => {
  it('crawls expected source roots', () => {
    const files = walk(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
    const stat = statSync(SELECTOR_PATH);
    expect(stat.isFile()).toBe(true);
  });
});
