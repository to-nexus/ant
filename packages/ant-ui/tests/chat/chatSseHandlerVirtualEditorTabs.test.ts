import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatSseHandler } from '../../src/domain/store/slices/sse/chatSseHandler';

interface HarnessState {
  selectedProject: string | undefined;
  selectedFeature: string | undefined;
  selectedJobType: 'code' | 'design' | 'plan';
  streamingBuffers: Record<string, unknown>;
  chatEvents: unknown[];
  replaceChatEvents: ReturnType<typeof vi.fn>;
  appendChatEvent: ReturnType<typeof vi.fn>;
  replaceStreamingBuffer: ReturnType<typeof vi.fn>;
  syncVirtualEditorTabsFromBuffers: ReturnType<typeof vi.fn>;
  promoteVirtualEditorTabToReal: ReturnType<typeof vi.fn>;
  removeVirtualEditorTabsByJobId: ReturnType<typeof vi.fn>;
  refreshFileTree: ReturnType<typeof vi.fn>;
  clearChatEvents: ReturnType<typeof vi.fn>;
  clearFeatureLog: ReturnType<typeof vi.fn>;
  loadFeatureBreadcrumbs: ReturnType<typeof vi.fn>;
  setRunning: ReturnType<typeof vi.fn>;
  currentJobId: string | undefined;
  isRunning: boolean;
  jobStartPending: boolean;
  lastChatSnapshotTs: string | undefined;
}

function createHarness(overrides: Partial<HarnessState> = {}) {
  let state: HarnessState = {
    selectedProject: 'proj',
    selectedFeature: 'base',
    selectedJobType: 'design',
    streamingBuffers: {},
    chatEvents: [],
    replaceChatEvents: vi.fn((events: unknown[], buffers: Record<string, unknown>) => {
      state = { ...state, chatEvents: events, streamingBuffers: buffers };
    }),
    appendChatEvent: vi.fn(),
    replaceStreamingBuffer: vi.fn(() => {}),
    syncVirtualEditorTabsFromBuffers: vi.fn(),
    promoteVirtualEditorTabToReal: vi.fn(),
    removeVirtualEditorTabsByJobId: vi.fn(),
    refreshFileTree: vi.fn(),
    clearChatEvents: vi.fn(),
    clearFeatureLog: vi.fn(),
    loadFeatureBreadcrumbs: vi.fn(),
    setRunning: vi.fn(),
    currentJobId: undefined,
    isRunning: false,
    jobStartPending: false,
    lastChatSnapshotTs: undefined,
    ...overrides,
  };
  const get = () => state;
  const set = (
    update: Partial<HarnessState> | ((s: HarnessState) => Partial<HarnessState>),
  ) => {
    const patch = typeof update === 'function' ? update(state) : update;
    state = { ...state, ...patch };
  };
  return { get, set, state: () => state };
}

describe('chatSseHandler virtual editor tab bridge', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('card_output streaming delta triggers virtual tab sync path', () => {
    const h = createHarness();
    const handler = createChatSseHandler(h.set as any, h.get as any);
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    // Force immediate flush path in tests.
    (globalThis as any).requestAnimationFrame = undefined;
    (globalThis as any).cancelAnimationFrame = undefined;
    try {
      handler({
        type: 'streaming_delta',
        turnId: 'turn-1',
        kind: 'card_output',
        cardId: 'card-1',
        chunk: 'hello',
        producedAt: new Date().toISOString(),
        projectId: 'proj',
        featureName: 'base',
      });
    } finally {
      (globalThis as any).requestAnimationFrame = originalRaf;
      (globalThis as any).cancelAnimationFrame = originalCancel;
    }

    expect(h.state().syncVirtualEditorTabsFromBuffers).toHaveBeenCalledTimes(1);
  });

  it('streaming buffer snapshot resyncs virtual tabs from existing buffers', () => {
    const h = createHarness();
    h.state().replaceStreamingBuffer.mockImplementation(() => {
      h.set({
        streamingBuffers: {
          'turn-1:_main_': { turnId: 'turn-1', workerScope: '_main_' },
        },
      });
    });
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler({
      type: 'streaming_buffer_snapshot',
      turnId: 'turn-1',
      text: '',
      thinking: '',
      pendingCards: {},
      producedAt: new Date().toISOString(),
      projectId: 'proj',
      featureName: 'base',
    });

    expect(h.state().syncVirtualEditorTabsFromBuffers).toHaveBeenCalledTimes(1);
  });

  it('design file_create finalization promotes virtual tab to pinned real tab', () => {
    const h = createHarness();
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler({
      type: 'chat_event_appended',
      producedAt: new Date().toISOString(),
      projectId: 'proj',
      featureName: 'base',
      event: {
        type: 'chat_status',
        ts: new Date().toISOString(),
        jobId: 'job-1',
        turnId: 'turn-1',
        jobType: 'design',
        cardId: 'card-1',
        statusType: 'file_create',
        metadata: { filePath: 'architecture/spec/spec-main.md' },
      },
    });

    expect(h.state().promoteVirtualEditorTabToReal).toHaveBeenCalledWith({
      cardId: 'card-1',
      filePath: 'architecture/spec/spec-main.md',
      source: 'design',
    });
  });

  it('parallel worker file_edit finalization also promotes virtual tab', () => {
    const h = createHarness();
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler({
      type: 'chat_event_appended',
      producedAt: new Date().toISOString(),
      projectId: 'proj',
      featureName: 'base',
      event: {
        type: 'chat_status',
        ts: new Date().toISOString(),
        jobId: 'job-1',
        turnId: 'turn-1',
        workerScope: 'worker-2#task-b',
        jobType: 'plan',
        cardId: 'card-2',
        statusType: 'file_edit',
        metadata: { filePath: 'plan/prd.md' },
      },
    });

    expect(h.state().promoteVirtualEditorTabToReal).toHaveBeenCalledWith({
      cardId: 'card-2',
      filePath: 'plan/prd.md',
      source: 'plan',
    });
  });

  it('job failed status closes virtual tabs tied to the job', () => {
    const h = createHarness();
    const handler = createChatSseHandler(h.set as any, h.get as any);
    handler({
      type: 'job_status',
      status: 'failed',
      jobId: 'job-22',
      projectId: 'proj',
      featureName: 'base',
    });

    expect(h.state().removeVirtualEditorTabsByJobId).toHaveBeenCalledWith('job-22');
  });
});
