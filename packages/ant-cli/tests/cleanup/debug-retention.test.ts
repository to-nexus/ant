/**
 * Phase 5 F3 — `pruneDebugArtifacts` retention SSOT.
 *
 * Locks the 3-source active-job protection (sessions union ∪ Redis
 * active jobs ∪ mtime <1h) plus the age and count cutoffs.
 *
 * Also the OVER-BUDGET path, which had no coverage: an oversized session made
 * the protection set indeterminate, so the sweep fail-closed on that whole
 * feature — correctly, but forever, because nothing repaired the file. The
 * sweep is the only thing that notices, so it is the thing that repairs.
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

describe('pruneDebugArtifacts — over-budget session recovery', () => {
  const SESSION_MAX_BYTES = 8 * 1024 * 1024;
  const sessionPath = (featurePath: string) =>
    path.join(featurePath, 'sessions', 'architect', 'code.json');

  /** A session whose bulk is shed-eligible history, plus a resume core. */
  async function writeOversizedSession(featurePath: string) {
    await fs.promises.mkdir(path.dirname(sessionPath(featurePath)), { recursive: true });
    const filler = 'x'.repeat(200_000);
    const session = {
      sessionId: 's1',
      project: 'p1',
      feature: 'f1',
      runs: Array.from({ length: 60 }, (_, i) => ({
        jobId: `job-${i}`,
        status: 'completed',
        kanbanSnapshot: { todo: [], inProgress: [], completed: [], filler },
      })),
      state: { jobId: 'live-job', taskQueue: [{ id: 't1' }], completedTasks: ['done-1'] },
      artifacts: {},
    };
    await fs.promises.writeFile(sessionPath(featurePath), JSON.stringify(session));
    const { size } = await fs.promises.stat(sessionPath(featurePath));
    expect(size).toBeGreaterThan(SESSION_MAX_BYTES);
  }

  it('sheds an over-budget session back under the budget instead of leaving it bricked', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    await writeOversizedSession(featurePath);

    await pruneDebugArtifacts(featurePath, { nowMs: Date.now() });

    const { size } = await fs.promises.stat(sessionPath(featurePath));
    expect(size).toBeLessThanOrEqual(SESSION_MAX_BYTES);
  });

  it('never sheds the resume core while repairing', async () => {
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    await writeOversizedSession(featurePath);

    await pruneDebugArtifacts(featurePath, { nowMs: Date.now() });

    const repaired = JSON.parse(await fs.promises.readFile(sessionPath(featurePath), 'utf-8'));
    expect(repaired.state.jobId).toBe('live-job');
    expect(repaired.state.taskQueue).toHaveLength(1);
    expect(repaired.state.completedTasks).toEqual(['done-1']);
  });

  it('still fail-closes the prune on the tick that found the oversized file', async () => {
    // Repair and protection are separate concerns: the protection set for THIS
    // tick was incomplete, so deleting anything would risk a live job's own
    // artifacts. The next tick reads the repaired file and prunes normally.
    const featurePath = tmpRoot;
    await ensureSubdirs(featurePath);
    await writeOversizedSession(featurePath);
    const now = Date.now();
    const stale = await writeFileAt(
      featurePath, ARCHITECT_PROMPTS,
      'prompt-cccccccc-1111-2222-3333-444444444444.md', now - 15 * 24 * 60 * 60 * 1000,
    );

    const first = await pruneDebugArtifacts(featurePath, { nowMs: now });
    expect(first.removed).toBe(0);
    await fs.promises.access(stale); // untouched

    const second = await pruneDebugArtifacts(featurePath, { nowMs: now });
    expect(second.removed).toBeGreaterThanOrEqual(1);
  });

  it('leaves a file too large to even read alone (set-aside is the escape hatch)', async () => {
    const featurePath = tmpRoot;
    await fs.promises.mkdir(path.dirname(sessionPath(featurePath)), { recursive: true });
    // Past the repair ceiling (4× the budget): reading it is the very sink the
    // budget exists to close.
    await fs.promises.writeFile(sessionPath(featurePath), 'y'.repeat(SESSION_MAX_BYTES * 4 + 1024));
    await ensureSubdirs(featurePath);

    const stats = await pruneDebugArtifacts(featurePath, { nowMs: Date.now() });
    expect(stats.removed).toBe(0);
    const { size } = await fs.promises.stat(sessionPath(featurePath));
    expect(size).toBeGreaterThan(SESSION_MAX_BYTES * 4);
  });
});
