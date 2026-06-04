import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import {
  setEnvValue,
  setToggleEnvValue,
} from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';
import { toToggleFramework } from '../../src/core/prompt/builder/serviceVirtualization/connectionModel';

let workdir = '';

afterEach(() => {
  if (workdir) {
    rmSync(workdir, { recursive: true, force: true });
    workdir = '';
  }
});

describe('envFileWriter — setEnvValue', () => {
  it('creates the file with the single line when missing', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-writer-'));
    const envPath = join(workdir, '.env');
    expect(existsSync(envPath)).toBe(false);

    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');

    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, 'utf-8')).toBe('USE_MOCK_STRIPE_API=true\n');
  });

  it('appends when key absent, preserving existing lines + comments', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-writer-'));
    const envPath = join(workdir, '.env');
    writeFileSync(envPath, '# project env\nDATABASE_URL=postgres://x\n', 'utf-8');

    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');

    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('# project env');
    expect(content).toContain('DATABASE_URL=postgres://x');
    expect(content).toContain('USE_MOCK_STRIPE_API=true');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('replaces in-place when key present, preserving order + neighbours', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-writer-'));
    const envPath = join(workdir, '.env');
    writeFileSync(envPath, [
      '# header',
      'A=1',
      'USE_MOCK_STRIPE_API=false',
      'B=2',
      '',
    ].join('\n'), 'utf-8');

    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');

    const lines = readFileSync(envPath, 'utf-8').split('\n');
    expect(lines[0]).toBe('# header');
    expect(lines[1]).toBe('A=1');
    expect(lines[2]).toBe('USE_MOCK_STRIPE_API=true');
    expect(lines[3]).toBe('B=2');
  });

  it('does not duplicate the key on repeated writes', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-writer-'));
    const envPath = join(workdir, '.env');
    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');
    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'false');
    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');

    const occurrences = readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.startsWith('USE_MOCK_STRIPE_API='));
    expect(occurrences).toEqual(['USE_MOCK_STRIPE_API=true']);
  });

  it('round-trips through overrideWithEnvFile so toggle state is observed by the detector', async () => {
    const { overrideWithEnvFile } = await import(
      '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/utils'
    );
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-writer-'));
    const envPath = join(workdir, '.env');
    setEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'true');

    const conns = [{
      id: 'stripe-api',
      name: 'Stripe API',
      category: 'business' as const,
      envVar: 'STRIPE_API_KEY',
      value: 'http://localhost:4242',
      resolution: { type: 'url' as const, url: 'http://localhost:4242' },
      virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: false },
    }];
    overrideWithEnvFile(conns, workdir);

    expect(conns[0].virtualization.active).toBe(true);
  });
});

describe('envFileWriter — setToggleEnvValue (framework-prefix aware)', () => {
  it('REGRESSION: updates the prefixed line in place, never appends a bare orphan', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');
    writeFileSync(envPath, 'NEXT_PUBLIC_USE_MOCK_STRIPE_API=true\n', 'utf-8');

    const written = setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'false');

    const lines = readFileSync(envPath, 'utf-8').split('\n');
    expect(written).toBe('NEXT_PUBLIC_USE_MOCK_STRIPE_API');
    expect(lines).toContain('NEXT_PUBLIC_USE_MOCK_STRIPE_API=false');
    // The defect: a bare USE_MOCK_STRIPE_API orphan must NOT be appended.
    expect(lines.filter(l => l.startsWith('USE_MOCK_STRIPE_API='))).toEqual([]);
  });

  it('heals an already-polluted .env so resolveActivation reads the intended value', async () => {
    const { overrideWithEnvFile } = await import(
      '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/utils'
    );
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');
    // Post-bug state: prefixed=true and bare orphan=false disagree.
    writeFileSync(
      envPath,
      'NEXT_PUBLIC_USE_MOCK_STRIPE_API=true\nUSE_MOCK_STRIPE_API=false\n',
      'utf-8',
    );

    // User clicks "Real" → false. The prefixed line (read first) must converge.
    setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'false');

    const conns = [{
      id: 'stripe-api',
      name: 'Stripe API',
      category: 'business' as const,
      envVar: 'STRIPE_API_KEY',
      value: '',
      resolution: { type: 'url' as const, url: '' },
      virtualization: { toggleEnvVar: 'USE_MOCK_STRIPE_API', active: true },
    }];
    overrideWithEnvFile(conns, workdir);
    expect(conns[0].virtualization.active).toBe(false);
  });

  it('creates exactly the prefixed name when the file is missing (next)', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');

    setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'true');

    expect(readFileSync(envPath, 'utf-8')).toBe('NEXT_PUBLIC_USE_MOCK_STRIPE_API=true\n');
  });

  it('uses the bare name for non-bundler frameworks (other), updating an existing bare line', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');
    writeFileSync(envPath, 'USE_MOCK_NOTIFICATION_SERVICE=true\n', 'utf-8');

    const written = setToggleEnvValue(envPath, 'USE_MOCK_NOTIFICATION_SERVICE', 'other', 'false');

    expect(written).toBe('USE_MOCK_NOTIFICATION_SERVICE');
    expect(readFileSync(envPath, 'utf-8')).toBe('USE_MOCK_NOTIFICATION_SERVICE=false\n');
  });

  it('updates an existing bare line in place even when framework is a bundler (no prefixed orphan)', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');
    // Server-only connection in a Next app: initial gen wrote the bare form.
    writeFileSync(envPath, 'USE_MOCK_BACKEND_API=true\n', 'utf-8');

    const written = setToggleEnvValue(envPath, 'USE_MOCK_BACKEND_API', 'next', 'false');

    expect(written).toBe('USE_MOCK_BACKEND_API');
    expect(readFileSync(envPath, 'utf-8')).toBe('USE_MOCK_BACKEND_API=false\n');
  });

  it('is idempotent on repeated toggles', () => {
    workdir = mkdtempSync(join(os.tmpdir(), 'ant-env-toggle-'));
    const envPath = join(workdir, '.env');
    setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'true');
    setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'false');
    setToggleEnvValue(envPath, 'USE_MOCK_STRIPE_API', 'next', 'true');

    const occurrences = readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter(l => l.includes('USE_MOCK_STRIPE_API='));
    expect(occurrences).toEqual(['NEXT_PUBLIC_USE_MOCK_STRIPE_API=true']);
  });
});

describe('toToggleFramework — deploy enum → SV prefix enum', () => {
  it('maps every deploy framework value', () => {
    expect(toToggleFramework('nextjs')).toBe('next');
    expect(toToggleFramework('vite')).toBe('vite');
    expect(toToggleFramework('cra')).toBe('cra');
    expect(toToggleFramework('static')).toBe('other');
    expect(toToggleFramework('unknown')).toBe('other');
    expect(toToggleFramework(undefined)).toBe('other');
  });
});
