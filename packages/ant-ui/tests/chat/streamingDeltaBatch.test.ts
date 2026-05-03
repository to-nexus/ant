/**
 * Streaming-delta RAF batcher — Phase: chat-render-jank-fix Axis 3.
 *
 * Verifies that high-frequency `streaming_delta` events get coalesced
 * into a single `applyStreamingDelta` call per (turnId, workerScope,
 * kind, cardId) per animation frame — and that finalize-style events
 * (snapshot / append / clear) are able to drain the queue synchronously
 * before they themselves mutate state.
 *
 * The batcher is consumed exclusively from `chatSseHandler.ts`; the slice
 * reducer remains synchronous so existing slice-level tests (sseGating)
 * are unaffected.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enqueueStreamingDelta,
  flushStreamingDeltaBatch,
  __setStreamingBatchSyncForTests,
  __resetStreamingBatchForTests,
  __pendingStreamingDeltaCountForTests,
} from '../../src/domain/store/slices/sse/streamingDeltaBatch';

interface ApplyArgs {
  turnId: string;
  workerScope?: string;
  kind: 'text' | 'thinking' | 'card_output';
  cardId?: string;
  chunk: string;
  producedAt: string;
}

interface FakeStore {
  lastChatSnapshotTs?: string;
  applyStreamingDelta: (args: ApplyArgs) => void;
  streamingBuffers: Record<string, unknown>;
  syncVirtualEditorTabsFromBuffers: (buffers: Record<string, unknown>) => void;
  __calls: ApplyArgs[];
}

function makeStore(snapshotTs?: string): FakeStore {
  const calls: ApplyArgs[] = [];
  return {
    lastChatSnapshotTs: snapshotTs,
    applyStreamingDelta: (args) => {
      calls.push(args);
    },
    streamingBuffers: {},
    syncVirtualEditorTabsFromBuffers: () => {},
    __calls: calls,
  };
}

describe('streamingDeltaBatch — RAF coalescing', () => {
  let originalRaf: typeof requestAnimationFrame;
  let originalCancel: typeof cancelAnimationFrame;
  let pending: Array<() => void> = [];

  beforeEach(() => {
    __resetStreamingBatchForTests();
    pending = [];
    originalRaf = globalThis.requestAnimationFrame;
    originalCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = pending.length + 1;
      pending.push(() => cb(performance.now()));
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      // Mark the slot as a no-op so it can't fire after cancellation.
      if (id >= 1 && id <= pending.length) {
        pending[id - 1] = () => {};
      }
    }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    __resetStreamingBatchForTests();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
  });

  function tickRaf() {
    const queue = pending;
    pending = [];
    for (const cb of queue) cb();
  }

  it('coalesces multiple chunks for the same key into one slice call', () => {
    const store = makeStore('2026-04-25T00:00:00.000Z');
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'hello ',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'world',
      producedAt: '2026-04-25T00:00:02.000Z',
    });

    expect(store.__calls).toHaveLength(0);
    expect(__pendingStreamingDeltaCountForTests()).toBe(1);

    tickRaf();

    expect(store.__calls).toHaveLength(1);
    expect(store.__calls[0]).toMatchObject({
      turnId: 't-1',
      kind: 'text',
      chunk: 'hello world',
      producedAt: '2026-04-25T00:00:02.000Z',
    });
  });

  it('keeps separate keys (kind / cardId / scope) on independent batches', () => {
    const store = makeStore();
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'a',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'thinking',
      chunk: 'b',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'card_output',
      cardId: 'card-1',
      chunk: 'c',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'card_output',
      cardId: 'card-2',
      chunk: 'd',
      producedAt: '2026-04-25T00:00:01.000Z',
    });

    tickRaf();

    expect(store.__calls).toHaveLength(4);
    const keyChunks = store.__calls.map((c) => `${c.kind}:${c.cardId ?? ''}:${c.chunk}`);
    expect(keyChunks.sort()).toEqual([
      'card_output:card-1:c',
      'card_output:card-2:d',
      'text::a',
      'thinking::b',
    ]);
  });

  it('drops stale chunks at enqueue time (producedAt < lastChatSnapshotTs)', () => {
    const store = makeStore('2026-04-25T00:00:10.000Z');
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'stale',
      producedAt: '2026-04-25T00:00:05.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'fresh',
      producedAt: '2026-04-25T00:00:11.000Z',
    });

    tickRaf();

    expect(store.__calls).toHaveLength(1);
    expect(store.__calls[0].chunk).toBe('fresh');
  });

  it('flushStreamingDeltaBatch drains pending entries synchronously', () => {
    const store = makeStore();
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'queued',
      producedAt: '2026-04-25T00:00:01.000Z',
    });

    expect(store.__calls).toHaveLength(0);
    flushStreamingDeltaBatch(get);
    expect(store.__calls).toHaveLength(1);
    expect(store.__calls[0].chunk).toBe('queued');

    // RAF tick should now be a no-op — queue empty + cancel scheduled.
    tickRaf();
    expect(store.__calls).toHaveLength(1);
  });

  it('syncs virtual editor tabs after a flush', () => {
    const store = makeStore();
    const syncSpy = vi.fn();
    store.syncVirtualEditorTabsFromBuffers = syncSpy;
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'card_output',
      cardId: 'card-1',
      chunk: 'draft',
      producedAt: '2026-04-25T00:00:01.000Z',
    });

    flushStreamingDeltaBatch(get);

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy).toHaveBeenCalledWith(store.streamingBuffers);
  });

  it('rejects card_output without cardId, ignores empty chunks/turnIds', () => {
    const store = makeStore();
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'card_output',
      chunk: 'orphan',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: '',
      kind: 'text',
      chunk: 'no-turn',
      producedAt: '2026-04-25T00:00:01.000Z',
    });
    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: '',
      producedAt: '2026-04-25T00:00:01.000Z',
    });

    expect(__pendingStreamingDeltaCountForTests()).toBe(0);
    tickRaf();
    expect(store.__calls).toHaveLength(0);
  });
});

describe('streamingDeltaBatch — sync mode for tests', () => {
  beforeEach(() => {
    __resetStreamingBatchForTests();
  });

  afterEach(() => {
    __resetStreamingBatchForTests();
  });

  it('flushes immediately when sync mode is enabled', () => {
    __setStreamingBatchSyncForTests(true);
    const store = makeStore();
    const get = () => store;

    enqueueStreamingDelta(get, {
      turnId: 't-1',
      kind: 'text',
      chunk: 'sync',
      producedAt: '2026-04-25T00:00:01.000Z',
    });

    expect(store.__calls).toHaveLength(1);
    expect(store.__calls[0].chunk).toBe('sync');
  });
});
