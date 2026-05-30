/**
 * Phase 7 — feature deletion phase emitter.
 *
 * Mirrors `projectDeletion-phase-emitter.test.ts`. Locks the
 * `sessionKey = ${projectId}:${featureName}` contract + payload shape so
 * the FE can dedup concurrent feature deletions across the same project.
 */

import { describe, it, expect, vi } from 'vitest';
import { createFeatureDeletionPhaseEmitter } from '../../src/periphery/adapters/http/services/ProjectService/featureDeletionPhaseEmitter';
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

describe('createFeatureDeletionPhaseEmitter — sessionKey = projectId:featureName', () => {
  it('publishes on the user-scoped broadcast channel with composite sessionKey', async () => {
    const ss = makeFakeStateStore();
    const emitter = createFeatureDeletionPhaseEmitter(ss, ctx, 'my-project', 'my-feature', 0, () => 500);

    await emitter.emit('cancelJobs', 'active');

    expect(ss.publishes).toHaveLength(1);
    const evt = ss.publishes[0];
    expect(evt.channel).toMatch(/o1/);
    expect(evt.msg.type).toBe('featureDeletionPhase');
    expect(evt.msg.data).toMatchObject({
      phase: 'cancelJobs',
      status: 'active',
      projectId: 'my-project',
      featureName: 'my-feature',
      sessionKey: 'my-project:my-feature',
      elapsedMs: 500,
    });
  });

  it('inherits dedup from createPhaseEmitter (no throttle by default)', async () => {
    const ss = makeFakeStateStore();
    const emitter = createFeatureDeletionPhaseEmitter(ss, ctx, 'p', 'f', 0, () => 1000);

    await emitter.emit('ideCleanup', 'active');
    await emitter.emit('ideCleanup', 'active'); // dedup — same (phase, status)
    await emitter.emit('ideCleanup', 'complete');

    expect(ss.publishes).toHaveLength(2);
    expect(ss.publishes.map((p) => p.msg.data.status)).toEqual(['active', 'complete']);
  });

  it('emits all 5 feature deletion phases in active→complete order', async () => {
    const ss = makeFakeStateStore();
    const emitter = createFeatureDeletionPhaseEmitter(ss, ctx, 'p', 'f', 0, () => 0);

    const phases: ('cancelJobs' | 'ideCleanup' | 'previewCleanup' | 'redisCleanup' | 'fsVerify')[] = [
      'cancelJobs', 'ideCleanup', 'previewCleanup', 'redisCleanup', 'fsVerify',
    ];
    for (const p of phases) {
      await emitter.emit(p, 'active');
      await emitter.emit(p, 'complete');
    }

    expect(ss.publishes).toHaveLength(10);
    expect(ss.publishes.map((p) => `${p.msg.data.phase}:${p.msg.data.status}`)).toEqual([
      'cancelJobs:active', 'cancelJobs:complete',
      'ideCleanup:active', 'ideCleanup:complete',
      'previewCleanup:active', 'previewCleanup:complete',
      'redisCleanup:active', 'redisCleanup:complete',
      'fsVerify:active', 'fsVerify:complete',
    ]);
  });
});
