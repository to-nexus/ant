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

async function makeFeatureRoot(layout: {
  pkg?: Record<string, any> | null;
  /**
   * Either a bare name (no version check — installed package.json will be `{}`)
   * or `{ name, version }` to seed an explicit installed version for semver
   * satisfaction tests.
   */
  installedModules?: Array<string | { name: string; version: string }>;
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
    const nm = path.join(codebase, 'node_modules');
    await fs.promises.mkdir(nm, { recursive: true });
    for (const entry of layout.installedModules) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const version = typeof entry === 'string' ? undefined : entry.version;
      const parts = name.split('/');
      const dir = path.join(nm, ...parts);
      await fs.promises.mkdir(dir, { recursive: true });
      const pkgBody = version ? { name, version } : {};
      await fs.promises.writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify(pkgBody),
      );
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
});
