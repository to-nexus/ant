import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { ConnectionDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector';
import type { ProjectStructure } from '../../src/periphery/adapters/http/services/PreviewService/types';

/**
 * Phase 1 — ConnectionDetector modularization regression lock.
 *
 * The 685-line monolith was split into 8 sibling modules under
 * `detectors/ConnectionDetector/`. This suite exercises a single fixture
 * that touches every stage of the detection pipeline (annotation parse,
 * known-pattern fallback, docker-compose enrichment, dedup, id-uniqueness)
 * and asserts the exact shape of `detect()`'s output.
 *
 * If anyone reshuffles the modules later (or changes a helper signature),
 * this fixture's deep-equal lock will catch silent semantic drift before
 * it leaks into PreviewService consumers.
 */

let workdir: string;

function setupProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'ant-conn-mod-'));
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

const SERVER_KEY = 'org:user:my-proj:main';

describe('ConnectionDetector — modularization deep-equal lock', () => {
  it('exposes a default-constructible class with .detect() reachable through the directory index', () => {
    expect(() => new ConnectionDetector()).not.toThrow();
    const det = new ConnectionDetector();
    expect(typeof det.detect).toBe('function');
  });

  it('produces the locked output for an annotated .env.example without docker-compose', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business backend-api self',
        'VITE_API_BASE_URL=',
        '',
        '# @connection business stripe-api',
        'STRIPE_API_KEY=',
        '',
        '# @connection infrastructure postgres',
        'DATABASE_URL=postgresql://localhost:5432/dev',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'frontend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toEqual([
      {
        id: 'backend-api',
        name: 'Backend Api',
        category: 'business',
        envVar: 'VITE_API_BASE_URL',
        value: '/org--user--my-proj--main',
        resolution: {
          type: 'ant-project',
          projectId: 'my-proj',
          feature: 'main',
          serviceName: undefined,
          resolvedUrlKey: 'org--user--my-proj--main',
        },
        source: '*',
        configSource: 'env',
        virtualization: { toggleEnvVar: 'USE_MOCK_BACKEND_API', active: false },
      },
      {
        id: 'stripe-api',
        name: 'Stripe Api',
        category: 'business',
        envVar: 'STRIPE_API_KEY',
        value: '',
        resolution: { type: 'url', url: '' },
        source: '*',
        configSource: 'env',
        virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false },
      },
      {
        id: 'postgres',
        name: 'Postgres',
        category: 'infrastructure',
        envVar: 'DATABASE_URL',
        value: 'postgresql://localhost:5432/dev',
        resolution: { type: 'url', url: 'postgresql://localhost:5432/dev' },
        source: '*',
        configSource: 'env',
        // No virtualization — infrastructure is real (docker-compose).
      },
    ]);
  });

  it('upgrades infrastructure to docker resolution when docker-compose.yml declares a matching service', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection infrastructure postgres',
        'DATABASE_URL=postgresql://localhost:5432/dev',
      ].join('\n'),
      'docker-compose.yml': [
        'services:',
        '  postgres:',
        '    image: postgres:16',
        '    ports:',
        '      - "5432:5432"',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'backend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toHaveLength(1);
    expect(result[0].resolution).toEqual({
      type: 'docker',
      service: 'postgres',
      port: 5432,
    });
  });

  it('detects unannotated DATABASE_URL via the known-pattern fallback (missingAnnotation: true, no virtualization)', () => {
    const root = setupProject({
      '.env.example': 'DATABASE_URL=postgresql://localhost:5432/dev',
    });

    const structure: ProjectStructure = { type: 'backend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toEqual([
      {
        id: 'database',
        name: 'Database',
        category: 'infrastructure',
        envVar: 'DATABASE_URL',
        value: 'postgresql://localhost:5432/dev',
        resolution: { type: 'url', url: 'postgresql://localhost:5432/dev' },
        source: '*',
        missingAnnotation: true,
        // infrastructure → no virtualization, even via fallback.
      },
    ]);
  });

  it('detects unannotated VITE_API_BASE_URL via business fallback (auto virtualization)', () => {
    const root = setupProject({
      '.env.example': 'VITE_API_BASE_URL=https://api.example.com',
    });

    const structure: ProjectStructure = { type: 'frontend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toHaveLength(1);
    const c = result[0];
    expect(c.category).toBe('business');
    expect(c.missingAnnotation).toBe(true);
    expect(c.virtualization).toEqual({
      toggleEnvVar: 'USE_MOCK_API',
      active: false,
    });
  });

  it('annotated wins over fallback when both detect the same id (annotation priority)', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection infrastructure database',
        'DATABASE_URL=postgresql://localhost:5432/dev',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'backend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    // Single survivor — annotated entry; fallback dropped because the same
    // envVar is in subdirDetected before fallback runs, AND the same id
    // collides post-merge with annotated taking priority.
    expect(result).toHaveLength(1);
    expect(result[0].missingAnnotation).toBeUndefined();
    expect(result[0].id).toBe('database');
  });

  it('TOML annotations participate in the same dedup pass as .env annotations', () => {
    // The default-value scan stops at the first non-blank/non-comment line,
    // which for canonical TOML is the section header `[database]`.
    // `parseTomlValue` returns '' for section headers — so when annotations
    // sit above a section, the locked default is the empty string. Runtime
    // injection of `DATABASE_URL` overrides anyway, so this is purely a
    // detection-time placeholder concern. This lock pins the documented
    // pre-modularization behavior.
    const root = setupProject({
      'config.example.toml': [
        '# @connection infrastructure postgres env:DATABASE_URL',
        '[database]',
        'url = "postgresql://localhost:5432/dev"',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'backend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toHaveLength(1);
    expect(result[0].envVar).toBe('DATABASE_URL');
    expect(result[0].configSource).toBe('toml');
    expect(result[0].value).toBe('');
  });

  it('TOML annotations parse a primitive default value when the next meaningful line is `key = "value"`', () => {
    const root = setupProject({
      'config.example.toml': [
        '[database]',
        '# @connection infrastructure postgres env:DATABASE_URL',
        'url = "postgresql://localhost:5432/dev"',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'backend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('postgresql://localhost:5432/dev');
  });

  it('every business connection auto-attaches virtualization (no per-connection opt-in)', () => {
    const root = setupProject({
      '.env.example': [
        '# @connection business backend-api self',
        'VITE_API_BASE_URL=',
      ].join('\n'),
    });

    const structure: ProjectStructure = { type: 'frontend-only', packages: [] };
    const result = new ConnectionDetector().detect(root, structure, SERVER_KEY);

    expect(result[0].virtualization).toEqual({
      toggleEnvVar: 'USE_MOCK_BACKEND_API',
      active: false,
    });
  });
});
