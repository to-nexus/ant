/**
 * Chat SSOT persistence invariant — locks the contract that the replay
 * fix in `ChatStatusHandler.LIVE_ONLY_STATUS_TYPES` depends on:
 *
 *   Every in-progress / chunk chat status type (`reading`, `learning`,
 *   `listing_files`, `plan_generating`, …) is broadcast live but
 *   NOT persisted to `chat.jsonl`. Only the paired terminal card is
 *   persisted, carrying the final metadata the UI needs.
 *
 * Any future regression that makes an in-progress status leak back
 * into the persistence path will cause replay to render N cards where
 * live renders 1 — the original user-visible bug. This test is the
 * structural guard against that regression.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChatStatusHandler } from '../src/core/llm-response/ChatStatusHandler';
import { ContentMerger } from '../src/core/chat/ContentMerger';
import type { SessionStore } from '../src/core/llm-response/SessionStore';
import type { ChatSession } from '../src/core/chat/types';
import {
  setChatLogAppender,
  clearChatLogAppender,
} from '../src/core/llm-response/chatLogAppenderRegistry';
import type { ChatStatusType } from '../src/core/llm-response/types';

interface PersistedCall {
  kind: 'chat_status' | 'choice_presented';
  cardId?: string;
  statusType?: string;
  cardType?: string;
  metadata?: Record<string, unknown>;
}

function makeFakeAppender(persisted: PersistedCall[]) {
  return {
    appendChatStatus(cardId: string, statusType: string, metadata?: Record<string, unknown>) {
      persisted.push({ kind: 'chat_status', cardId, statusType, metadata });
    },
    appendChoicePresented(
      cardId: string,
      cardType: string,
      options: { prompt?: string; payload?: Record<string, unknown> } = {},
    ) {
      persisted.push({
        kind: 'choice_presented',
        cardId,
        cardType,
        metadata: { cardId, ...(options.payload ?? {}) },
      });
    },
    // Unused methods — referenced by the ChatLogAppender surface but
    // not exercised here.
    setTurnId() {},
    getTurnId() {
      return 't-test';
    },
    isReady() {
      return true;
    },
    appendThinking() {},
    appendAssistantMessage() {},
    appendChoiceResolved() {},
  } as any;
}

function makeSession(): ChatSession {
  return {
    projectId: 'proj',
    featureName: 'feat',
    jobId: 'job-1',
    messages: [],
    currentMessage: {
      id: 'm-1',
      role: 'assistant',
      timestamp: new Date().toISOString(),
      contents: [],
    },
  };
}

function makeHandler(session: ChatSession): ChatStatusHandler {
  const store: Partial<SessionStore> = {
    getSession: () => session,
    getContext: () =>
      ({
        projectId: session.projectId,
        featureName: session.featureName,
        jobId: session.jobId ?? '',
        sessionKey: 's',
      }) as any,
    updateCurrentMessage: async () => {},
  };
  const merger = new ContentMerger();
  return new ChatStatusHandler(store as SessionStore, merger);
}

describe('ChatStatusHandler persistence — live-only gating', () => {
  let persisted: PersistedCall[];

  beforeEach(() => {
    persisted = [];
    setChatLogAppender(makeFakeAppender(persisted));
  });

  afterEach(() => {
    clearChatLogAppender();
  });

  const inProgressTypes: ChatStatusType[] = [
    'exploring',
    'retrieving',
    'grepping',
    'reading',
    'reading_source',
    'listing_files',
    'searching_code',
    'searching_reference',
    'indexing',
    'analyzing',
    'storing',
    'learning',
    'loading',
    'processing',
    'downloading',
    'figma_calling',
    'plan_generating',
  ];

  for (const t of inProgressTypes) {
    it(`in-progress '${t}' is NOT persisted to chat.jsonl`, () => {
      const handler = makeHandler(makeSession());
      handler.showChatStatus(t, { filePath: 'x' });
      expect(
        persisted.filter((c) => c.kind === 'chat_status' && c.statusType === t),
      ).toHaveLength(0);
    });
  }

  const terminalTypes: Array<{ type: ChatStatusType; metadata: Record<string, unknown> }> = [
    { type: 'read', metadata: { filePath: 'src/a.ts' } },
    { type: 'learned', metadata: { filesWritten: 1, branch: 'main' } },
    { type: 'listed_files', metadata: { directory: '.', filesCount: 3, totalFiles: 3 } },
    { type: 'plan', metadata: { content: 'full plan text', taskName: 'step 1' } },
    { type: 'explored', metadata: { filesCount: 5 } },
    { type: 'searched_code', metadata: { pattern: 'TODO', totalMatches: 2, filesCount: 1 } },
  ];

  for (const row of terminalTypes) {
    it(`terminal '${row.type}' IS persisted with metadata intact`, () => {
      const handler = makeHandler(makeSession());
      handler.showChatStatus(row.type, row.metadata);
      const calls = persisted.filter(
        (c) => c.kind === 'chat_status' && c.statusType === row.type,
      );
      expect(calls).toHaveLength(1);
      for (const [key, value] of Object.entries(row.metadata)) {
        expect(calls[0].metadata?.[key]).toEqual(value);
      }
    });
  }

  it('reading → read sequence persists only the terminal line', () => {
    const session = makeSession();
    const handler = makeHandler(session);

    const readingIdx = handler.showChatStatus('reading', { filePath: 'src/a.ts' });
    handler.showChatStatus('read', { filePath: 'src/a.ts', _mergeIndex: readingIdx });

    const statusCalls = persisted.filter((c) => c.kind === 'chat_status');
    expect(statusCalls.map((c) => c.statusType)).toEqual(['read']);
  });

  it('plan_generating chunks → plan sequence persists only the terminal plan line with full content', () => {
    const session = makeSession();
    const handler = makeHandler(session);

    const planIdx = handler.showChatStatus('plan_generating', { taskName: 'T1' });
    handler.showChatStatus('plan_generating', { content: 'chunk-1 ' });
    handler.showChatStatus('plan_generating', { content: 'chunk-2' });
    handler.showChatStatus('plan', {
      content: 'chunk-1 chunk-2',
      taskName: 'T1',
      _mergeIndex: planIdx,
      _preserveContent: true,
    });

    const statusCalls = persisted.filter((c) => c.kind === 'chat_status');
    expect(statusCalls.map((c) => c.statusType)).toEqual(['plan']);
    expect(statusCalls[0].metadata?.content).toBe('chunk-1 chunk-2');
    expect(statusCalls[0].metadata?.taskName).toBe('T1');
  });

  it('placeholder and thinking remain live-only (pre-existing invariant)', () => {
    const handler = makeHandler(makeSession());
    handler.showChatStatus('placeholder');
    handler.showChatStatus('thinking', { content: '…' });
    expect(persisted.filter((c) => c.kind === 'chat_status')).toHaveLength(0);
  });
});
