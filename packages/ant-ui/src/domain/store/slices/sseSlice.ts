import { StateCreator } from 'zustand';
import { sseManager } from '@/infrastructure/sse/SSEManager';
import type { HandlerId } from '@/infrastructure/sse/SSEManager';
import type { ChatLine } from '@ant/shared';
import type {
  BufferKey,
  StreamingBuffer,
} from '@/domain/store/selectors/chat';
import type { KanbanData } from '@/infrastructure/http/api';
import type { SSEMessageMap } from '@ant/shared';

import { handleKanbanUpdate } from './sse/kanbanReducer';
import { createChatSseHandler } from './sse/chatSseHandler';
import { createFileTreeSseHandler } from './sse/fileTreeSseHandler';
import { createUnseenArtifactsHandler, createBridgeHandler, createTransferHandler } from './sse/auxiliarySseHandlers';
import { setupConnectionPolicy } from './sse/sseConnectionPolicy';
import { handleInitialActiveJobs } from './sse/activeJobsBootstrap';

let sliceHandlerIds: HandlerId[] = [];

export interface SSEState {
  kanban: KanbanData;
  /** Finalized chat.jsonl events. Phase 10 chat-SSOT substrate. */
  chatEvents: ChatLine[];
  /** In-flight streaming buffers keyed by `${turnId}:${workerScope}`. */
  streamingBuffers: Record<BufferKey, StreamingBuffer>;
  /** Last `chat_initial_state.serverTs` for streaming-delta gating. */
  lastChatSnapshotTs?: string;
  connectionStatus: 'connected' | 'disconnected' | 'error';
}

/**
 * Phase 10 chat-SSOT actions.
 *
 * Replaces the legacy `addChatMessage` / `updateChatMessage` /
 * `removeCancelledMessage` / `clearChatMessages` quartet with a
 * substrate that mirrors the BE emission contract:
 *  - `appendChatEvent` — append a single finalized ChatLine.
 *  - `replaceChatEvents` — replace the whole list (initial-state hydrate).
 *  - `applyStreamingDelta` — append a streaming chunk to a buffer.
 *  - `replaceStreamingBuffer` — overwrite a single buffer (snapshot reply).
 *  - `clearStreamingBuffer` — drop one buffer.
 *  - `clearChatEvents` — wipe events + every buffer (Hard Reset / Chat Clear).
 */
export interface SSEActions {
  updateKanban: (data: KanbanData) => void;
  updateKanbanRecursion: (recursionCount: number, recursionLimit?: number, recursionTaskName?: string) => void;
  appendChatEvent: (event: ChatLine) => void;
  replaceChatEvents: (events: ChatLine[], buffers: Record<BufferKey, StreamingBuffer>, serverTs: string) => void;
  applyStreamingDelta: (
    args: {
      turnId: string;
      workerScope?: string;
      kind: 'text' | 'thinking' | 'card_output';
      cardId?: string;
      chunk: string;
      producedAt: string;
    },
  ) => void;
  replaceStreamingBuffer: (
    args: {
      turnId: string;
      workerScope?: string;
      text?: string;
      thinking?: string;
      pendingCards?: Record<string, import('@ant/shared').PendingCardSnapshot>;
      producedAt: string;
    },
  ) => void;
  clearStreamingBuffer: (turnId: string, workerScope?: string) => void;
  clearChatEvents: (scope?: 'chat' | 'full') => void;
  initializeSSE: () => void;
  reconnectSSE: (key: string) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'error') => void;
  handleInitialActiveJobs: (jobs: Array<{ jobType: string; jobId: string; status: string; agent?: string }>) => void;
}

export type SSESlice = SSEState & SSEActions;

const MAIN_WORKER_SCOPE = '_main_';

function bufferKey(turnId: string, workerScope?: string | null): BufferKey {
  return `${turnId}:${workerScope || MAIN_WORKER_SCOPE}`;
}

export const createSSESlice: StateCreator<any, [], [], SSESlice> = (set, get) => ({
  kanban: { jobId: undefined, todo: [], inProgress: [], completed: [], isEstimating: false, dataSource: 'session' as const },
  chatEvents: [],
  streamingBuffers: {},
  lastChatSnapshotTs: undefined,
  connectionStatus: 'disconnected',

  updateKanbanRecursion: (recursionCount: number, recursionLimit?: number, recursionTaskName?: string) => {
    set((state: any) => ({
      kanban: {
        ...state.kanban,
        recursionCount,
        ...(recursionLimit !== undefined && { recursionLimit }),
        ...(recursionTaskName !== undefined && { recursionTaskName }),
      }
    }));
  },

  updateKanban: (data) => handleKanbanUpdate(data, set, get),

  appendChatEvent: (event) => {
    set((state: any) => ({
      chatEvents: [...state.chatEvents, event],
    }));
  },

  replaceChatEvents: (events, buffers, serverTs) => {
    set({
      chatEvents: events,
      streamingBuffers: buffers,
      lastChatSnapshotTs: serverTs,
    });
  },

  applyStreamingDelta: ({ turnId, workerScope, kind, cardId, chunk, producedAt }) => {
    if (!turnId || !chunk) return;
    set((state: any) => {
      const last = state.lastChatSnapshotTs;
      if (last && producedAt < last) {
        return state;
      }
      const key = bufferKey(turnId, workerScope);
      const prev: StreamingBuffer = state.streamingBuffers[key] ?? {
        turnId,
        workerScope: workerScope || MAIN_WORKER_SCOPE,
      };
      let next: StreamingBuffer;
      if (kind === 'thinking') {
        next = { ...prev, thinking: (prev.thinking ?? '') + chunk };
      } else if (kind === 'text') {
        next = { ...prev, text: (prev.text ?? '') + chunk };
      } else {
        if (!cardId) return state;
        const prevCards = prev.pendingCards ?? {};
        const prevCard = prevCards[cardId];
        const nextCard = prevCard
          ? { ...prevCard, streamedOutput: (prevCard.streamedOutput ?? '') + chunk }
          : {
              cardId,
              statusType: 'tool_action' as const,
              metadata: {} as Record<string, unknown>,
              streamedOutput: chunk,
            };
        next = {
          ...prev,
          pendingCards: { ...prevCards, [cardId]: nextCard },
        };
      }
      return {
        streamingBuffers: { ...state.streamingBuffers, [key]: next },
      };
    });
  },

  replaceStreamingBuffer: ({ turnId, workerScope, text, thinking, pendingCards, producedAt }) => {
    if (!turnId) return;
    set((state: any) => {
      const last = state.lastChatSnapshotTs;
      if (last && producedAt < last) return state;
      const key = bufferKey(turnId, workerScope);
      const next: StreamingBuffer = {
        turnId,
        workerScope: workerScope || MAIN_WORKER_SCOPE,
        text,
        thinking,
        pendingCards,
      };
      return { streamingBuffers: { ...state.streamingBuffers, [key]: next } };
    });
  },

  clearStreamingBuffer: (turnId, workerScope) => {
    if (!turnId) return;
    set((state: any) => {
      const key = bufferKey(turnId, workerScope);
      if (!(key in state.streamingBuffers)) return state;
      const next = { ...state.streamingBuffers };
      delete next[key];
      return { streamingBuffers: next };
    });
  },

  clearChatEvents: (_scope = 'chat') => {
    set({ chatEvents: [], streamingBuffers: {} });
  },

  initializeSSE: () => {
    const state = get();

    if (!state.selectedProject || !state.selectedFeature) {
      console.warn('[Store] Cannot initialize SSE: missing project/feature');
      return;
    }

    if (state.backendMode === 'cloud' && !state.userEmail) {
      console.log('[Store] Cannot initialize SSE: Cloud mode requires authentication');
      return;
    }

    console.log(`[Timing] initializeSSE start @${Math.round(performance.now())}ms (${state.selectedProject}/${state.selectedFeature})`);

    const jobType = state.selectedJobType;
    const connectedProject = state.selectedProject;
    const connectedFeature = state.selectedFeature;

    for (const id of sliceHandlerIds) {
      sseManager.unregisterHandlerById(id);
    }
    sliceHandlerIds = [];

    sliceHandlerIds.push(sseManager.registerHandlerWithId('kanban', (data: KanbanData) => {
      const currentState = get();
      if (currentState.selectedProject !== connectedProject ||
          currentState.selectedFeature !== connectedFeature) return;

      if (data.activeJobs) {
        get().handleInitialActiveJobs(data.activeJobs);
      }

      if (data.jobType && data.jobId && !data.activeJobs) {
        const isActive = data.dataSource === 'live' || data.dataSource === 'estimating';
        if (isActive) {
          get().setActiveJob(data.jobType, { jobId: data.jobId, status: 'running' });
        } else {
          get().clearActiveJob(data.jobType);
        }
      }

      if (!data.jobType || data.jobType === currentState.selectedJobType) {
        get().updateKanban(data);
      }
    }));

    sliceHandlerIds.push(sseManager.registerHandlerWithId('chat', createChatSseHandler(set, get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('fileTree', createFileTreeSseHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('unseenArtifacts', createUnseenArtifactsHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('bridge', createBridgeHandler(get)));
    sliceHandlerIds.push(sseManager.registerHandlerWithId('transfer', createTransferHandler(get)));

    sliceHandlerIds.push(
      sseManager.registerHandlerWithId('gitState', (data: SSEMessageMap['gitState']) => {
        const s = get();
        const activeProject = s.selectedProject;
        const activeFeature = s.selectedFeature;
        if (!activeProject) return;
        const eventFeature = data?.feature || undefined;
        if (
          data?.project !== activeProject ||
          eventFeature !== activeFeature
        ) {
          return;
        }
        if (data.cause === 'workingTreeChange') {
          s._refreshWorkingTreeDebounced?.(activeProject, activeFeature);
        } else {
          s._applyGitStateEvent?.(data);
        }
      })
    );

    setupConnectionPolicy(sseManager, set, get);

    sseManager.connect(state.selectedProject, state.selectedFeature, jobType);

    if (state.currentJobId) {
      sseManager.connectWorkflow(state.currentJobId);
    }

    console.log('[Store] ✅ Unified SSE connection initializing (waiting for onopen...)');
  },

  reconnectSSE: (key) => {
    const state = get();
    console.log(`[Store] 🔄 Reconnecting unified SSE (key: ${key})`);

    if (!state.selectedProject || !state.selectedFeature) {
      console.warn('[Store] ⚠️  Cannot reconnect: missing project/feature');
      return;
    }

    if (state.backendMode === 'cloud' && !state.userEmail) {
      console.log('[Store] ⚠️  Cannot reconnect SSE: Cloud mode requires authentication');
      return;
    }

    if (key === 'kanban' || key === 'chat' || key === 'fileTree') {
      sseManager.disconnect();
      get().initializeSSE();
    }
    else if (key === 'workflow' && state.currentJobId) {
      sseManager.disconnectWorkflow(state.currentJobId);
      sseManager.connectWorkflow(state.currentJobId);
    }
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  handleInitialActiveJobs: (jobs) => handleInitialActiveJobs(jobs, set, get),
});
