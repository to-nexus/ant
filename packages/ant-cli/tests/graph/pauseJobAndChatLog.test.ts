/**
 * Phase 13 — pauseJob entry-level NX lock + chat.jsonl multi-pod
 * append-lock contention.
 *
 * 두 가지 chat-SSOT §C.5 / §C.7 회귀 가드를 한 곳에서 잠근다:
 *
 *  1. `pauseJob(deps, args)` 가 `ant:job-pause:{jobId}` SET-NX 락을 한 번
 *     획득한 뒤 `cleanupJobState` + `updateJobStatus('paused')` 를 호출한다.
 *     같은 jobId 로 두 번째 호출하면 락 획득에 실패하고 cleanup 도 두
 *     번 돌지 않는다 (concurrent pause source — StaleJobRecovery,
 *     BullMQ stalled handler, ServerLifecycleManager — 가 동시 fire 해도
 *     duplicate cancelled card 가 emit 되지 않는 invariant).
 *
 *  2. `FileSessionAdapter#appendLine('chat', ...)` 는 cross-pod
 *     `ChatLogLockProvider` 가 등록되어 있으면 해당 락을 hold 하는 동안
 *     순차적으로만 fs.appendFile 을 수행한다. 동시에 4KB+ 라인을 두 번
 *     append 하더라도 인터리빙된 line 이 chat.jsonl 에 남아선 안 된다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
  FileSessionAdapter,
  setChatLogLockProvider,
  type ChatLogLockProvider,
} from '../../src/periphery/adapters/session/FileSessionAdapter';
import type { ChatLine } from '@ant/shared';

// ─────────────────────────────────────────────────────────────────────
// pauseJob — InfrastructureFactory mock + scenario tests.
// ─────────────────────────────────────────────────────────────────────

interface FakeStateStoreShape {
  acquireLock: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
  updateJobStatus: ReturnType<typeof vi.fn>;
}

let pauseStateStore: FakeStateStoreShape;

vi.mock('../../src/infrastructure/adapters/InfrastructureFactory', () => ({
  getInfrastructureFactory: () => ({
    getStateStore: () => pauseStateStore,
  }),
}));

// Lazy import — must come AFTER vi.mock.
const pauseJobMod = await import('../../src/periphery/adapters/http/express/lifecycle/pauseJob');
const { pauseJob } = pauseJobMod;

describe('pauseJob — entry-level NX lock', () => {
  let cleanupSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pauseStateStore = {
      acquireLock: vi.fn().mockResolvedValue(true),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
    };
    cleanupSpy = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('acquires ant:job-pause:{jobId} with 120s TTL and runs cleanupJobState + updateJobStatus on success', async () => {
    await pauseJob(
      { cleanupJobState: cleanupSpy as any },
      {
        jobId: 'job-A',
        projectId: 'proj',
        featureName: 'feat-a',
        jobType: 'code',
        interruption: {
          reason: 'server_shutdown',
          message: 'graceful',
          canResume: true,
          timestamp: '2026-04-25T00:00:00Z',
        } as any,
      },
    );

    expect(pauseStateStore.acquireLock).toHaveBeenCalledWith('ant:job-pause:job-A', 120);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(pauseStateStore.updateJobStatus).toHaveBeenCalledWith(
      'job-A',
      expect.objectContaining({ status: 'paused', error: 'graceful' }),
    );
  });

  it('returns early without running cleanup when the NX lock is already held by a concurrent pause source', async () => {
    pauseStateStore.acquireLock.mockResolvedValueOnce(false);

    await pauseJob(
      { cleanupJobState: cleanupSpy as any },
      {
        jobId: 'job-B',
        projectId: 'proj',
        featureName: 'feat-a',
        jobType: 'code',
        interruption: {
          reason: 'worker_stalled',
          message: 'stalled',
          canResume: true,
          timestamp: '2026-04-25T00:00:00Z',
        } as any,
      },
    );

    expect(pauseStateStore.acquireLock).toHaveBeenCalledTimes(1);
    expect(cleanupSpy).not.toHaveBeenCalled();
    expect(pauseStateStore.updateJobStatus).not.toHaveBeenCalled();
  });

  it('back-to-back calls for the SAME jobId in the same factory state run cleanup exactly once', async () => {
    // First call wins; second call sees the lock as already held.
    let held = false;
    pauseStateStore.acquireLock.mockImplementation(async () => {
      if (held) return false;
      held = true;
      return true;
    });

    const args = {
      jobId: 'job-C',
      projectId: 'proj',
      featureName: 'feat-a',
      jobType: 'code' as const,
      interruption: {
        reason: 'recursion_limit',
        message: 'too deep',
        canResume: true,
        timestamp: '2026-04-25T00:00:00Z',
      } as any,
    };

    await Promise.all([
      pauseJob({ cleanupJobState: cleanupSpy as any }, args),
      pauseJob({ cleanupJobState: cleanupSpy as any }, args),
    ]);

    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect(pauseStateStore.updateJobStatus).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// chat.jsonl multi-pod append lock — ChatLogLockProvider contention.
// ─────────────────────────────────────────────────────────────────────

/**
 * In-memory lock provider that simulates a Redis-backed cross-pod lock.
 * Tracks the held-by id so we can assert holders never overlap.
 */
class FakeChatLogLockProvider implements ChatLogLockProvider {
  private held: { key: string; holder: string } | null = null;
  private nextHolderId = 0;
  /** Per-key mutex queue; resolves the next acquireLock when current is released. */
  private queues = new Map<string, Array<() => void>>();
  /** Holder timing — used to assert serialised execution. */
  history: Array<{ key: string; holder: string; phase: 'acquire' | 'release'; ts: number }> = [];

  async acquireLock(key: string, _ttlSeconds: number): Promise<boolean> {
    // SET-NX style — return false if already held.
    if (this.held?.key === key) return false;
    this.held = { key, holder: `h-${this.nextHolderId++}` };
    this.history.push({ key, holder: this.held.holder, phase: 'acquire', ts: Date.now() });
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    if (this.held?.key === key) {
      this.history.push({ key, holder: this.held.holder, phase: 'release', ts: Date.now() });
      this.held = null;
      const queue = this.queues.get(key);
      const next = queue?.shift();
      if (next) next();
    }
  }
}

describe('FileSessionAdapter chat.jsonl — cross-pod append lock', () => {
  let tmpRoot: string;
  let featurePath: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-chatlog-lock-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
    setChatLogLockProvider(null);
  });

  afterEach(async () => {
    setChatLogLockProvider(null);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('serialises concurrent appendLine calls so 4KB+ lines never interleave', async () => {
    const provider = new FakeChatLogLockProvider();
    setChatLogLockProvider(provider);

    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');

    // Build ~5KB lines so a node fs.appendFile that bypassed the lock
    // would have a real chance to interleave on most filesystems.
    const big = (label: string) => 'X'.repeat(5000) + label;

    const lineA: ChatLine = {
      type: 'assistant_message',
      ts: '2026-04-25T00:00:01.000Z',
      jobId: 'j-A',
      turnId: 't-A',
      jobType: 'code',
      text: big('-A'),
    } as ChatLine;
    const lineB: ChatLine = {
      type: 'assistant_message',
      ts: '2026-04-25T00:00:02.000Z',
      jobId: 'j-B',
      turnId: 't-B',
      jobType: 'code',
      text: big('-B'),
    } as ChatLine;
    const lineC: ChatLine = {
      type: 'assistant_message',
      ts: '2026-04-25T00:00:03.000Z',
      jobId: 'j-C',
      turnId: 't-C',
      jobType: 'code',
      text: big('-C'),
    } as ChatLine;

    // Fire the three appends concurrently.
    await Promise.all([
      adapter.appendLine('chat', lineA),
      adapter.appendLine('chat', lineB),
      adapter.appendLine('chat', lineC),
    ]);

    const chatJsonl = path.join(featurePath, 'sessions', 'chat.jsonl');
    const raw = await fs.readFile(chatJsonl, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.length > 0);

    // 3 lines, all parseable JSON, no truncation / interleave.
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // The lock provider must have observed three serialized acquire/release
    // pairs against the same key (no overlap).
    const acquires = provider.history.filter((h) => h.phase === 'acquire');
    expect(acquires).toHaveLength(3);
    expect(acquires.every((a) => a.key === 'ant:chatlog:proj:feat-a:chat')).toBe(true);

    // Order: every acquire must be followed by its matching release before the next acquire.
    let pendingHolder: string | null = null;
    for (const h of provider.history) {
      if (h.phase === 'acquire') {
        expect(pendingHolder).toBeNull();
        pendingHolder = h.holder;
      } else {
        expect(pendingHolder).toBe(h.holder);
        pendingHolder = null;
      }
    }
  });

  it('falls back to the in-process FileMutex when no ChatLogLockProvider is registered', async () => {
    setChatLogLockProvider(null);
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');

    const lines = Array.from({ length: 10 }).map((_, i) => ({
      type: 'assistant_message' as const,
      ts: `2026-04-25T00:00:${String(i).padStart(2, '0')}.000Z`,
      jobId: `j-${i}`,
      turnId: `t-${i}`,
      jobType: 'code' as const,
      text: 'small line ' + i,
    }) as ChatLine);

    await Promise.all(lines.map((l) => adapter.appendLine('chat', l)));

    const chatJsonl = path.join(featurePath, 'sessions', 'chat.jsonl');
    const raw = await fs.readFile(chatJsonl, 'utf-8');
    const written = raw.split('\n').filter((l) => l.length > 0);
    expect(written).toHaveLength(10);
    for (const line of written) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
