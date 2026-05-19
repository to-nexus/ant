/**
 * IDE phase emitter — publishes `idePhase` SSE events to the user-scoped
 * Redis broadcast channel with dedup + image-pulling throttle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createIdePhaseEmitter } from '../../src/infrastructure/ide/idePhaseEmitter';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { UserContext } from '../../src/core/types/user';

function makeStateStore(): { stateStore: StateStorePort; published: Array<{ channel: string; message: any }> } {
  const published: Array<{ channel: string; message: any }> = [];
  const stateStore = {
    publish: vi.fn(async (channel: string, message: any) => {
      published.push({ channel, message });
    }),
  } as unknown as StateStorePort;
  return { stateStore, published };
}

const userContext: UserContext = {
  organizationId: 'org',
  userId: 'user',
  email: 'u@example.com',
};

describe('createIdePhaseEmitter', () => {
  let nowVal = 1_000_000;
  const now = () => nowVal;

  beforeEach(() => {
    nowVal = 1_000_000;
  });

  it('emits the first phase + every distinct phase transition', async () => {
    const { stateStore, published } = makeStateStore();
    const emitter = createIdePhaseEmitter(stateStore, userContext, 'proj', 'main', nowVal, now);

    nowVal += 100;
    await emitter.emit('pod-pending');
    nowVal += 500;
    await emitter.emit('image-pulling');
    nowVal += 1_000;
    await emitter.emit('container-ready');
    nowVal += 1_500;
    await emitter.emit('http-ready');

    expect(published.length).toBe(4);
    expect(published.map(p => p.message.data.phase)).toEqual([
      'pod-pending',
      'image-pulling',
      'container-ready',
      'http-ready',
    ]);
    expect(published[0].channel).toBe('realtime:broadcast:org:user');
    expect(published[0].message.type).toBe('idePhase');
    expect(published[0].message.data.sessionKey).toBe('proj:main');
    expect(published[0].message.data.elapsedMs).toBe(100);
    expect(published[3].message.data.elapsedMs).toBe(3_100);
  });

  it('dedups same phase consecutively (except image-pulling)', async () => {
    const { stateStore, published } = makeStateStore();
    const emitter = createIdePhaseEmitter(stateStore, userContext, 'proj', 'main', nowVal, now);

    await emitter.emit('pod-pending');
    nowVal += 1_000;
    await emitter.emit('pod-pending');   // skipped
    nowVal += 1_000;
    await emitter.emit('pod-pending');   // skipped
    nowVal += 1_000;
    await emitter.emit('container-ready'); // emitted (transition)

    expect(published.length).toBe(2);
    expect(published.map(p => p.message.data.phase)).toEqual(['pod-pending', 'container-ready']);
  });

  it('throttles repeated image-pulling to one emit per 5s window', async () => {
    const { stateStore, published } = makeStateStore();
    const emitter = createIdePhaseEmitter(stateStore, userContext, 'proj', 'main', nowVal, now);

    await emitter.emit('image-pulling');    // first emit
    nowVal += 2_000;
    await emitter.emit('image-pulling');    // < 5s, skipped
    nowVal += 2_000;
    await emitter.emit('image-pulling');    // < 5s (4s total), skipped
    nowVal += 2_000;
    await emitter.emit('image-pulling');    // 6s since first → emit
    nowVal += 1_000;
    await emitter.emit('image-pulling');    // 1s since prev → skipped

    expect(published.length).toBe(2);
    expect(published[0].message.data.elapsedMs).toBe(0);
    expect(published[1].message.data.elapsedMs).toBe(6_000);
  });

  it('swallows publish errors without throwing (cosmetic events must not break startup)', async () => {
    const stateStore = {
      publish: vi.fn(async () => { throw new Error('redis offline'); }),
    } as unknown as StateStorePort;
    const emitter = createIdePhaseEmitter(stateStore, userContext, 'proj', 'main', nowVal, now);

    await expect(emitter.emit('pod-pending')).resolves.toBeUndefined();
  });

  it('forwards detail field when provided', async () => {
    const { stateStore, published } = makeStateStore();
    const emitter = createIdePhaseEmitter(stateStore, userContext, 'proj', 'main', nowVal, now);

    await emitter.emit('image-pulling', 'Pulling gitpod/openvscode-server');

    expect(published[0].message.data.detail).toBe('Pulling gitpod/openvscode-server');
  });
});
