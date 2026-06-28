import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProvisioningManager } from '../../src/periphery/adapters/http/services/PreviewService/managers/ProvisioningManager';
import { InfrastructureManager } from '../../src/periphery/adapters/http/services/PreviewService/managers/InfrastructureManager';
import { getComposeServices } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/enrichCompose';
import type { PackageInfo } from '../../src/periphery/adapters/http/services/PreviewService/types';

/**
 * Provisioning command resolution — the post-infra setup step that fixes the
 * "fresh empty DB → every query fails" preview gap.
 *
 * Key regression (the defect caught during planning): a Prisma project WITHOUT
 * committed migrations must use `db push`, NOT `migrate deploy` — `migrate
 * deploy` errors with "No migration found" and would not provision the schema.
 */

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

  it('Prisma WITHOUT migrations → db push --skip-generate (not migrate deploy)', () => {
    withTempProject(
      (dir) => {
        fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'datasource db {}');
      },
      (dir) => {
        const cmds = mgr.resolveSetupCommands([pkg(dir)], dir);
        expect(cmds).toHaveLength(1);
        expect(cmds[0].label).toBe('prisma db push --skip-generate');
        // never migrate deploy when there is no migration history
        expect(cmds[0].label).not.toContain('migrate deploy');
      },
    );
  });

  it('Prisma WITH committed migrations → migrate deploy', () => {
    withTempProject(
      (dir) => {
        fs.mkdirSync(path.join(dir, 'prisma', 'migrations', '0001_init'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'datasource db {}');
        fs.writeFileSync(path.join(dir, 'prisma', 'migrations', '0001_init', 'migration.sql'), 'SELECT 1;');
      },
      (dir) => {
        const cmds = mgr.resolveSetupCommands([pkg(dir)], dir);
        expect(cmds).toHaveLength(1);
        expect(cmds[0].label).toBe('prisma migrate deploy');
      },
    );
  });

  it('no Prisma schema → no setup commands', () => {
    withTempProject(
      () => { /* empty project */ },
      (dir) => expect(mgr.resolveSetupCommands([pkg(dir)], dir)).toHaveLength(0),
    );
  });

  it('declared setupCommands take precedence over ORM auto-detect (verbatim, shell, root cwd)', () => {
    withTempProject(
      (dir) => {
        fs.mkdirSync(path.join(dir, 'prisma'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'prisma', 'schema.prisma'), 'datasource db {}');
      },
      (dir) => {
        const cmds = mgr.resolveSetupCommands([pkg(dir)], dir, ['npm run db:setup', 'npm run seed']);
        expect(cmds.map(c => c.label)).toEqual(['npm run db:setup', 'npm run seed']);
        expect(cmds.every(c => c.shell)).toBe(true);
        expect(cmds.every(c => c.cwd === dir)).toBe(true);
      },
    );
  });

  it('per-package: schema in a subpackage resolves cwd + packageSource to that package', () => {
    withTempProject(
      (dir) => {
        const api = path.join(dir, 'packages', 'api');
        fs.mkdirSync(path.join(api, 'prisma'), { recursive: true });
        fs.writeFileSync(path.join(api, 'prisma', 'schema.prisma'), 'datasource db {}');
      },
      (dir) => {
        const api = path.join(dir, 'packages', 'api');
        const cmds = mgr.resolveSetupCommands([{ name: 'api', path: api, type: 'backend' }], dir);
        expect(cmds).toHaveLength(1);
        expect(cmds[0].cwd).toBe(api);
        expect(cmds[0].packageSource).toBe(path.join('packages', 'api'));
      },
    );
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
