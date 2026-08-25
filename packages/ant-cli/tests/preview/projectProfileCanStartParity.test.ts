/**
 * Locks `canStartFromManifests` against the truth table of the deleted
 * `ProjectStructureDetector.quickDetect`.
 *
 * `detect()` cannot answer this question: a script-less Node repo falls through
 * to `singlePackage(root)`, so `packages.length === 1` and `canStart` would flip
 * to true — offering a Start button that immediately fails with
 * `npm error Missing script`. The rules were ported verbatim; this test is what
 * keeps them ported.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectStructureDetector } from '../../src/periphery/adapters/http/services/PreviewService/detectors/ProjectStructureDetector';

let root: string;

function fixture(name: string, files: Record<string, unknown>): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-canstart-'));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Public entry point — null when the directory is not a recognized project. */
const canStart = (dir: string) =>
  ProjectStructureDetector.probeStartability(dir)?.canStart ?? null;

describe('canStart parity with the retired quickDetect', () => {
  it('Node with a dev script → true', () => {
    const dir = fixture('node-dev', { 'package.json': { name: 'a', scripts: { dev: 'vite' } } });
    expect(canStart(dir)).toBe(true);
  });

  it('Node with only start:dev → true (NestJS scaffold)', () => {
    const dir = fixture('node-startdev', {
      'package.json': { name: 'a', scripts: { 'start:dev': 'nest start --watch' } },
    });
    expect(canStart(dir)).toBe(true);
  });

  it('Node WITHOUT any dev-server script → false', () => {
    const dir = fixture('node-nodev', {
      'package.json': { name: 'a', scripts: { build: 'tsc', test: 'vitest' } },
    });
    expect(canStart(dir)).toBe(false);
  });

  it('Node library with no scripts at all → false', () => {
    const dir = fixture('node-noscripts', { 'package.json': { name: 'lib' } });
    expect(canStart(dir)).toBe(false);
  });

  it('workspace root with no own dev script but a runnable member → true', () => {
    const dir = fixture('ws-runnable', {
      'package.json': { name: 'root', private: true, workspaces: ['packages/*'] },
      'packages/app/package.json': { name: 'app', scripts: { dev: 'vite' } },
    });
    expect(canStart(dir)).toBe(true);
  });

  it('workspace root whose members are all script-less → false', () => {
    const dir = fixture('ws-dead', {
      'package.json': { name: 'root', private: true, workspaces: ['packages/*'] },
      'packages/lib/package.json': { name: 'lib', scripts: { build: 'tsup' } },
    });
    expect(canStart(dir)).toBe(false);
  });

  it('malformed package.json → false', () => {
    const dir = fixture('node-broken', { 'package.json': '{ not json' });
    expect(canStart(dir)).toBe(false);
  });

  it.each([
    ['go.mod', { 'go.mod': 'module x\n' }],
    ['go.work', { 'go.work': 'go 1.23\n' }],
    ['Cargo.toml', { 'Cargo.toml': '[package]\nname = "x"\n' }],
    ['requirements.txt', { 'requirements.txt': 'flask\n' }],
    ['pyproject.toml', { 'pyproject.toml': '[project]\nname = "x"\n' }],
    ['setup.py', { 'setup.py': 'from setuptools import setup' }],
    ['pom.xml', { 'pom.xml': '<project/>' }],
    ['build.gradle', { 'build.gradle': 'plugins {}' }],
  ])('%s → true (non-Node ecosystems are assumed startable)', (name, files) => {
    const dir = fixture(`eco-${name.replace(/\W/g, '')}`, files as Record<string, unknown>);
    expect(canStart(dir)).toBe(true);
  });

  it.each([
    ['dev', true],
    ['run', true],
    ['serve', true],
    ['build', false],
  ])('Makefile with a %s target → %s', (target, expected) => {
    const dir = fixture(`make-${target}`, { Makefile: `${target}:\n\techo hi\n` });
    expect(canStart(dir)).toBe(expected);
  });

  it.each([
    ['index.html at the root', { 'index.html': '<h1/>' }],
    ['public/index.html', { 'public/index.html': '<h1/>' }],
    ['a single non-index html at the root', { 'ax-tf-weekly-report.html': '<h1/>' }],
  ])('static site (%s) → true', (label, files) => {
    const dir = fixture(`static-${label.replace(/\W/g, '')}`, files as Record<string, unknown>);
    expect(canStart(dir)).toBe(true);
  });

  it('only a dot-named html → no answer at all (null)', () => {
    const dir = fixture('static-dotonly', { '.secret.html': '<h1/>' });
    expect(canStart(dir)).toBeNull();
  });

  it.each([
    ['package.json with no dev script', { 'package.json': { name: 'a', scripts: { build: 'tsc' } } }],
    ['a Makefile with only build:', { Makefile: 'build:\n\ttrue\n' }],
  ])('an index.html next to %s does NOT rescue it → false', (label, files) => {
    const dir = fixture(`static-noresc-${label.replace(/\W/g, '')}`, {
      ...(files as Record<string, unknown>),
      'index.html': '<h1/>',
    });
    expect(canStart(dir)).toBe(false);
  });

  it('unrecognized directory → no answer at all (null)', () => {
    const dir = fixture('nothing', { 'README.md': '# hi' });
    expect(canStart(dir)).toBeNull();
    expect(ProjectStructureDetector.probeStartability(dir)).toBeNull();
  });
});
