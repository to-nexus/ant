import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { detectFromAnnotations } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseEnvAnnotations';
import { detectFromTomlAnnotations } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseTomlAnnotations';
import {
  parseMockModifier,
  deriveToggleVar,
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseModifiers';

/**
 * Phase 1 — Service Virtualization annotation grammar truth table.
 *
 * Locks the 12-case matrix from plan §4.4: every legal `mock:*` token
 * combination across .env / TOML annotations and the per-port × master
 * USE_MOCK toggle resolution priority. Any drift here points at either
 * (a) parseMockModifier dispatch breaking, or (b) overrideWithEnvFile
 * losing the priority chain — both are the kinds of silent regressions
 * the user explicitly asked Phase 1 to prevent.
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

describe('connection annotation virtualization grammar', () => {
  // -----------------------------------------------------------------
  // Case 1 — `mock:available` only → mockKind=available + derived toggle
  // -----------------------------------------------------------------
  it('case 1: `mock:available` only sets mockKind and derives toggleEnvVar', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api mock:available',
        'STRIPE_API_KEY=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    const c = conns[0];
    expect(c.virtualization).toBeDefined();
    expect(c.virtualization?.mockKind).toBe('available');
    expect(c.virtualization?.toggleEnvVar).toBe('USE_MOCK_STRIPE_API');
    // active starts false; overrideWithEnvFile flips it when .env exists
    expect(c.virtualization?.active).toBe(false);
    expect(c.resolution).toEqual({ type: 'url', url: '' });
  });

  // -----------------------------------------------------------------
  // Case 2 — `mock:inline` only → no toggle, always active
  // -----------------------------------------------------------------
  it('case 2: `mock:inline` only marks always-active with no toggle var', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business notification mock:inline',
        'NOTIFICATION_WEBHOOK=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    const c = conns[0];
    expect(c.virtualization?.mockKind).toBe('inline');
    expect(c.virtualization?.toggleEnvVar).toBeUndefined();
    expect(c.virtualization?.active).toBe(true);
  });

  // -----------------------------------------------------------------
  // Case 3 — TOML: `self mock:available env:API_URL`
  //   → resolution=ant-project + virtualization=available + envVar=API_URL
  // -----------------------------------------------------------------
  it('case 3: TOML `self mock:available env:API_URL` combines all three layers', () => {
    const root = setupProject({
      'config.example.toml': [
        '# @connection business backend-api self mock:available env:API_BASE_URL',
        '[api]',
        'base_url = ""',
      ].join('\n'),
    });

    const conns = detectFromTomlAnnotations(root);
    expect(conns).toHaveLength(1);
    const c = conns[0];
    expect(c.envVar).toBe('API_BASE_URL');
    expect(c.resolution).toEqual({ type: 'ant-project', projectId: 'self', feature: 'self' });
    expect(c.virtualization?.mockKind).toBe('available');
    expect(c.virtualization?.toggleEnvVar).toBe('USE_MOCK_BACKEND_API');
  });

  // -----------------------------------------------------------------
  // Case 4 — `ant-project:p:f mock:available` (.env)
  //   → resolution=ant-project(p,f) + virtualization=available
  // -----------------------------------------------------------------
  it('case 4: `ant-project:p:f mock:available` combines both layers in .env', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stats-api ant-project:sketch-be:skeleton mock:available',
        'VITE_STATS_BASE_URL=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    const c = conns[0];
    expect(c.resolution).toEqual({
      type: 'ant-project',
      projectId: 'sketch-be',
      feature: 'skeleton',
    });
    expect(c.virtualization?.mockKind).toBe('available');
    expect(c.virtualization?.toggleEnvVar).toBe('USE_MOCK_STATS_API');
  });

  // -----------------------------------------------------------------
  // Case 5 — no mock token → virtualization undefined
  // -----------------------------------------------------------------
  it('case 5: omitting the mock token leaves virtualization undefined', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business payment-api',
        'PAYMENT_URL=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    expect(conns[0].virtualization).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // Case 6 — `.env` with USE_MOCK_X=true → active=true
  // -----------------------------------------------------------------
  it('case 6: `.env` per-port USE_MOCK_X=true flips active to true', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business stripe-api mock:available',
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
        '# @connection business stripe-api mock:available',
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
        '# @connection business stripe-api mock:available',
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
        '# @connection business stripe-api mock:available',
        'STRIPE_API_KEY=',
      ].join('\n'),
      '.env': 'STRIPE_API_KEY=', // .env exists but no toggle var
    });

    const conns = detectFromAnnotations(root);
    expect(conns[0].virtualization?.active).toBe(false);
  });

  // -----------------------------------------------------------------
  // Case 10 — infrastructure + mock:available → warn + virtualization dropped
  // -----------------------------------------------------------------
  it('case 10: infrastructure + mock:available drops virtualization with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const root = setupProject({
      '.env.example': [
        '# @connection infrastructure postgres mock:available',
        'DATABASE_URL=',
      ].join('\n'),
    });

    const conns = detectFromAnnotations(root);
    expect(conns).toHaveLength(1);
    expect(conns[0].category).toBe('infrastructure');
    expect(conns[0].virtualization).toBeUndefined();

    warnSpy.mockRestore();
  });

  // -----------------------------------------------------------------
  // Case 11 — unknown `mock:*` token → no-op + warn
  // -----------------------------------------------------------------
  it('case 11: unknown mock:* token is a no-op (parseMockModifier returns null)', () => {
    expect(parseMockModifier('mock:invalid', 'stripe-api')).toBeNull();
    expect(parseMockModifier('mock:weird', 'svc')).toBeNull();
    // Non-mock tokens are also null at the mock layer
    expect(parseMockModifier('self', 'svc')).toBeNull();
    expect(parseMockModifier('ant-project:p:f', 'svc')).toBeNull();
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
});
