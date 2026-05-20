/**
 * Phase 6 — shared phase-emitter factory.
 *
 * Locks the dedup + publish + (optional) throttle contract that both
 * `createIdePhaseEmitter` and `createProjectDeletionPhaseEmitter` share.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPhaseEmitter } from '../../src/core/realtime/createPhaseEmitter';
import { createProjectDeletionPhaseEmitter } from '../../src/periphery/adapters/http/services/ProjectService/projectDeletionPhaseEmitter';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { UserContext } from '../../src/core/types/user';

function makeFakeStateStore(): StateStorePort & { publishes: Array<{ channel: string; msg: any }> } {
  const publishes: Array<{ channel: string; msg: any }> = [];
  return {
    publishes,
    publish: vi.fn(async (channel: string, msg: any) => {
      publishes.push({ channel, msg });
    }),
  } as unknown as StateStorePort & { publishes: Array<{ channel: string; msg: any }> };
}

const ctx: UserContext = { userId: 'u1', organizationId: 'o1', email: 'u@example.com' } as any;

describe('createPhaseEmitter — shared SSOT', () => {
  it('publishes one event per (phase, status) and dedups consecutive duplicates', async () => {
    const ss = makeFakeStateStore();
    const emitter = createPhaseEmitter<'a' | 'b', 'active' | 'complete', 'projectDeletionPhase'>(
      ss,
      { userContext: ctx, sessionKey: 'sess-1', startedAt: 0 },
      {
        messageType: 'projectDeletionPhase',
        buildData: ({ phase, status, sessionKey, elapsedMs }) => ({
          phase: phase as any,
          status,
          projectId: 'p',
          sessionKey,
          elapsedMs,
        }),
        now: () => 100,
      },
    );

    await emitter.emit('a', 'active');
    await emitter.emit('a', 'active'); // dedup — same (phase, status)
    await emitter.emit('a', 'complete'); // distinct status — publishes
    await emitter.emit('b', 'active'); // distinct phase — publishes
    await emitter.emit('b', 'active'); // dedup again

    expect(ss.publishes).toHaveLength(3);
    expect(ss.publishes.map((p) => p.msg.data.status)).toEqual(['active', 'complete', 'active']);
  });

  it('respects throttle for repeated (phase, status) when configured', async () => {
    const ss = makeFakeStateStore();
    let now = 0;
    const emitter = createPhaseEmitter<'tick', 'active', 'idePhase'>(
      ss,
      { userContext: ctx, sessionKey: 'k', startedAt: 0 },
      {
        messageType: 'idePhase',
        buildData: ({ phase, sessionKey, elapsedMs }) => ({
          phase: phase as any,
          projectId: 'p',
          featureName: 'f',
          sessionKey,
          elapsedMs,
        }),
        throttle: () => 5000,
        now: () => now,
      },
    );

    await emitter.emit('tick', 'active'); // publishes (first emit)
    now = 1000;
    await emitter.emit('tick', 'active'); // throttled
    now = 6000;
    await emitter.emit('tick', 'active'); // throttle window passed — publishes

    expect(ss.publishes).toHaveLength(2);
    expect(ss.publishes.map((p) => p.msg.data.elapsedMs)).toEqual([0, 6000]);
  });

  it('swallows publish errors so a missed event never blocks the cascade', async () => {
    const ss = makeFakeStateStore();
    ss.publish = vi.fn(async () => {
      throw new Error('redis down');
    });
    const emitter = createPhaseEmitter<'a', 'active', 'projectDeletionPhase'>(
      ss,
      { userContext: ctx, sessionKey: 'k', startedAt: 0 },
      {
        messageType: 'projectDeletionPhase',
        buildData: ({ phase, status, sessionKey, elapsedMs }) => ({
          phase: phase as any,
          status,
          projectId: 'p',
          sessionKey,
          elapsedMs,
        }),
      },
    );

    await expect(emitter.emit('a', 'active')).resolves.toBeUndefined();
  });
});

describe('createProjectDeletionPhaseEmitter — sessionKey = projectId', () => {
  it('publishes on the user-scoped broadcast channel with sessionKey = projectId', async () => {
    const ss = makeFakeStateStore();
    const emitter = createProjectDeletionPhaseEmitter(ss, ctx, 'my-project', 0, () => 250);

    await emitter.emit('cancelJobs', 'active');

    expect(ss.publishes).toHaveLength(1);
    const evt = ss.publishes[0];
    expect(evt.channel).toMatch(/o1/); // user-scoped channel name contains org
    expect(evt.msg.type).toBe('projectDeletionPhase');
    expect(evt.msg.data).toMatchObject({
      phase: 'cancelJobs',
      status: 'active',
      projectId: 'my-project',
      sessionKey: 'my-project',
      elapsedMs: 250,
    });
  });
});
