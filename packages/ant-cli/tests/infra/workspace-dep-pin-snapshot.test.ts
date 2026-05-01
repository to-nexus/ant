/**
 * Regression coverage for the workspace dependency-pin snapshot system.
 *
 * Three layers under test:
 *   1. Observation (`scanWorkspaceDepPins` / `renderSnapshotForPrompt`)
 *   2. Detection (`detectPinViolations` / `detectInstallPinViolations` /
 *      `extractInstallVersionTargets`)
 *   3. Enforcement (`enforceManifestPinPolicyForWrite` /
 *      `enforceManifestPinPolicyForInstall`)
 *
 * The test fixture is a temporary feature root with multiple
 * `package.json` manifests laid out to mimic a realistic monorepo
 * (`codebase/package.json` + `codebase/packages/{fe,be}/package.json`).
 * Each test mutates the fixture, runs the helper directly, and asserts
 * the observable output. No graph state, no LangGraph wiring — these
 * are pure module-level helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scanWorkspaceDepPins,
  renderSnapshotForPrompt,
  detectPinViolations,
  detectInstallPinViolations,
  extractInstallVersionTargets,
} from '../../src/agents/common/tool/handlers/workspaceDepPins';
import {
  enforceManifestPinPolicyForWrite,
  enforceManifestPinPolicyForInstall,
} from '../../src/agents/common/tool/handlers/manifestPinPolicy';
import {
  splitOnShellOperators,
  tokenizeShellSegment,
} from '../../src/core/utils/shellParser';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Fixture helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let fixtureRoot: string;

function fixturePath(...parts: string[]): string {
  return path.join(fixtureRoot, ...parts);
}

function writeJson(relPath: string, content: unknown): void {
  const abs = fixturePath(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(content, null, 2), 'utf-8');
}

function writeText(relPath: string, content: string): void {
  const abs = fixturePath(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-deppins-'));
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Layer 1 — observation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('scanWorkspaceDepPins', () => {
  it('returns an empty snapshot when codebase/ does not exist', async () => {
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.pins.size).toBe(0);
    expect(snap.conflicts).toEqual([]);
    expect(snap.manifestPaths).toEqual([]);
  });

  it('aggregates first-seen pins across multiple package.json manifests', async () => {
    writeJson('codebase/package.json', {
      name: 'root',
      dependencies: { react: '^18.3.0' },
    });
    writeJson('codebase/packages/fe/package.json', {
      name: 'fe',
      dependencies: { react: '^18.3.0', 'react-dom': '^18.3.0' },
    });
    writeJson('codebase/packages/be/package.json', {
      name: 'be',
      dependencies: { fastify: '^4.27.0' },
    });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.pins.size).toBe(3);
    expect(snap.pins.get('react')?.declaredSpec).toBe('^18.3.0');
    expect(snap.pins.get('react-dom')?.declaredSpec).toBe('^18.3.0');
    expect(snap.pins.get('fastify')?.declaredSpec).toBe('^4.27.0');
    // first-seen wins; root manifest is enumerated first because
    // directory walk yields files before subdirectories.
    expect(snap.pins.get('react')?.declaredIn[0]).toBe('codebase/package.json');
    expect(snap.conflicts).toEqual([]);
  });

  it('records cross-package conflicts when the same name has different specs', async () => {
    writeJson('codebase/packages/fe/package.json', {
      name: 'fe',
      dependencies: { react: '^18.3.0' },
    });
    writeJson('codebase/packages/be/package.json', {
      name: 'be',
      dependencies: { react: '^19.0.0' },
    });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.conflicts.length).toBe(1);
    expect(snap.conflicts[0].name).toBe('react');
    expect(snap.conflicts[0].pins.length).toBeGreaterThanOrEqual(2);
  });

  it('skips node_modules and other build/cache directories', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    writeJson('codebase/node_modules/react/package.json', { name: 'react', version: '18.3.0' });
    writeJson('codebase/dist/package.json', { dependencies: { react: '^99.0.0' } });
    writeJson('codebase/.next/cache/package.json', { dependencies: { react: '^99.0.0' } });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    // The cache/build manifest specs MUST NOT bleed into the snapshot.
    expect(snap.manifestPaths).toContain('codebase/package.json');
    expect(snap.manifestPaths).not.toContain('codebase/node_modules/react/package.json');
    expect(snap.manifestPaths).not.toContain('codebase/dist/package.json');
    expect(snap.manifestPaths).not.toContain('codebase/.next/cache/package.json');
    expect(snap.pins.get('react')?.declaredSpec).toBe('^18.3.0');
  });

  it('reads resolved version from node_modules/<name>/package.json when present', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    writeJson('codebase/node_modules/react/package.json', { name: 'react', version: '18.3.1' });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.pins.get('react')?.resolvedVersion).toBe('18.3.1');
  });

  it('handles scoped packages (e.g. @types/react) under node_modules', async () => {
    writeJson('codebase/package.json', {
      devDependencies: { '@types/react': '^18.3.0' },
    });
    writeJson('codebase/node_modules/@types/react/package.json', {
      name: '@types/react', version: '18.3.5',
    });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.pins.get('@types/react')?.declaredSpec).toBe('^18.3.0');
    expect(snap.pins.get('@types/react')?.resolvedVersion).toBe('18.3.5');
  });

  it('does NOT flag two `workspace:*` declarations of the same name as a conflict', async () => {
    writeJson('codebase/package.json', { dependencies: { '@org/lib': 'workspace:*' } });
    writeJson('codebase/packages/fe/package.json', {
      dependencies: { '@org/lib': 'workspace:*' },
    });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.conflicts).toEqual([]);
  });

  it('treats malformed package.json as no contribution (no throw)', async () => {
    writeText('codebase/package.json', '{ not valid json');
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(snap.pins.get('react')?.declaredSpec).toBe('^18.3.0');
  });
});

describe('renderSnapshotForPrompt', () => {
  it('returns an empty string when the snapshot has no pins', async () => {
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    expect(renderSnapshotForPrompt(snap)).toBe('');
  });

  it('renders one bullet per pin in alphabetical order', async () => {
    writeJson('codebase/package.json', {
      dependencies: { react: '^18.3.0', '@radix-ui/react-dialog': '^1.0.0' },
    });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const rendered = renderSnapshotForPrompt(snap);
    expect(rendered).toContain('@radix-ui/react-dialog');
    expect(rendered).toContain('react');
    // alphabetical: scoped @ comes before plain
    expect(rendered.indexOf('@radix-ui/react-dialog')).toBeLessThan(rendered.indexOf('`react`'));
  });

  it('surfaces conflicts in a dedicated section', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    writeJson('codebase/packages/be/package.json', { dependencies: { react: '^19.0.0' } });

    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const rendered = renderSnapshotForPrompt(snap);
    expect(rendered).toContain('Existing Conflicts');
    expect(rendered).toContain('^18.3.0');
    expect(rendered).toContain('^19.0.0');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Layer 2 — detection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('detectPinViolations', () => {
  it('passes when the new manifest reuses the pinned spec verbatim', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const violations = detectPinViolations(
      'codebase/packages/be/package.json',
      { react: '^18.3.0' },
      snap,
    );
    expect(violations).toEqual([]);
  });

  it('flags a different spec as a violation', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const violations = detectPinViolations(
      'codebase/packages/be/package.json',
      { react: '^19.0.0' },
      snap,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      name: 'react',
      pinnedSpec: '^18.3.0',
      declaredHere: '^19.0.0',
    });
  });

  it('excludes the manifest itself from its own conflict check', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    // The same manifest re-saving with the SAME spec stays a no-op.
    const violations = detectPinViolations(
      'codebase/packages/fe/package.json',
      { react: '^18.3.0' },
      snap,
    );
    expect(violations).toEqual([]);
  });

  it('ignores non-comparable specs (workspace:, file:, link:, …)', async () => {
    writeJson('codebase/packages/fe/package.json', {
      dependencies: { '@org/lib': 'workspace:*' },
    });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    // Even though specs differ, neither is a comparable version range.
    const violations = detectPinViolations(
      'codebase/packages/be/package.json',
      { '@org/lib': 'workspace:^1.0.0' },
      snap,
    );
    expect(violations).toEqual([]);
  });
});

describe('detectInstallPinViolations', () => {
  it('flags an explicit install spec that conflicts with an existing pin', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const violations = detectInstallPinViolations([{ name: 'react', spec: '^19.0.0' }], snap);
    expect(violations).toHaveLength(1);
    expect(violations[0].pinnedSpec).toBe('^18.3.0');
  });

  it('passes when the install spec matches the pinned spec', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const snap = await scanWorkspaceDepPins(fixtureRoot);
    const violations = detectInstallPinViolations([{ name: 'react', spec: '^18.3.0' }], snap);
    expect(violations).toEqual([]);
  });
});

describe('extractInstallVersionTargets', () => {
  const split = splitOnShellOperators;
  const tokenize = tokenizeShellSegment;

  it('extracts plain name@spec from `pnpm add`', () => {
    const targets = extractInstallVersionTargets('pnpm add react@18.3.0', split, tokenize);
    expect(targets).toEqual([{ name: 'react', spec: '18.3.0' }]);
  });

  it('extracts scoped name@spec', () => {
    const targets = extractInstallVersionTargets(
      'pnpm add @types/react@^18.3.0',
      split,
      tokenize,
    );
    expect(targets).toEqual([{ name: '@types/react', spec: '^18.3.0' }]);
  });

  it('skips flags and bare names', () => {
    const targets = extractInstallVersionTargets(
      'pnpm add foo@1 bar baz@^2 -D --filter=x',
      split,
      tokenize,
    );
    expect(targets).toEqual([
      { name: 'foo', spec: '1' },
      { name: 'baz', spec: '^2' },
    ]);
  });

  it('returns empty when the command has no add verb', () => {
    expect(extractInstallVersionTargets('pnpm install', split, tokenize)).toEqual([]);
    expect(extractInstallVersionTargets('pnpm run build', split, tokenize)).toEqual([]);
    expect(extractInstallVersionTargets('echo react@18', split, tokenize)).toEqual([]);
  });

  it('handles npm install / yarn add interchangeably', () => {
    expect(
      extractInstallVersionTargets('npm install react@18.3.0', split, tokenize),
    ).toEqual([{ name: 'react', spec: '18.3.0' }]);
    expect(
      extractInstallVersionTargets('yarn add react@18.3.0', split, tokenize),
    ).toEqual([{ name: 'react', spec: '18.3.0' }]);
    expect(
      extractInstallVersionTargets('npm i react@18.3.0', split, tokenize),
    ).toEqual([{ name: 'react', spec: '18.3.0' }]);
  });

  it('walks every segment of a chained command', () => {
    const targets = extractInstallVersionTargets(
      'pnpm add react@18 && pnpm add react-dom@18',
      split,
      tokenize,
    );
    expect(targets).toEqual([
      { name: 'react', spec: '18' },
      { name: 'react-dom', spec: '18' },
    ]);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Layer 3 — enforcement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('enforceManifestPinPolicyForWrite', () => {
  it('returns null when the target is not a manifest path', async () => {
    const result = await enforceManifestPinPolicyForWrite(
      'codebase/src/main.ts',
      'console.log("hi");',
      fixtureRoot,
      'codebase/src/main.ts',
    );
    expect(result).toBeNull();
  });

  it('returns null when the snapshot has no pins', async () => {
    const result = await enforceManifestPinPolicyForWrite(
      'codebase/package.json',
      JSON.stringify({ dependencies: { react: '^18.3.0' } }),
      fixtureRoot,
      'codebase/package.json',
    );
    expect(result).toBeNull();
  });

  it('returns a rejection when the new content conflicts with an existing pin', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForWrite(
      'codebase/packages/be/package.json',
      JSON.stringify({ dependencies: { react: '^19.0.0' } }),
      fixtureRoot,
      'codebase/packages/be/package.json',
    );
    expect(result).not.toBeNull();
    expect(result!.display).toContain('react');
    expect(result!.display).toContain('^18.3.0');
    expect(result!.display).toContain('^19.0.0');
  });

  it('passes when the new content reuses the pinned spec verbatim', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForWrite(
      'codebase/packages/be/package.json',
      JSON.stringify({ dependencies: { react: '^18.3.0' } }),
      fixtureRoot,
      'codebase/packages/be/package.json',
    );
    expect(result).toBeNull();
  });

  it('returns null when the new manifest content is malformed (treated as not a write of declared deps)', async () => {
    writeJson('codebase/packages/fe/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForWrite(
      'codebase/packages/be/package.json',
      '{ not valid json',
      fixtureRoot,
      'codebase/packages/be/package.json',
    );
    expect(result).toBeNull();
  });
});

describe('enforceManifestPinPolicyForInstall', () => {
  it('returns null when the command has no add verb', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForInstall('pnpm install', fixtureRoot);
    expect(result).toBeNull();
  });

  it('returns null for bare add (no explicit version)', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForInstall('pnpm add some-other-pkg', fixtureRoot);
    expect(result).toBeNull();
  });

  it('returns a rejection for explicit add that conflicts with a pinned spec', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForInstall(
      'pnpm add react@19.0.0',
      fixtureRoot,
    );
    expect(result).not.toBeNull();
    expect(result!.display).toContain('react');
    expect(result!.display).toContain('^18.3.0');
    expect(result!.display).toContain('19.0.0');
  });

  it('passes when the install spec matches the pinned spec', async () => {
    writeJson('codebase/package.json', { dependencies: { react: '^18.3.0' } });
    const result = await enforceManifestPinPolicyForInstall(
      'pnpm add react@^18.3.0',
      fixtureRoot,
    );
    expect(result).toBeNull();
  });
});
