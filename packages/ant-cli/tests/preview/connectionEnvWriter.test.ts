/**
 * Locks the deterministic `.env.example` annotation writer + `.env` mirror —
 * the write side of panel Save that replaced the Fix → LLM code-job round-trip.
 * Surgical line-model: only the target lines change; everything else is preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  upsertConnectionAnnotation,
  removeConnectionAnnotation,
  mirrorConnectionToEnv,
  removeEnvKey,
  syncEnvStructureFromExample,
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';
import { detectFromAnnotations } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/parseEnvAnnotations';
import type { ServiceConnection } from '../../src/core/ports/portRegistry';

const conn = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  id: 'stripe-api',
  name: 'Stripe Api',
  category: 'business',
  envVar: 'STRIPE_API_KEY',
  value: '',
  resolution: { type: 'url', url: '' },
  source: '*',
  virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false },
  ...over,
});

describe('upsertConnectionAnnotation (.env.example)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const ex = () => path.join(dir, '.env.example');
  const read = () => (fs.existsSync(ex()) ? fs.readFileSync(ex(), 'utf-8') : '');

  it('creates annotation + KEY pair when the file is absent', () => {
    upsertConnectionAnnotation(ex(), conn());
    const c = read();
    expect(c).toContain('# @connection business stripe-api');
    expect(c).toContain('STRIPE_API_KEY=');
  });

  it('replaces an existing annotation in place, preserving other lines', () => {
    fs.writeFileSync(ex(), '# header\n# @connection business stripe-api\nSTRIPE_API_KEY=\nOTHER=1\n');
    upsertConnectionAnnotation(ex(), conn({ resolution: { type: 'ant-project', projectId: 'self', feature: 'self' } }));
    const c = read();
    expect(c).toContain('# @connection business stripe-api self');
    expect(c).toContain('# header');
    expect(c).toContain('OTHER=1');
    expect(c.split('\n').filter(l => l.includes('@connection business stripe-api')).length).toBe(1);
  });

  it('inserts the annotation directly above an un-annotated KEY', () => {
    fs.writeFileSync(ex(), 'STRIPE_API_KEY=\n');
    upsertConnectionAnnotation(ex(), conn());
    const lines = read().split('\n');
    const keyIdx = lines.findIndex(l => l.startsWith('STRIPE_API_KEY='));
    expect(lines[keyIdx - 1]).toBe('# @connection business stripe-api');
  });

  it('business: backfills the framework-aware mock toggle when absent', () => {
    upsertConnectionAnnotation(ex(), conn(), 'next');
    expect(read()).toContain('NEXT_PUBLIC_USE_MOCK_STRIPE_API=true');
  });
});

describe('removeConnectionAnnotation (.env.example)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const ex = () => path.join(dir, '.env.example');

  it('removes only the annotation line, leaving the KEY intact', () => {
    fs.writeFileSync(ex(), '# @connection business stripe-api\nSTRIPE_API_KEY=\n');
    removeConnectionAnnotation(ex(), conn());
    const c = fs.readFileSync(ex(), 'utf-8');
    expect(c).not.toContain('@connection');
    expect(c).toContain('STRIPE_API_KEY=');
  });
});

describe('mirrorConnectionToEnv (.env is the value SSOT)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const envp = () => path.join(dir, '.env');
  const read = () => (fs.existsSync(envp()) ? fs.readFileSync(envp(), 'utf-8') : '');

  it('business: persists the user-entered value verbatim (.env owns the value)', () => {
    mirrorConnectionToEnv(envp(), conn({ value: 'https://api.stripe.com' }));
    expect(read()).toContain('STRIPE_API_KEY=https://api.stripe.com');
  });

  it('business: empty value stays empty (no fabricated default)', () => {
    mirrorConnectionToEnv(envp(), conn({ value: '' }));
    expect(read()).toMatch(/^STRIPE_API_KEY=\s*$/m);
  });

  it('business: persists the active toggle value (false) to .env', () => {
    mirrorConnectionToEnv(envp(), conn({ virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false } }));
    expect(read()).toContain('USE_MOCK_STRIPE_API=false');
  });

  it('business: persists active=true', () => {
    mirrorConnectionToEnv(envp(), conn({ virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: true } }));
    expect(read()).toContain('USE_MOCK_STRIPE_API=true');
  });

  it('business: overwrites an existing opposite toggle value (Save persists choice)', () => {
    fs.writeFileSync(envp(), 'USE_MOCK_STRIPE_API=true\n');
    mirrorConnectionToEnv(envp(), conn({ virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false } }));
    const c = read();
    expect(c).toContain('USE_MOCK_STRIPE_API=false');
    expect(c).not.toContain('USE_MOCK_STRIPE_API=true');
  });

  it('infrastructure → keeps its localhost/compose value', () => {
    const infra = conn({
      id: 'postgres', name: 'PostgreSQL', category: 'infrastructure',
      envVar: 'DATABASE_URL', value: 'postgres://localhost:5432/db',
      resolution: { type: 'url', url: 'postgres://localhost:5432/db' },
      virtualization: undefined,
    });
    mirrorConnectionToEnv(envp(), infra);
    expect(read()).toContain('DATABASE_URL=postgres://localhost:5432/db');
  });
});

/**
 * Comment-tolerant annotation binding on the WRITE side — regression for the
 * classboard cloud case where a code job placed explanatory comment lines
 * between `# @connection business api` and its KEY. Strict `keyIdx - 1`
 * adjacency missed the annotation, inserted a duplicate, and first-wins dedup
 * reverted the resolution on Auto-Detect. The writer must locate the existing
 * annotation with the same rule the reader binds with (`findNextEnvLine`).
 */
describe('annotation write with comments between annotation and KEY', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-gap-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const ex = () => path.join(dir, '.env.example');
  const read = () => (fs.existsSync(ex()) ? fs.readFileSync(ex(), 'utf-8') : '');
  const apiConn = (over: Partial<ServiceConnection> = {}): ServiceConnection =>
    conn({
      id: 'api', name: 'Api', envVar: 'NEXT_PUBLIC_API_BASE_URL',
      virtualization: { toggleEnvVar: 'USE_MOCK_API', active: false },
      ...over,
    });

  it('replaces the annotation in place across a comment gap (no duplicate)', () => {
    fs.writeFileSync(ex(), [
      '# @connection business api',
      '# auth is the /api/v1/auth/* route group of this same backend, not a',
      '# separate service — its adapter shares this connection\'s single toggle.',
      'NEXT_PUBLIC_API_BASE_URL=',
      'NEXT_PUBLIC_USE_MOCK_API=false',
      '',
    ].join('\n'));
    upsertConnectionAnnotation(
      ex(),
      apiConn({ resolution: { type: 'ant-project', projectId: 'classboard-be', feature: 'cloud-opus' } }),
      'next',
    );
    const lines = read().split('\n');
    const ann = lines.filter(l => l.includes('@connection business api'));
    expect(ann).toEqual(['# @connection business api ant-project:classboard-be:cloud-opus']);
    // Explanatory comments preserved.
    expect(read()).toContain('# auth is the /api/v1/auth/* route group');
  });

  it('self-heals a file already corrupted with a duplicate annotation', () => {
    fs.writeFileSync(ex(), [
      '# @connection business api',
      '# explanatory comment',
      '# @connection business api ant-project:classboard-be:cloud-opus',
      'NEXT_PUBLIC_API_BASE_URL=',
      '',
    ].join('\n'));
    upsertConnectionAnnotation(
      ex(),
      apiConn({ resolution: { type: 'ant-project', projectId: 'classboard-be', feature: 'cloud-opus' } }),
      'next',
    );
    const ann = read().split('\n').filter(l => l.includes('@connection business api'));
    expect(ann).toEqual(['# @connection business api ant-project:classboard-be:cloud-opus']);
  });

  it('round-trips: detect re-reads the written ant-project resolution (no revert)', () => {
    fs.writeFileSync(ex(), [
      '# @connection business api',
      '# explanatory comment that separates the annotation from its KEY',
      'NEXT_PUBLIC_API_BASE_URL=',
      'NEXT_PUBLIC_USE_MOCK_API=false',
      '',
    ].join('\n'));
    upsertConnectionAnnotation(
      ex(),
      apiConn({ resolution: { type: 'ant-project', projectId: 'classboard-be', feature: 'cloud-opus' } }),
      'next',
    );
    const detected = detectFromAnnotations(dir);
    const api = detected.find(c => c.id === 'api');
    expect(api?.resolution).toEqual({
      type: 'ant-project', projectId: 'classboard-be', feature: 'cloud-opus',
    });
  });

  it('removeConnectionAnnotation drops the annotation across a comment gap, keeping comments + KEY', () => {
    fs.writeFileSync(ex(), [
      '# @connection business api',
      '# explanatory comment',
      'NEXT_PUBLIC_API_BASE_URL=',
      '',
    ].join('\n'));
    removeConnectionAnnotation(ex(), apiConn());
    const c = read();
    expect(c).not.toContain('@connection');
    expect(c).toContain('# explanatory comment');
    expect(c).toContain('NEXT_PUBLIC_API_BASE_URL=');
  });

  it('does NOT touch another connection whose annotation is separated by an intervening KEY', () => {
    // `api` binds to NEXT_PUBLIC_API_BASE_URL; upserting `other` must not collect it.
    fs.writeFileSync(ex(), [
      '# @connection business api',
      'NEXT_PUBLIC_API_BASE_URL=',
      'OTHER_URL=',
      '',
    ].join('\n'));
    upsertConnectionAnnotation(
      ex(),
      conn({ id: 'other', envVar: 'OTHER_URL', virtualization: { toggleEnvVar: 'USE_MOCK_OTHER', active: false } }),
    );
    const c = read();
    // The api annotation is untouched (still modifier-less), and `other` got its own.
    expect(c).toContain('# @connection business api\n');
    expect(c).toContain('# @connection business other');
    expect(c.split('\n').filter(l => l.includes('@connection business api')).length).toBe(1);
  });
});

describe('removeEnvKey (.env structure delete)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const envp = () => path.join(dir, '.env');

  it('removes the target KEY line, preserving the rest', () => {
    fs.writeFileSync(envp(), 'A=1\nSTRIPE_API_KEY=secret\nB=2\n');
    removeEnvKey(envp(), 'STRIPE_API_KEY');
    const c = fs.readFileSync(envp(), 'utf-8');
    expect(c).not.toContain('STRIPE_API_KEY');
    expect(c).toContain('A=1');
    expect(c).toContain('B=2');
  });

  it('is a no-op when the key or file is absent', () => {
    expect(() => removeEnvKey(envp(), 'MISSING')).not.toThrow();
    fs.writeFileSync(envp(), 'A=1\n');
    removeEnvKey(envp(), 'MISSING');
    expect(fs.readFileSync(envp(), 'utf-8')).toContain('A=1');
  });
});

describe('syncEnvStructureFromExample (.env.example → .env, value-preserving)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const ex = () => path.join(dir, '.env.example');
  const envp = () => path.join(dir, '.env');
  const readEnv = () => (fs.existsSync(envp()) ? fs.readFileSync(envp(), 'utf-8') : '');

  it('adds a missing connection value key (empty) + business mock-on toggle default', () => {
    fs.writeFileSync(ex(), '# @connection business stripe-api\nSTRIPE_API_KEY=\n');
    fs.writeFileSync(envp(), 'EXISTING=1\n');
    syncEnvStructureFromExample(ex(), envp(), 'next');
    const c = readEnv();
    expect(c).toMatch(/^STRIPE_API_KEY=\s*$/m);
    expect(c).toContain('NEXT_PUBLIC_USE_MOCK_STRIPE_API=true');
    expect(c).toContain('EXISTING=1');
  });

  it('PRESERVES an existing .env value/toggle (never clobbers user edits)', () => {
    fs.writeFileSync(ex(), '# @connection business stripe-api\nSTRIPE_API_KEY=\n');
    fs.writeFileSync(envp(), 'STRIPE_API_KEY=live-key\nNEXT_PUBLIC_USE_MOCK_STRIPE_API=false\n');
    syncEnvStructureFromExample(ex(), envp(), 'next');
    const c = readEnv();
    expect(c).toContain('STRIPE_API_KEY=live-key');
    expect(c).toContain('NEXT_PUBLIC_USE_MOCK_STRIPE_API=false');
    // No duplicate/overwritten toggle
    expect(c).not.toContain('NEXT_PUBLIC_USE_MOCK_STRIPE_API=true');
  });

  it('does NOT delete a .env key absent from .env.example (plain user config)', () => {
    fs.writeFileSync(ex(), '# @connection business stripe-api\nSTRIPE_API_KEY=\n');
    fs.writeFileSync(envp(), 'USER_ONLY=keepme\n');
    syncEnvStructureFromExample(ex(), envp(), 'next');
    expect(readEnv()).toContain('USER_ONLY=keepme');
  });
});
