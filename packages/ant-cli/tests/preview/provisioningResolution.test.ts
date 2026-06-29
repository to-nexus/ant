import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProvisioningManager } from '../../src/periphery/adapters/http/services/PreviewService/managers/ProvisioningManager';
import { InfrastructureManager } from '../../src/periphery/adapters/http/services/PreviewService/managers/InfrastructureManager';
import { getComposeServices } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/enrichCompose';
import type { PackageInfo } from '../../src/periphery/adapters/http/services/PreviewService/types';
import type { PreviewManifestResult } from '../../src/periphery/adapters/http/services/PreviewService/managers/previewManifest';

/**
 * Provisioning command resolution — the post-infra setup step that fixes the
 * "fresh empty DB → every query fails" preview gap.
 *
 * Declared-only: the single source is the preview manifest. ANT infra is
 * ORM/stack-agnostic — it runs the declared commands, it does NOT auto-detect
 * Prisma (or any ORM). Root commands run at the project root; per-package
 * commands run in the matching package's cwd, keyed by
 * `packageSource = path.relative(projectRoot, pkg.path)`.
 */

const manifest = (m: Partial<PreviewManifestResult>): PreviewManifestResult => ({
  root: m.root ?? [],
  byPackage: m.byPackage ?? {},
});

function withTempProject(
  setup: (dir: string) => void,
  assert: (dir: string) => void,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  try {
    setup(dir);
    assert(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempProjectAsync(
  setup: (dir: string) => void,
  assert: (dir: string) => Promise<void>,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  try {
    setup(dir);
    await assert(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const pkg = (p: string): PackageInfo => ({ name: 'root', path: p, type: 'backend' });

describe('ProvisioningManager.resolveSetupCommands', () => {
  const mgr = new ProvisioningManager();

  it('empty manifest → no setup commands', () => {
    const cmds = mgr.resolveSetupCommands([pkg('/tmp/root')], '/tmp/root', manifest({}));
    expect(cmds).toHaveLength(0);
  });

  it('root setupCommands → verbatim, shell, root cwd, packageSource "*"', () => {
    const root = '/tmp/root';
    const cmds = mgr.resolveSetupCommands(
      [pkg(root)], root,
      manifest({ root: ['npm run db:setup', 'npm run seed'] }),
    );
    expect(cmds.map(c => c.label)).toEqual(['npm run db:setup', 'npm run seed']);
    expect(cmds.every(c => c.shell)).toBe(true);
    expect(cmds.every(c => c.cwd === root)).toBe(true);
    expect(cmds.every(c => c.packageSource === '*')).toBe(true);
  });

  it('per-package: key matches packageSource → cwd + env scoped to that package', () => {
    withTempProject(
      () => { /* no fs needed — resolution is manifest-driven */ },
      (dir) => {
        const api = path.join(dir, 'apps', 'api');
        const key = path.relative(dir, api); // 'apps/api'
        const cmds = mgr.resolveSetupCommands(
          [{ name: 'api', path: api, type: 'backend' }], dir,
          manifest({ byPackage: { [key]: ['npx prisma migrate deploy'] } }),
        );
        expect(cmds).toHaveLength(1);
        expect(cmds[0].label).toBe('npx prisma migrate deploy');
        expect(cmds[0].cwd).toBe(api);
        expect(cmds[0].packageSource).toBe(key);
        expect(cmds[0].shell).toBe(true);
      },
    );
  });

  it('per-package key matching no detected package → skipped (no command)', () => {
    const root = '/tmp/root';
    const cmds = mgr.resolveSetupCommands(
      [pkg(root)], root,
      manifest({ byPackage: { 'apps/ghost': ['npm run x'] } }),
    );
    expect(cmds).toHaveLength(0);
  });

  it('root + per-package combined → root first, then matched package', () => {
    const dir = '/tmp/root';
    const api = path.join(dir, 'apps', 'api');
    const key = path.relative(dir, api);
    const cmds = mgr.resolveSetupCommands(
      [pkg(dir), { name: 'api', path: api, type: 'backend' }], dir,
      manifest({ root: ['npm run migrate:all'], byPackage: { [key]: ['npm run seed'] } }),
    );
    expect(cmds.map(c => c.label)).toEqual(['npm run migrate:all', 'npm run seed']);
    expect(cmds[0].cwd).toBe(dir);
    expect(cmds[1].cwd).toBe(api);
  });
});

describe('InfrastructureManager.startInfrastructure — structured result', () => {
  it('no compose file → ok:true, composePresent:false (preview unaffected, docker not touched)', async () => {
    await withTempProjectAsync(
      () => { /* project with no compose file */ },
      async (dir) => {
        const mgr = new InfrastructureManager();
        const result = await mgr.startInfrastructure(dir, () => {}, 'ant-test');
        expect(result).toEqual({ ok: true, composePresent: false });
      },
    );
  });
});

describe('getComposeServices — published host port parsing (readiness probe SSOT)', () => {
  it('extracts the host side of each first port mapping', () => {
    withTempProject(
      (dir) => {
        fs.writeFileSync(
          path.join(dir, 'docker-compose.yml'),
          [
            'services:',
            '  postgres:',
            '    image: postgres:16-alpine',
            '    ports:',
            '      - "5432:5432"',
            '  rabbitmq:',
            '    image: rabbitmq:3.13',
            '    ports:',
            '      - "5672:5672"',
            '      - "15672:15672"',
          ].join('\n'),
        );
      },
      (dir) => {
        const services = getComposeServices(dir);
        const ports = services.map(s => s.port);
        expect(ports).toContain(5432);
        expect(ports).toContain(5672);
      },
    );
  });
});
