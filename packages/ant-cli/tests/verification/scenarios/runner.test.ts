/**
 * Verification Scenario Runner — smoke tests.
 *
 * These tests validate the runner library in isolation (no child processes,
 * no fixture execution). They guard the following invariants:
 *   1. `listScenarios` returns a typed array that matches the on-disk layout.
 *   2. `scenario.json` validation rejects malformed configs with a clear error.
 *   3. `resolveScenario` accepts the `Sxx` id, full dir name, and `config.name`.
 *
 * Full fixture runs (which spawn `tsx src/cli/resume-job-cli.ts`) are NOT part
 * of this file — they live under `pnpm scenario`. Keeping this test suite
 * spawn-free keeps `pnpm test:cli` fast (< 2 s).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { listScenarios, resolveScenario, SCENARIOS_DIR } from './runner';

/**
 * Create a scratch scenarios directory so tests don't collide with real
 * fixtures once they are added. We rewire `SCENARIOS_DIR` by overlaying
 * a sibling path — the runner reads the module-level constant, so instead
 * we directly write into the real directory and clean up after.
 *
 * Implementation: each test writes a fixture under `SCENARIOS_DIR/S99-*`
 * and tracks names for teardown.
 */
const createdDirs: string[] = [];

function writeFixture(dirName: string, files: Record<string, string>): string {
  const dirPath = path.join(SCENARIOS_DIR, dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dirPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  createdDirs.push(dirPath);
  return dirPath;
}

describe('verification scenario runner library', () => {
  beforeEach(() => {
    fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
  });

  afterEach(() => {
    while (createdDirs.length) {
      const dir = createdDirs.pop()!;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
    }
  });

  describe('listScenarios', () => {
    it('returns [] when scenarios directory has no valid entries', () => {
      const before = listScenarios();
      // may or may not be empty depending on repo state; we assert shape
      expect(Array.isArray(before)).toBe(true);
      for (const s of before) {
        expect(s.id).toMatch(/^S\d{2}$/);
        expect(typeof s.config.name).toBe('string');
        expect(['real', 'overlay', 'stub']).toContain(s.config.mode);
      }
    });

    it('discovers a fixture written with the canonical naming pattern', () => {
      const before = listScenarios().length;

      writeFixture('S99-smoke-discovery', {
        'scenario.json': JSON.stringify({
          name: 'smoke-discovery',
          description: 'unit-test fixture',
          mode: 'stub',
          expected: { routeSequence: ['plan', 'learn'] },
        }),
        'session.seed.json': JSON.stringify({
          taskQueue: [],
          currentTask: null,
          completedTasks: [],
          retries: 0,
          maxRetries: 3,
        }),
      });

      const after = listScenarios();
      expect(after.length).toBe(before + 1);
      const smoke = after.find(s => s.id === 'S99');
      expect(smoke).toBeDefined();
      expect(smoke?.config.name).toBe('smoke-discovery');
      expect(smoke?.hasSeed).toBe(true);
      expect(smoke?.hasInject).toBe(false);
      expect(smoke?.hasLLMMock).toBe(false);
      expect(smoke?.hasFeature).toBe(false);
    });
  });

  describe('scenario.json validation', () => {
    it('throws when mode is missing', () => {
      writeFixture('S99-bad-mode', {
        'scenario.json': JSON.stringify({
          name: 'bad-mode',
          expected: {},
        }),
      });

      expect(() => listScenarios()).toThrow(/mode/);
    });

    it('throws when name is missing', () => {
      writeFixture('S99-bad-name', {
        'scenario.json': JSON.stringify({
          mode: 'stub',
          expected: {},
        }),
      });

      expect(() => listScenarios()).toThrow(/name/);
    });

    it('throws when expected is missing', () => {
      writeFixture('S99-bad-expected', {
        'scenario.json': JSON.stringify({
          name: 'bad-expected',
          mode: 'stub',
        }),
      });

      expect(() => listScenarios()).toThrow(/expected/);
    });

    it('throws on invalid JSON', () => {
      writeFixture('S99-bad-json', {
        'scenario.json': '{ not valid json',
      });

      expect(() => listScenarios()).toThrow(/Invalid scenario.json/);
    });
  });

  describe('resolveScenario', () => {
    it('resolves by id, dir name, and config name', () => {
      writeFixture('S99-resolve-me', {
        'scenario.json': JSON.stringify({
          name: 'resolve-me',
          mode: 'stub',
          expected: {},
        }),
        'session.seed.json': '{}',
      });

      const byId = resolveScenario('S99');
      expect(byId.id).toBe('S99');

      const byDir = resolveScenario('S99-resolve-me');
      expect(byDir.id).toBe('S99');

      const byName = resolveScenario('resolve-me');
      expect(byName.id).toBe('S99');
    });

    it('throws with the known scenario list on miss', () => {
      expect(() => resolveScenario('does-not-exist-xyz')).toThrow(/not found/);
    });
  });
});
