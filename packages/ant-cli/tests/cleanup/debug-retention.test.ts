/**
 * Phase 5 F3 — `pruneDebugArtifacts` retention SSOT.
 *
 * Locks the 3-source active-job protection (sessions union ∪ Redis
 * active jobs ∪ mtime <1h) plus the age and count cutoffs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pruneDebugArtifacts, DEFAULT_DEBUG_RETENTION } from '../../src/core/utils/debugRetention';
import type { StateStorePort } from '../../src/core/ports/stateStore';

const ARCHITECT_PROMPTS = ['sessions', 'architect', 'debug', 'prompts'];

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'debug-retention-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
});

async function ensureSubdirs(featurePath: string) {
  // sessions/{agent}/debug/{subdir} for every agent — minimal subset is enough
  const dirs = [
    path.join(featurePath, 'sessions', 'architect', 'debug', 'prompts'),
    path.join(featurePath, 'sessions', 'architect', 'debug', 'plans'),
    path.join(featurePath, 'sessions', 'architect', 'debug', 'logs'),
    path.join(featurePath, 'sessions', 'architect', 'debug', 'tokens'),
    path.join(featurePath, 'sessions', 'architect', 'debug', 'figma'),
    path.join(featurePath, 'sessions', 'planner', 'debug', 'prompts'),
    path.join(featurePath, 'sessions', 'creator', 'debug', 'prompts'),
  ];
  for (const d of dirs) await fs.promises.mkdir(d, { recursive: true });
}

async function writeFileAt(featurePath: string, sub: string[], name: string, mtimeMs: number) {
  const full = path.join(featurePath, ...sub, name);
  await fs.promises.writeFile(full, 'x');
  await fs.promises.utimes(full, mtimeMs / 1000, mtimeMs / 1000);
  return full;
}

describe('pruneDebugArtifacts', () => {
  it('removes files older than maxAgeDays and keeps recent ones', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);

    const now = Date.now();
    const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
    const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
    // jobIds chosen so they don't match any active session/Redis source;
    // mtime 5d-old also clears the mtime <1h conservative gate.
    const oldFile = await writeFileAt(featurePath, ARCHITECT_PROMPTS, 'prompt-aaaaaaaa-1111-2222-3333-444444444444.md', now - FIFTEEN_DAYS);
    const recentFile = await writeFileAt(featurePath, ARCHITECT_PROMPTS, 'prompt-bbbbbbbb-1111-2222-3333-444444444444.md', now - FIVE_DAYS);

    const stats = await pruneDebugArtifacts(featurePath, { nowMs: now });

    expect(stats.removed).toBeGreaterThanOrEqual(1);
    await expect(fs.promises.access(oldFile)).rejects.toThrow();
    await fs.promises.access(recentFile); // still exists
  });

  it('caps directory at maxFilesPerSubdir (mtime desc)', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    const now = Date.now();
    const policy = { ...DEFAULT_DEBUG_RETENTION, maxFilesPerSubdir: 3 };

    // 5 files, ascending mtime (oldest=1d, newest=now). All are >1h old so
    // the conservative recency guard does not over-protect.
    const HOUR = 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      await writeFileAt(
        featurePath,
        ARCHITECT_PROMPTS,
        `prompt-cccccccc-1111-2222-3333-${String(i).padStart(12, '0')}.md`,
        now - (5 - i) * (HOUR + 60_000),
      );
    }

    await pruneDebugArtifacts(featurePath, { nowMs: now, policy });
    const remaining = await fs.promises.readdir(path.join(featurePath, ...ARCHITECT_PROMPTS));
    expect(remaining.length).toBe(3);
  });

  it('protects files whose jobId matches a session.json state.jobId', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    const now = Date.now();

    const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
    const activeJobId = 'aaccdd11-1111-2222-3333-444444444444';
    const oldButActive = await writeFileAt(
      featurePath,
      ARCHITECT_PROMPTS,
      `prompt-${activeJobId}.md`,
      now - FIFTEEN_DAYS,
    );

    // Write architect/code.json with state.jobId = activeJobId
    const sessionFile = path.join(featurePath, 'sessions', 'architect', 'code.json');
    await fs.promises.writeFile(sessionFile, JSON.stringify({ state: { jobId: activeJobId } }));

    const stats = await pruneDebugArtifacts(featurePath, { nowMs: now });
    expect(stats.protectedActive).toBeGreaterThanOrEqual(1);
    await fs.promises.access(oldButActive); // still here
  });

  it('protects files whose jobId is in stateStore.listJobsByFeature with active status', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    const now = Date.now();
    const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
    const redisActive = 'eedd5011-1111-2222-3333-444444444444';
    const oldFile = await writeFileAt(
      featurePath,
      ARCHITECT_PROMPTS,
      `prompt-${redisActive}.md`,
      now - FIFTEEN_DAYS,
    );

    const stateStore: Partial<StateStorePort> = {
      async listJobsByFeature() {
        return [{ jobId: redisActive, status: 'running', projectId: 'p', featureName: 'f', type: 'code' as any }];
      },
    };

    await pruneDebugArtifacts(featurePath, {
      nowMs: now,
      stateStore: stateStore as StateStorePort,
      context: { projectId: 'p', featureName: 'f' },
    });
    await fs.promises.access(oldFile); // protected by Redis source
  });

  it('protects files with mtime < 1h regardless of jobId match', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    const now = Date.now();
    const HALF_HOUR = 30 * 60 * 1000;

    // Oversize the dir but keep all entries within the 1h window — count
    // cutoff alone should NOT evict them (recency guard wins).
    const policy = { ...DEFAULT_DEBUG_RETENTION, maxFilesPerSubdir: 1 };
    for (let i = 0; i < 3; i++) {
      await writeFileAt(
        featurePath,
        ARCHITECT_PROMPTS,
        `prompt-recent00-1111-2222-3333-${String(i).padStart(12, '0')}.md`,
        now - HALF_HOUR,
      );
    }

    const stats = await pruneDebugArtifacts(featurePath, { nowMs: now, policy });
    expect(stats.removed).toBe(0);
    expect(stats.kept).toBe(3);
  });

  it('handles missing dirs gracefully', async () => {
    const stats = await pruneDebugArtifacts(path.join(tmpRoot, 'missing'));
    expect(stats).toEqual({ removed: 0, kept: 0, protectedActive: 0 });
  });
});
