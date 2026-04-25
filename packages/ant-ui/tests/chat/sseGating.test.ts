/**
 * SSE timestamp gating — Phase 13 신규 시나리오.
 *
 * `chat_event_appended` 가 `chat_initial_state` 보다 오래된 timestamp 를
 * 가지면 drop 된다 (FE 가 네트워크/SSE 재연결 동안 미러된 이벤트를 다시
 * 받는 경우 중복 fold 를 방지). 이는 master plan §D.4 의 시나리오 7번을
 * 커버한다 — 동일한 gating 룰은 `applyStreamingDelta` 와
 * `replaceStreamingBuffer` 에도 적용되므로 셋 다 한 곳에서 잠근다.
 *
 * sseSlice 의 reducer logic 만 단위로 분리해서 검증한다 (실 SSE 매니저
 * 없이 zustand `set` 시그니처를 직접 호출). chat-SSOT spec 의
 * `lastChatSnapshotTs` semantic 이 지켜지면 통과한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChatLine } from '@ant/shared';
import type {
  BufferKey,
  StreamingBuffer,
} from '../../src/domain/store/selectors/chat';

// SSEManager touches `window` at module init (DEV debug shim) and the API
// client touches `localStorage`. Neither is relevant to the slice reducer
// logic we are exercising — stub both so the import graph resolves.
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    registerHandlerWithId: () => 'fake-id',
    unregisterHandlerById: () => {},
    connect: () => {},
    connectWorkflow: () => {},
    disconnect: () => {},
    disconnectWorkflow: () => {},
  },
}));
vi.mock('@/infrastructure/http/api', () => ({}));
vi.mock('@/infrastructure/http/api/client', () => ({
  API_BASE: '',
  REALTIME_BASE: '',
  getBackendBase: () => '',
  getBackendMode: () => 'local',
}));

import { createSSESlice, type SSESlice } from '../../src/domain/store/slices/sseSlice';

// ─────────────────────────────────────────────────────────────────────
// Lightweight zustand-compatible store harness.
// ─────────────────────────────────────────────────────────────────────

type SliceState = SSESlice;

function createHarness(): { get: () => SliceState; slice: SSESlice } {
  let state: SliceState = {} as SliceState;
  const set = (
    update: SliceState | Partial<SliceState> | ((s: SliceState) => Partial<SliceState> | SliceState),
  ) => {
    if (typeof update === 'function') {
      const patch = update(state);
      state = { ...state, ...patch } as SliceState;
    } else {
      state = { ...state, ...update } as SliceState;
    }
  };
  const get = () => state;
  // Type-erase to satisfy zustand StateCreator contract; we only use the
  // methods directly in tests so `api` is unused.
  const slice = createSSESlice(set as any, get as any, undefined as any);
  state = { ...slice } as SliceState;
  return { get, slice: state };
}

// Minimal ChatLine helpers.
function userTurnLine(turnId: string, ts: string): ChatLine {
  return {
    type: 'user_turn',
    ts,
    jobId: 'j1',
    turnId,
    jobType: 'code',
    text: 'hi',
    sourceRef: `feature.jsonl#${turnId}`,
  } as ChatLine;
}

// ─────────────────────────────────────────────────────────────────────
// Specs
// ─────────────────────────────────────────────────────────────────────

describe('sseSlice — chat_initial_state hydration', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('seeds chatEvents/streamingBuffers/lastChatSnapshotTs together', () => {
    const events: ChatLine[] = [userTurnLine('t-1', '2026-04-25T00:00:01.000Z')];
    const buffers: Record<BufferKey, StreamingBuffer> = {};

    h.slice.replaceChatEvents(events, buffers, '2026-04-25T00:00:02.000Z');
    const s = h.get();

    expect(s.chatEvents).toBe(events);
    expect(s.streamingBuffers).toBe(buffers);
    expect(s.lastChatSnapshotTs).toBe('2026-04-25T00:00:02.000Z');
  });
});

describe('sseSlice — applyStreamingDelta gating', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('drops a delta whose producedAt < lastChatSnapshotTs', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:10.000Z');

    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'stale',
      producedAt: '2026-04-25T00:00:05.000Z',
    });

    expect(Object.keys(h.get().streamingBuffers)).toHaveLength(0);
  });

  it('accepts a delta whose producedAt >= lastChatSnapshotTs', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:10.000Z');

    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'fresh',
      producedAt: '2026-04-25T00:00:15.000Z',
    });

    const buf = h.get().streamingBuffers['t-1:_main_'];
    expect(buf?.text).toBe('fresh');
  });

  it('appends successive text chunks to the same buffer', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:01.000Z');
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'hello ',
      producedAt: '2026-04-25T00:00:02.000Z',
    });
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'world',
      producedAt: '2026-04-25T00:00:03.000Z',
    });

    const buf = h.get().streamingBuffers['t-1:_main_'];
    expect(buf?.text).toBe('hello world');
  });

  it('routes thinking and card_output kinds independently', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:01.000Z');
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'thinking',
      chunk: 'reason',
      producedAt: '2026-04-25T00:00:02.000Z',
    });
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'card_output',
      cardId: 'card-1',
      chunk: 'log',
      producedAt: '2026-04-25T00:00:03.000Z',
    });

    const buf = h.get().streamingBuffers['t-1:_main_'];
    expect(buf?.thinking).toBe('reason');
    expect(buf?.pendingCards?.['card-1']?.streamedOutput).toBe('log');
  });
});

describe('sseSlice — replaceStreamingBuffer gating', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('drops a snapshot whose producedAt < lastChatSnapshotTs', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:10.000Z');

    h.slice.replaceStreamingBuffer({
      turnId: 't-1',
      text: 'stale snapshot',
      producedAt: '2026-04-25T00:00:05.000Z',
    });

    expect(Object.keys(h.get().streamingBuffers)).toHaveLength(0);
  });

  it('overwrites the buffer when producedAt >= lastChatSnapshotTs', () => {
    h.slice.replaceChatEvents([], {}, '2026-04-25T00:00:10.000Z');

    // Seed something so we can confirm the next call OVERWRITES, not merges.
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'partial',
      producedAt: '2026-04-25T00:00:11.000Z',
    });
    h.slice.replaceStreamingBuffer({
      turnId: 't-1',
      text: 'final snapshot',
      thinking: 'with thinking',
      producedAt: '2026-04-25T00:00:12.000Z',
    });

    const buf = h.get().streamingBuffers['t-1:_main_'];
    expect(buf?.text).toBe('final snapshot');
    expect(buf?.thinking).toBe('with thinking');
  });
});

describe('sseSlice — clearChatEvents', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('wipes chatEvents and streamingBuffers in one shot', () => {
    h.slice.replaceChatEvents(
      [userTurnLine('t-1', '2026-04-25T00:00:01.000Z')],
      {},
      '2026-04-25T00:00:02.000Z',
    );
    h.slice.applyStreamingDelta({
      turnId: 't-1',
      kind: 'text',
      chunk: 'hi',
      producedAt: '2026-04-25T00:00:03.000Z',
    });

    expect(h.get().chatEvents).toHaveLength(1);
    expect(Object.keys(h.get().streamingBuffers)).toHaveLength(1);

    h.slice.clearChatEvents('chat');

    expect(h.get().chatEvents).toHaveLength(0);
    expect(Object.keys(h.get().streamingBuffers)).toHaveLength(0);
  });
});

describe('sseSlice — appendChatEvent', () => {
  let h: ReturnType<typeof createHarness>;
  beforeEach(() => {
    h = createHarness();
  });

  it('preserves insertion order across multiple appends', () => {
    h.slice.appendChatEvent(userTurnLine('t-1', '2026-04-25T00:00:01.000Z'));
    h.slice.appendChatEvent(userTurnLine('t-2', '2026-04-25T00:00:02.000Z'));
    expect(h.get().chatEvents.map((e) => (e as any).turnId)).toEqual(['t-1', 't-2']);
  });
});
