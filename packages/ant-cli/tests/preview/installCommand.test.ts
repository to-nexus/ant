import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectPackageManager, buildInstallCommand } from '../../src/utils/packageManager';

/**
 * SSOT for preview (dev server) AND deploy (production build) dependency install.
 *
 * Invariant under test: the install ALWAYS includes devDependencies regardless of
 * NODE_ENV. The cloud process inherits NODE_ENV=production, so pnpm/yarn would skip
 * devDependencies (typescript, @types/*) without an explicit force-dev flag — which
 * caused `next dev` to self-install TS and hit ERR_PNPM_INCLUDED_DEPS_CONFLICT.
 * Both DependencyInstaller.runInstall and BuildRunner.ensureDependencies route
 * through buildInstallCommand, so this is the one place the contract is pinned.
 */
describe('buildInstallCommand — always includes devDependencies', () => {
  it('pnpm forces dev deps via --prod=false (and keeps purge-prompt suppression)', () => {
    const { command, args } = buildInstallCommand('pnpm');
    expect(command).toBe('pnpm');
    expect(args).toContain('install');
    expect(args).toContain('--prod=false');
    expect(args).toContain('--config.confirm-modules-purge=false');
  });

  it('yarn forces dev deps via --production=false', () => {
    const { command, args } = buildInstallCommand('yarn');
    expect(command).toBe('yarn');
    expect(args).toEqual(['install', '--production=false']);
  });

  it('npm forces dev deps via --include=dev', () => {
    const { command, args } = buildInstallCommand('npm');
    expect(command).toBe('npm');
    expect(args).toEqual(['install', '--include=dev']);
  });
});

/**
 * M-NEW-001: `buildCredentialEnv` puts a user's GitHub PAT in `GIT_CONFIG_KEY_0`
 * as a raw value, and one install pass hands that environment to every
 * `preinstall` / `install` / `postinstall` script in the tree. The install is now
 * two passes — credentialed fetch with scripts off, then credential-free
 * lifecycle — so the pass that holds the PAT runs no dependency code, and the pass
 * that runs dependency code holds no PAT.
 */
describe('credential-safe install: scripts-off acquire, credential-free lifecycle', () => {
  for (const pm of ['pnpm', 'yarn', 'npm'] as const) {
    it(`${pm} acquire pass disables lifecycle scripts and keeps dev deps`, () => {
      const acquire = buildInstallCommand(pm, { ignoreScripts: true });
      expect(acquire.args).toContain('--ignore-scripts');
      // The dev-deps contract above must survive the new flag.
      expect(acquire.args.some(a => /--prod=false|--production=false|--include=dev/.test(a))).toBe(true);
    });

    it(`${pm} lifecycle pass leaves scripts enabled`, () => {
      expect(buildInstallCommand(pm).args).not.toContain('--ignore-scripts');
      expect(buildInstallCommand(pm, {}).args).not.toContain('--ignore-scripts');
      expect(buildInstallCommand(pm, { ignoreScripts: false }).args).not.toContain('--ignore-scripts');
    });
  }

  // M-NEW-001 (recheck): --ignore-scripts does not stop pnpm's own
  // `.pnpmfile.cjs` hook, which can read GIT_CONFIG_KEY_0. The credentialed
  // acquire pass must also pass --ignore-pnpmfile; the lifecycle pass must not.
  it('pnpm acquire pass also disables the project pnpmfile hook', () => {
    expect(buildInstallCommand('pnpm', { ignoreScripts: true }).args).toContain('--ignore-pnpmfile');
    expect(buildInstallCommand('pnpm').args).not.toContain('--ignore-pnpmfile');
    expect(buildInstallCommand('pnpm', { ignoreScripts: false }).args).not.toContain('--ignore-pnpmfile');
  });

  // M-NEW-001 (recheck): --ignore-scripts does not stop yarn's own project
  // loader — a checked-in `yarnPath` binary is re-execed AS yarn, and
  // `.yarnrc.yml` plugins load into yarn's process, both with the PAT in env.
  // The credentialed acquire pass sets env that neutralizes them; the
  // lifecycle pass carries no such env.
  it('yarn acquire pass neutralizes the project yarnPath/plugin loader via env', () => {
    const acquire = buildInstallCommand('yarn', { ignoreScripts: true });
    expect(acquire.env).toMatchObject({ YARN_IGNORE_PATH: '1', YARN_ENABLE_SCRIPTS: 'false' });
    expect(buildInstallCommand('yarn').env).toBeUndefined();
    expect(buildInstallCommand('yarn', { ignoreScripts: false }).env).toBeUndefined();
  });

  it('runInstall passes credentials only to the scripts-off pass', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/periphery/adapters/http/services/PreviewService/managers/DependencyInstaller.ts'),
      'utf8',
    );
    // The acquire pass is the only one that names credentialEnv; the lifecycle
    // pass is constructed without it.
    const acquire = src.slice(src.indexOf('const acquire ='), src.indexOf('const lifecycle ='));
    const lifecycle = src.slice(src.indexOf('const lifecycle ='), src.indexOf('/** One install invocation.'));
    expect(acquire).toContain('ignoreScripts: true');
    expect(acquire).toContain('credentialEnv');
    expect(lifecycle).not.toContain('credentialEnv');
    expect(lifecycle).not.toContain('ignoreScripts');
  });

  it('the language installer (rust/python/java) never receives credentials', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/periphery/adapters/http/services/PreviewService/managers/DependencyInstaller.ts'),
      'utf8',
    );
    expect(src).not.toContain('composeChildEnv(credentialEnv)');
  });
});

describe('detectPackageManager — lockfile based', () => {
  const withTempDir = (files: string[], assert: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-'));
    try {
      for (const f of files) fs.writeFileSync(path.join(dir, f), '');
      assert(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('detects pnpm from pnpm-lock.yaml', () => {
    withTempDir(['pnpm-lock.yaml'], (dir) => expect(detectPackageManager(dir)).toBe('pnpm'));
  });

  it('detects yarn from yarn.lock', () => {
    withTempDir(['yarn.lock'], (dir) => expect(detectPackageManager(dir)).toBe('yarn'));
  });

  it('falls back to npm when no lockfile is present', () => {
    withTempDir([], (dir) => expect(detectPackageManager(dir)).toBe('npm'));
  });

  it('prefers pnpm over yarn when both lockfiles exist', () => {
    withTempDir(['pnpm-lock.yaml', 'yarn.lock'], (dir) => expect(detectPackageManager(dir)).toBe('pnpm'));
  });
});

/**
 * Regression guard: both install call sites must route through the shared helper.
 * If either reintroduces an inline `pnpm install` / `yarn install` without the
 * force-dev flag, the pnpm/yarn devDependencies gap returns (preview crash +
 * deploy build failure).
 */
describe('no inline package-manager install branches remain in call sites', () => {
  const root = path.resolve(__dirname, '../../src');

  const callSites = [
    path.join(root, 'periphery/adapters/http/services/PreviewService/managers/DependencyInstaller.ts'),
    path.join(root, 'infrastructure/deploy/BuildRunner.ts'),
  ];

  it('both DependencyInstaller and BuildRunner import buildInstallCommand', () => {
    for (const file of callSites) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).toContain('buildInstallCommand');
    }
  });

  it('neither call site builds a bare pnpm/yarn install command inline', () => {
    for (const file of callSites) {
      const src = fs.readFileSync(file, 'utf8');
      // The literal command tokens used by the old inline branches.
      expect(src).not.toMatch(/command\s*=\s*'pnpm'/);
      expect(src).not.toMatch(/command\s*=\s*'yarn'/);
    }
  });
});
