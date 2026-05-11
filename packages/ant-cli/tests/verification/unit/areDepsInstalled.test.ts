/**
 * F3 — `areDepsInstalled` observation.
 *
 * Replaces the legacy `deriveInstallDecision` tests. The new SSOT is the
 * codebase itself: declared deps in `package.json` must resolve under
 * `node_modules/<name>/`. No hash cache, no persisted file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { areDepsInstalled } from '../../../src/agents/common/tool/handlers/invalidationScope';

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers — build a disposable {feature}/codebase/ tree with a
// specific package.json + node_modules layout.
// ────────────────────────────────────────────────────────────────────────────

type InstalledEntry = string | { name: string; version: string };

async function seedInstalledModules(dir: string, modules: InstalledEntry[]): Promise<void> {
  const nm = path.join(dir, 'node_modules');
  await fs.promises.mkdir(nm, { recursive: true });
  for (const entry of modules) {
    const name = typeof entry === 'string' ? entry : entry.name;
    const version = typeof entry === 'string' ? undefined : entry.version;
    const parts = name.split('/');
    const modDir = path.join(nm, ...parts);
    await fs.promises.mkdir(modDir, { recursive: true });
    const pkgBody = version ? { name, version } : {};
    await fs.promises.writeFile(
      path.join(modDir, 'package.json'),
      JSON.stringify(pkgBody),
    );
  }
}

async function makeFeatureRoot(layout: {
  pkg?: Record<string, any> | null;
  /**
   * Either a bare name (no version check — installed package.json will be `{}`)
   * or `{ name, version }` to seed an explicit installed version for semver
   * satisfaction tests.
   */
  installedModules?: InstalledEntry[];
  /**
   * Workspace members — each member gets its own `package.json` at
   * `codebase/<dir>/package.json` and optionally its own `node_modules/`
   * (manifest-local install, the pnpm/yarn-classic case). To simulate the
   * hoisted npm-7+ case, leave member.installedModules empty and add the
   * dep to root `installedModules` instead.
   */
  members?: Array<{
    dir: string;
    pkg: Record<string, any>;
    installedModules?: InstalledEntry[];
  }>;
}): Promise<string> {
  const featureRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'ant-deps-test-'),
  );
  const codebase = path.join(featureRoot, 'codebase');
  await fs.promises.mkdir(codebase, { recursive: true });

  if (layout.pkg !== null) {
    await fs.promises.writeFile(
      path.join(codebase, 'package.json'),
      JSON.stringify(layout.pkg ?? {}, null, 2),
    );
  }

  if (layout.installedModules && layout.installedModules.length > 0) {
    await seedInstalledModules(codebase, layout.installedModules);
  }

  if (layout.members) {
    for (const m of layout.members) {
      const memberDir = path.join(codebase, m.dir);
      await fs.promises.mkdir(memberDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(memberDir, 'package.json'),
        JSON.stringify(m.pkg, null, 2),
      );
      if (m.installedModules && m.installedModules.length > 0) {
        await seedInstalledModules(memberDir, m.installedModules);
      }
    }
  }

  return featureRoot;
}

describe('areDepsInstalled', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    while (scratchDirs.length) {
      const dir = scratchDirs.pop()!;
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function root(layout: Parameters<typeof makeFeatureRoot>[0]) {
    const r = await makeFeatureRoot(layout);
    scratchDirs.push(r);
    return r;
  }

  it('returns true when every declared dep resolves under node_modules', async () => {
    const r = await root({
      pkg: {
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^2.0.0' },
      },
      installedModules: ['react', 'vitest'],
    });
    expect(await areDepsInstalled(r)).toBe(true);
  });

  it('returns false when any declared dep is missing from node_modules', async () => {
    const r = await root({
      pkg: {
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^2.0.0', jsdom: '^25.0.0' },
      },
      installedModules: ['react', 'vitest'], // jsdom missing
    });
    expect(await areDepsInstalled(r)).toBe(false);
  });

  it('returns false when node_modules is absent entirely but deps are declared', async () => {
    const r = await root({
      pkg: { dependencies: { react: '^19.0.0' } },
      installedModules: [],
    });
    expect(await areDepsInstalled(r)).toBe(false);
  });

  it('handles scoped packages (`@scope/name`)', async () => {
    const r = await root({
      pkg: {
        dependencies: { '@testing-library/react': '^16.0.0' },
      },
      installedModules: ['@testing-library/react'],
    });
    expect(await areDepsInstalled(r)).toBe(true);
  });

  it('ignores peerDependencies and optionalDependencies', async () => {
    const r = await root({
      pkg: {
        dependencies: { react: '^19.0.0' },
        peerDependencies: { 'some-host': '*' },        // must not count
        optionalDependencies: { fsevents: '*' },       // must not count
      },
      installedModules: ['react'],
    });
    expect(await areDepsInstalled(r)).toBe(true);
  });

  it('returns true when package.json has no dependencies/devDependencies fields', async () => {
    const r = await root({
      pkg: { name: 'foo', version: '1.0.0' },
      installedModules: [],
    });
    expect(await areDepsInstalled(r)).toBe(true);
  });

  it('returns null when package.json is absent (not a JS project)', async () => {
    const r = await root({ pkg: null, installedModules: [] });
    expect(await areDepsInstalled(r)).toBeNull();
  });

  it('returns null when package.json is malformed', async () => {
    const r = await root({ pkg: {}, installedModules: [] });
    // overwrite with junk
    const pkgPath = path.join(r, 'codebase', 'package.json');
    await fs.promises.writeFile(pkgPath, '{not-json');
    expect(await areDepsInstalled(r)).toBeNull();
  });

  it('pnpm-style symlinks still resolve (fs.stat follows symlinks)', async () => {
    const r = await root({
      pkg: { dependencies: { react: '^19.0.0' } },
      installedModules: [],
    });
    const codebase = path.join(r, 'codebase');
    const actual = path.join(codebase, 'node_modules', '.pnpm', 'react@19', 'node_modules', 'react');
    await fs.promises.mkdir(actual, { recursive: true });
    const linkParent = path.join(codebase, 'node_modules');
    const link = path.join(linkParent, 'react');
    await fs.promises.symlink(actual, link, 'dir');
    expect(await areDepsInstalled(r)).toBe(true);
  });

  describe('semver version match (slim-burning-melon regression)', () => {
    it('returns false when installed version does not satisfy the declared range', async () => {
      const r = await root({
        pkg: { devDependencies: { jsdom: '^24.1.3' } },
        installedModules: [{ name: 'jsdom', version: '29.0.2' }],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });

    it('returns true when installed version satisfies the declared range', async () => {
      const r = await root({
        pkg: { devDependencies: { jsdom: '^24.1.3' } },
        installedModules: [{ name: 'jsdom', version: '24.1.3' }],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('returns true for exact-version match', async () => {
      const r = await root({
        pkg: { dependencies: { react: '19.0.0' } },
        installedModules: [{ name: 'react', version: '19.0.0' }],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('returns false for exact-version mismatch', async () => {
      const r = await root({
        pkg: { dependencies: { react: '19.0.0' } },
        installedModules: [{ name: 'react', version: '18.3.1' }],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });

    it('returns true when the spec is `*` (any version)', async () => {
      const r = await root({
        pkg: { dependencies: { react: '*' } },
        installedModules: [{ name: 'react', version: '18.3.1' }],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('skips version check for workspace protocol', async () => {
      const r = await root({
        pkg: { dependencies: { '@ant/shared': 'workspace:^' } },
        installedModules: [{ name: '@ant/shared', version: '1.0.0' }],
      });
      // workspace: → existence-only, not range-checked.
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('skips version check for git URLs', async () => {
      const r = await root({
        pkg: { dependencies: { foo: 'git+https://github.com/x/foo.git' } },
        installedModules: [{ name: 'foo', version: '0.0.1' }],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('skips version check for file: protocol', async () => {
      const r = await root({
        pkg: { dependencies: { foo: 'file:../local-foo' } },
        installedModules: [{ name: 'foo', version: '0.0.1' }],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('skips version check for bare npm tags like `latest` / `next`', async () => {
      const r = await root({
        pkg: { dependencies: { foo: 'latest' } },
        installedModules: [{ name: 'foo', version: '0.0.1' }],
      });
      // `latest` is not a valid semver range → existence-only.
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('installed package.json without version field → no version check, existence suffices', async () => {
      const r = await root({
        pkg: { dependencies: { foo: '^1.0.0' } },
        installedModules: ['foo'],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('one dep out of many failing semver → false', async () => {
      const r = await root({
        pkg: {
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
          devDependencies: { jsdom: '^24.1.3' },
        },
        installedModules: [
          { name: 'react', version: '19.1.0' },
          { name: 'react-dom', version: '19.1.0' },
          { name: 'jsdom', version: '29.0.2' }, // ← mismatch
        ],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });
  });

  describe('workspace-aware (ember-dipping-bough regression)', () => {
    // The regression: root pkg.json declared no runtime deps (only workspace
    // scripts), members declared @nexus-cross / firebase / next-intl, those
    // deps never installed — old root-only scan returned true and blocked
    // every recovery `pnpm install` via the install-skip policy.

    it('W1 — root empty, member declares missing dep → false', async () => {
      const r = await root({
        pkg: { name: 'workspace-root', private: true },
        members: [
          {
            dir: 'apps/console',
            pkg: { name: 'console', dependencies: { firebase: '^11.0.0' } },
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });

    it('W2 — member dep installed under member node_modules (pnpm/yarn-classic) → true', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { firebase: '^11.0.0' } },
            installedModules: [{ name: 'firebase', version: '11.2.0' }],
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('W3 — member dep hoisted to root node_modules (npm 7+ workspaces) → true', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        installedModules: [{ name: 'firebase', version: '11.2.0' }],
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { firebase: '^11.0.0' } },
            // no member-local node_modules → must root-fallback
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('W4 — two members declare same lib, only one installed → false', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { 'next-intl': '^3.0.0' } },
            installedModules: [{ name: 'next-intl', version: '3.20.0' }],
          },
          {
            dir: 'apps/hub',
            pkg: { dependencies: { 'next-intl': '^3.0.0' } },
            // hub never installed it
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });

    it('W5 — member dep installed with version outside declared semver range → false', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { firebase: '^11.0.0' } },
            installedModules: [{ name: 'firebase', version: '9.6.0' }],
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });

    it('W6 — peerDependencies / optionalDependencies in members are excluded', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: {
              dependencies: { react: '^19.0.0' },
              peerDependencies: { 'some-host': '*' },
              optionalDependencies: { fsevents: '*' },
            },
            installedModules: [{ name: 'react', version: '19.1.0' }],
            // peer/optional intentionally not installed
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('W7 — scoped package declared in member, installed under member → true', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { '@nexus-cross/design-system': '1.1.0' } },
            installedModules: [
              { name: '@nexus-cross/design-system', version: '1.1.0' },
            ],
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(true);
    });

    it('W8 — scoped package declared in member, missing everywhere → false', async () => {
      const r = await root({
        pkg: { name: 'workspace-root' },
        members: [
          {
            dir: 'apps/console',
            pkg: { dependencies: { '@nexus-cross/design-system': '1.1.0' } },
          },
        ],
      });
      expect(await areDepsInstalled(r)).toBe(false);
    });
  });
});
