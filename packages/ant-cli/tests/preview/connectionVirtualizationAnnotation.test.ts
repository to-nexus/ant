import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { detectFromAnnotations } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseEnvAnnotations';
import { detectFromTomlAnnotations } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseTomlAnnotations';
import { detectFromKnownPatterns } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseKnownPatterns';
import { deriveToggleVar } from '../../src/core/prompt/builder/serviceVirtualization/connectionModel';

/**
 * Phase 1 — Service Virtualization auto-attach truth table.
 *
 * The single source of truth: `category === 'business'` ⇒
 * `virtualization` is attached. There is no annotation token for
 * virtualization (single-valued discriminator carries no information).
 *
 * Locks the 12-case matrix from plan §4.4 (rev2). Any drift here points
 * at either (a) `autoAttachVirtualization` regressing the category gate,
 * (b) `overrideWithEnvFile` losing the per-port > master > false
 * priority chain, or (c) someone re-introducing a `mock:*` token.
 */

let workdir: string;

function setupProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'ant-conn-virt-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  workdir = dir;
  return dir;
}

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
    workdir = '';
  }
});

describe('connection annotation Service Virtualization auto-attach', () => {
  // -----------------------------------------------------------------
  // Case 1 — business `@connection` (.env) → virtualization auto-attach
  // -----------------------------------------------------------------
  it('case 1: business `@connection` auto-attaches virtualization with derived toggleEnvVar', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    const c = conns[0];
    expect(c.virtualization).toBeDefined();
    expect(c.virtualization?.toggleEnvVar).toBe('USE_MOCK_STRIPE_API');
    expect(c.virtualization?.active).toBe(false);
  });

  // -----------------------------------------------------------------
  // Case 2 — business `@connection` (TOML) → same auto-attach
  // -----------------------------------------------------------------
  it('case 2: business TOML `@connection` auto-attaches virtualization', () => {
    const root = setupProject({
      'config.example.toml': [
        '# @connection business backend-api env:API_BASE_URL',
        '[api]',
        'base_url = ""',
      ].join('\n'),
    });

    const conns = detectFromTomlAnnotations(root);
    expect(conns).toHaveLength(1);
    expect(conns[0].virtualization?.toggleEnvVar).toBe('USE_MOCK_BACKEND_API');
  });

  // -----------------------------------------------------------------
  // Case 3 — infrastructure `@connection` → virtualization undefined
  // -----------------------------------------------------------------
  it('case 3: infrastructure `@connection` does NOT receive virtualization', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection infrastructure postgres',
        'DATABASE_URL=postgresql://localhost:5432/dev',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    expect(conns[0].category).toBe('infrastructure');
    expect(conns[0].virtualization).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // Case 4 — business + `self` resolution → both attached
  // -----------------------------------------------------------------
  it('case 4: business + `self` carries both ant-project resolution and auto virtualization', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business backend-api self',
        'VITE_API_BASE_URL=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].resolution).toEqual({ type: 'ant-project', projectId: 'self', feature: 'self' });
    expect(conns[0].virtualization?.toggleEnvVar).toBe('USE_MOCK_BACKEND_API');
  });

  // -----------------------------------------------------------------
  // Case 5 — business + cross-project resolution → both attached
  // -----------------------------------------------------------------
  it('case 5: business + `ant-project:p:f` carries both layers', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stats-api ant-project:sketch-be:skeleton',
        'VITE_STATS_BASE_URL=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].resolution).toEqual({
      type: 'ant-project',
      projectId: 'sketch-be',
      feature: 'skeleton',
    });
    expect(conns[0].virtualization?.toggleEnvVar).toBe('USE_MOCK_STATS_API');
  });

  // -----------------------------------------------------------------
  // Case 6 — `.env` per-port USE_MOCK_X=true → active=true
  // -----------------------------------------------------------------
  it('case 6: per-port USE_MOCK_X=true flips active to true', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
      ].join('\n'),
      '.env': 'USE_MOCK_STRIPE_API=true',
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].virtualization?.active).toBe(true);
  });

  // -----------------------------------------------------------------
  // Case 7 — per-port wins over master
  // -----------------------------------------------------------------
  it('case 7: per-port USE_MOCK_X=false wins over master USE_MOCK=true', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
      ].join('\n'),
      '.env': ['USE_MOCK_STRIPE_API=false', 'USE_MOCK=true'].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].virtualization?.active).toBe(false);
  });

  // -----------------------------------------------------------------
  // Case 8 — master USE_MOCK only → active=true
  // -----------------------------------------------------------------
  it('case 8: master USE_MOCK=true broadcasts when per-port is unset', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
      ].join('\n'),
      '.env': 'USE_MOCK=true',
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].virtualization?.active).toBe(true);
  });

  // -----------------------------------------------------------------
  // Case 9 — neither toggle present → active=false
  // -----------------------------------------------------------------
  it('case 9: no toggle vars in .env keeps active=false', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
      ].join('\n'),
      '.env': 'STRIPE_API_KEY=', // .env exists but no toggle var
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].virtualization?.active).toBe(false);
  });

  // -----------------------------------------------------------------
  // Case 10 — known-pattern infrastructure fallback → virtualization undefined
  // -----------------------------------------------------------------
  it('case 10: known-pattern infrastructure fallback has no virtualization', () => {
    const root = setupProject({
      '.env.example': 'DATABASE_URL=postgresql://localhost:5432/dev',
    });

    const conns = detectFromKnownPatterns(root, new Set());
    expect(conns).toHaveLength(1);
    expect(conns[0].category).toBe('infrastructure');
    expect(conns[0].virtualization).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // Case 11 — known-pattern business fallback → virtualization auto-attach
  // -----------------------------------------------------------------
  it('case 11: known-pattern business fallback also auto-attaches virtualization', () => {
    const root = setupProject({
      '.env.example': 'VITE_API_BASE_URL=https://api.example.com',
    });

    const conns = detectFromKnownPatterns(root, new Set());
    expect(conns).toHaveLength(1);
    expect(conns[0].category).toBe('business');
    expect(conns[0].virtualization?.toggleEnvVar).toBe('USE_MOCK_API');
  });

  // -----------------------------------------------------------------
  // Case 12 — deriveToggleVar('stripe-api') === 'USE_MOCK_STRIPE_API'
  // -----------------------------------------------------------------
  it('case 12: deriveToggleVar uppercases and underscores hyphens', () => {
    expect(deriveToggleVar('stripe-api')).toBe('USE_MOCK_STRIPE_API');
    expect(deriveToggleVar('payment')).toBe('USE_MOCK_PAYMENT');
    expect(deriveToggleVar('multi-word-name')).toBe('USE_MOCK_MULTI_WORD_NAME');
    expect(deriveToggleVar('already_snake')).toBe('USE_MOCK_ALREADY_SNAKE');
  });

  // -----------------------------------------------------------------
  // Framework-prefix-aware resolution (regression: "auto-detect → real").
  //
  // A Next.js / Vite / CRA client app writes its toggle with the framework
  // prefix the bundler requires. The bare-only resolver read NONE of them and
  // resolved every frontend connection to `active=false` (real). These lock
  // the prefix-agnostic chain.
  // -----------------------------------------------------------------
  it('case 13: per-port NEXT_PUBLIC_USE_MOCK_X=true flips active to true', () => {
    const root = setupProject({
      '.env.example': ['# @connection business stripe-api', 'STRIPE_API_KEY='].join('\n'),
      '.env': 'NEXT_PUBLIC_USE_MOCK_STRIPE_API=true',
    });
    expect(detectFromAnnotations(root)[0].virtualization?.active).toBe(true);
  });

  it('case 14: prefixed master NEXT_PUBLIC_USE_MOCK=true broadcasts (per-port name mismatch falls through to master)', () => {
    // Mirrors the classboard app: connection `backend-api` (derived
    // USE_MOCK_BACKEND_API) but the app authored NEXT_PUBLIC_USE_MOCK_API +
    // a prefixed master. The per-connection toggle does not match; the
    // prefixed master must still activate the mock.
    const root = setupProject({
      '.env.example': ['# @connection business backend-api', 'NEXT_PUBLIC_API_BASE_URL='].join('\n'),
      '.env': ['NEXT_PUBLIC_API_BASE_URL=', 'NEXT_PUBLIC_USE_MOCK=true'].join('\n'),
    });
    expect(detectFromAnnotations(root)[0].virtualization?.active).toBe(true);
  });

  it('case 15: VITE_ prefixed per-port toggle is read', () => {
    const root = setupProject({
      '.env.example': ['# @connection business stats-api', 'VITE_STATS_BASE_URL='].join('\n'),
      '.env': 'VITE_USE_MOCK_STATS_API=true',
    });
    expect(detectFromAnnotations(root)[0].virtualization?.active).toBe(true);
  });

  it('case 16: prefixed per-port USE_MOCK_X=false still wins over prefixed master=true', () => {
    const root = setupProject({
      '.env.example': ['# @connection business stripe-api', 'STRIPE_API_KEY='].join('\n'),
      '.env': ['NEXT_PUBLIC_USE_MOCK_STRIPE_API=false', 'NEXT_PUBLIC_USE_MOCK=true'].join('\n'),
    });
    expect(detectFromAnnotations(root)[0].virtualization?.active).toBe(false);
  });
});
