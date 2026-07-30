/**
 * Post-checkpoint usage must still reach billing (zero-hunting-label follow-up).
 *
 * Usage produced AFTER a learn node's last kanban broadcast had no route to
 * `ledger.settle`: settle prices from the Redis task-queue snapshot, which only
 * `broadcastKanbanUpdate` writes, and the live credit meter's 2s throttle DROPS
 * late ticks rather than deferring them (no trailing timer, and `close()` only
 * awaits already-created promises). Because the ledger's cumulative debit is
 * monotonic, a settle target that is lower than what was already charged is a
 * silent no-op — there is no refund path, so a dropped final tick is permanent.
 *
 * Two halves are locked here:
 *   1. `invokeAndReportUsage` produces usage at all — plain `llm.invoke` returns
 *      `Promise<string>` and never yields any, which is how the tier-2+ turn
 *      digest went 100% unbilled.
 *   2. `flushUsageSnapshot()` meters even inside the throttle window and
 *      re-issues the snapshot, so the charged balance and the settled row agree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeAndReportUsage } from '../../src/core/billing/auxiliaryUsage';

vi.mock('ioredis', () => {
  class MockRedis {
    on() { return this; }
    async set() { return 'OK' as const; }
    async publish() { return 1; }
    async quit() { return 'OK' as const; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

const { KanbanBroadcaster } = await import('../../src/core/realtime/KanbanBroadcaster');

const usage = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  cacheReadTokens: 0,
});

describe('invokeAndReportUsage — usage capture', () => {
  it('reports usage from invokeWithUsage', async () => {
    const onUsage = vi.fn();
    const llm = {
      modelName: 'glm-5.2',
      invoke: vi.fn(async () => 'should not be used'),
      invokeWithUsage: vi.fn(async () => ({ content: 'digest', usage: usage(100, 50) })),
    } as any;

    const out = await invokeAndReportUsage(llm, [{ role: 'user', content: 'x' }], {}, onUsage);

    expect(out).toBe('digest');
    expect(llm.invoke).not.toHaveBeenCalled();
    expect(onUsage).toHaveBeenCalledWith(usage(100, 50));
  });

  it('falls back to invoke when the client cannot report usage, and does not fabricate zero', async () => {
    const onUsage = vi.fn();
    const llm = { modelName: 'm', invoke: vi.fn(async () => 'digest') } as any;

    const out = await invokeAndReportUsage(llm, [{ role: 'user', content: 'x' }], {}, onUsage);

    expect(out).toBe('digest');
    // Absence must read as "unmetered", never as a zero-usage record.
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('a throwing sink never breaks the caller', async () => {
    const llm = {
      modelName: 'm',
      invokeWithUsage: vi.fn(async () => ({ content: 'digest', usage: usage(1, 1) })),
    } as any;
    await expect(
      invokeAndReportUsage(llm, [], {}, () => { throw new Error('sink down'); }),
    ).resolves.toBe('digest');
  });
});

describe('KanbanBroadcaster.flushUsageSnapshot — the final tick is not droppable', () => {
  let ledger: { debitToCumulative: ReturnType<typeof vi.fn> };
  let b: any;

  beforeEach(() => {
    ledger = {
      debitToCumulative: vi.fn(async () => ({ microCredits: 1_000_000 })),
    };
    b = new KanbanBroadcaster({
      redisUrl: 'redis://mock',
      jobId: 'job-1',
      projectId: 'proj-1',
      featureName: 'feat-1',
      jobType: 'code',
      userContext: { userId: 'u1', organizationId: 'org1' } as any,
      creditLedger: ledger as any,
    });
  });

  it('meters inside the 2s throttle window that would drop a normal tick', async () => {
    // First update meters immediately and stamps the throttle.
    b.updateTokenUsageByModel({ 'glm-5.2': usage(1000, 100) });
    expect(ledger.debitToCumulative).toHaveBeenCalledTimes(1);

    // A second update in the same window is dropped — the pre-existing
    // behaviour that made a late summary/digest tick lossy.
    b.updateTokenUsageByModel({ 'glm-5.2': usage(2000, 200) });
    expect(ledger.debitToCumulative).toHaveBeenCalledTimes(1);

    // The flush must get through anyway, carrying the cumulative map.
    await b.flushUsageSnapshot();
    expect(ledger.debitToCumulative).toHaveBeenCalledTimes(2);
    const last = ledger.debitToCumulative.mock.calls[1][0];
    expect(last.jobId).toBe('job-1');
    expect(last.cumulativeUsd).toBeGreaterThan(0);
  });

  it('is a safe no-op before any per-model usage exists', async () => {
    await expect(b.flushUsageSnapshot()).resolves.toBeUndefined();
    expect(ledger.debitToCumulative).not.toHaveBeenCalled();
  });
});
