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
