/**
 * Canonical feature structure — invariants + SSOT regression.
 *
 * Guards:
 *  1. `ensureCanonicalStructure` fully materializes CANONICAL_FEATURE_DIRS +
 *     CANONICAL_FEATURE_FILE_PATHS on a fresh feature dir.
 *  2. Result { createdDirs, createdFiles } accurately reports reconciliation
 *     counts (non-zero on first call, zero on repeat → idempotent).
 *  3. Partial deletion → re-run of ensure → full recovery + only the deleted
 *     items are reported as created.
 *  4. Ghost-feature guard: when the feature path does not exist,
 *     ensureCanonicalStructure bails silently and writes nothing.
 *  5. DEBUG_SUBDIRS derived projection matches the agent → subdir shape
 *     defined in @ant/shared canonical dirs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CANONICAL_FEATURE_DIRS,
  CANONICAL_FEATURE_FILE_PATHS,
  FIGMA_CONFIG_PATH,
} from '@ant/shared';
import {
  ensureCanonicalStructure,
  DEBUG_SUBDIRS,
} from '../../src/core/utils/sessionPaths';

async function mkTmpFeature(): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-canonical-'));
  const featurePath = path.join(root, 'features', 'feat');
  await fs.promises.mkdir(featurePath, { recursive: true });
  return featurePath;
}

async function cleanup(featurePath: string): Promise<void> {
  try {
    const featuresDir = path.dirname(featurePath);
    const tmpRoot = path.dirname(featuresDir);
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

describe('ensureCanonicalStructure', () => {
  let featurePath: string;

  beforeEach(async () => {
    featurePath = await mkTmpFeature();
  });

  afterEach(async () => {
    await cleanup(featurePath);
  });

  it('materializes every CANONICAL_FEATURE_DIRS entry', async () => {
    const { createdDirs, createdFiles } = await ensureCanonicalStructure(featurePath);

    for (const rel of CANONICAL_FEATURE_DIRS) {
      const abs = path.join(featurePath, rel);
      const stat = await fs.promises.stat(abs);
      expect(stat.isDirectory()).toBe(true);
    }

    expect(createdDirs).toBeGreaterThan(0);
    expect(createdFiles).toBeGreaterThanOrEqual(CANONICAL_FEATURE_FILE_PATHS.length);
  });

  it('materializes every CANONICAL_FEATURE_FILE_PATHS entry (including figma.json)', async () => {
    await ensureCanonicalStructure(featurePath);

    for (const rel of CANONICAL_FEATURE_FILE_PATHS) {
      const abs = path.join(featurePath, rel);
      const stat = await fs.promises.stat(abs);
      expect(stat.isFile()).toBe(true);
    }

    // FIGMA_CONFIG_PATH is included in CANONICAL_FEATURE_FILE_PATHS.
    expect(CANONICAL_FEATURE_FILE_PATHS).toContain(FIGMA_CONFIG_PATH);
  });

  it('creates the three UiSource sibling dirs under visual/ui', async () => {
    await ensureCanonicalStructure(featurePath);

    for (const sibling of ['ant', 'figma', 'handoff'] as const) {
      const abs = path.join(featurePath, 'visual/ui', sibling);
      const stat = await fs.promises.stat(abs);
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('is idempotent — second call reports zero creations', async () => {
    await ensureCanonicalStructure(featurePath);
    const second = await ensureCanonicalStructure(featurePath);

    expect(second.createdDirs).toBe(0);
    expect(second.createdFiles).toBe(0);
  });

  it('recovers partial deletion — only missing entries are re-created', async () => {
    await ensureCanonicalStructure(featurePath);

    // Delete the ant/ subdir and the figma.json file to simulate a
    // partially-corrupt feature (e.g. a user manually removed them).
    await fs.promises.rm(path.join(featurePath, 'visual/ui/ant'), { recursive: true, force: true });
    await fs.promises.rm(path.join(featurePath, FIGMA_CONFIG_PATH), { force: true });

    const { createdDirs, createdFiles } = await ensureCanonicalStructure(featurePath);

    expect(createdDirs).toBeGreaterThanOrEqual(1);
    expect(createdFiles).toBe(1);

    const antStat = await fs.promises.stat(path.join(featurePath, 'visual/ui/ant'));
    expect(antStat.isDirectory()).toBe(true);
    const figmaJsonStat = await fs.promises.stat(path.join(featurePath, FIGMA_CONFIG_PATH));
    expect(figmaJsonStat.isFile()).toBe(true);
  });

  it('bails silently when featurePath does not exist (ghost-feature guard)', async () => {
    const phantom = path.join(featurePath, '..', 'feat-phantom');
    const before = await fs.promises.readdir(path.dirname(phantom));

    const result = await ensureCanonicalStructure(phantom);

    expect(result).toEqual({ createdDirs: 0, createdFiles: 0 });

    const after = await fs.promises.readdir(path.dirname(phantom));
    // Phantom dir never got created as a side-effect.
    expect(after).toEqual(before);
  });
});

describe('DEBUG_SUBDIRS (derived from CANONICAL_FEATURE_DIRS)', () => {
  it('only contains entries that correspond to sessions/<agent>/debug/<subdir> canonical paths', () => {
    const expected: Record<string, string[]> = {};
    for (const dir of CANONICAL_FEATURE_DIRS) {
      const m = dir.match(/^sessions\/([^/]+)\/debug\/([^/]+)$/);
      if (m) {
        const [, agent, sub] = m;
        (expected[agent] ??= []).push(sub);
      }
    }

    // Same key set
    expect(Object.keys(DEBUG_SUBDIRS).sort()).toEqual(Object.keys(expected).sort());

    // Same subdir set per agent
    for (const agent of Object.keys(expected)) {
      expect([...DEBUG_SUBDIRS[agent]].sort()).toEqual(expected[agent].sort());
    }
  });

  it('is non-empty — architect/planner/creator agents each have at least one debug subdir', () => {
    expect(DEBUG_SUBDIRS.architect?.length ?? 0).toBeGreaterThan(0);
    expect(DEBUG_SUBDIRS.planner?.length ?? 0).toBeGreaterThan(0);
    expect(DEBUG_SUBDIRS.creator?.length ?? 0).toBeGreaterThan(0);
  });
});
