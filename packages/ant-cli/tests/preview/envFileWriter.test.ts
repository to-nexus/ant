import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { setEnvValue } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';

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
