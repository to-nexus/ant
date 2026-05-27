/**
 * Codebase presence SSOT — unit guard.
 *
 * Pins the manifest-based definition shared by `WorkspaceState.hasCodebase`
 * and `GitSnapshot.hasCodebase`: a real dependency/build manifest must exist;
 * docs-only / empty folders are NOT a codebase.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { containsCodebaseManifest } from '@ant/shared';
import { detectCodebasePresence } from '../../src/core/codebase/detectCodebasePresence';

describe('containsCodebaseManifest — pure predicate', () => {
  it('false for empty / docs-only entry lists', () => {
    expect(containsCodebaseManifest([])).toBe(false);
    expect(containsCodebaseManifest(['README.md'])).toBe(false);
    expect(containsCodebaseManifest(['README.md', 'notes.txt', 'LICENSE'])).toBe(false);
  });

  it('true for recognized manifests across languages', () => {
    expect(containsCodebaseManifest(['package.json'])).toBe(true);
    expect(containsCodebaseManifest(['go.mod'])).toBe(true);
    expect(containsCodebaseManifest(['Cargo.toml'])).toBe(true);
    expect(containsCodebaseManifest(['pyproject.toml'])).toBe(true);
    expect(containsCodebaseManifest(['pom.xml'])).toBe(true);
    expect(containsCodebaseManifest(['pnpm-workspace.yaml'])).toBe(true);
  });

  it('true for suffix-matched manifests (.csproj / .sln)', () => {
    expect(containsCodebaseManifest(['MyService.csproj'])).toBe(true);
    expect(containsCodebaseManifest(['App.sln', 'README.md'])).toBe(true);
  });
});

describe('detectCodebasePresence — filesystem SSOT', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-presence-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('false when the directory does not exist', () => {
    expect(detectCodebasePresence(path.join(dir, 'missing'))).toBe(false);
  });

  it('false for an empty directory', () => {
    expect(detectCodebasePresence(dir)).toBe(false);
  });

  it('false for docs-only / note-only folders', () => {
    fs.writeFileSync(path.join(dir, 'README.md'), '# hi');
    fs.writeFileSync(path.join(dir, 'random.txt'), 'x');
    expect(detectCodebasePresence(dir)).toBe(false);
  });

  it('ignores dotfiles when deciding presence', () => {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules');
    expect(detectCodebasePresence(dir)).toBe(false);
  });

  it('true when a manifest is present', () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    expect(detectCodebasePresence(dir)).toBe(true);
  });

  it('true for a non-package.json manifest (go.mod)', () => {
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module example');
    expect(detectCodebasePresence(dir)).toBe(true);
  });
});
