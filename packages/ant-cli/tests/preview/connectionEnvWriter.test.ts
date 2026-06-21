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
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';
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

describe('mirrorConnectionToEnv (§5 value invariant)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-envwriter-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
  const envp = () => path.join(dir, '.env');
  const read = () => (fs.existsSync(envp()) ? fs.readFileSync(envp(), 'utf-8') : '');

  it('virtualized business → empty value (no fabricated localhost)', () => {
    mirrorConnectionToEnv(envp(), conn({ value: 'https://api.stripe.com' }));
    const c = read();
    expect(c).toMatch(/^STRIPE_API_KEY=\s*$/m);
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
