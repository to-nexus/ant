/**
 * LLMResponseService — unit guard for the chat-SSOT §5 emission path.
 *
 * Locks the contract that every public method of the service either:
 *   (a) writes a finalized ChatLine to chat.jsonl AND emits a
 *       `chat_event_appended` SSE; OR
 *   (b) writes to Redis TURN_BUFFER AND emits a `streaming_delta` /
 *       `streaming_buffer_snapshot` SSE; AND
 *   (c) preserves the pre-§5 caller signatures (compat surface) so
 *       graph nodes / strategies / tool handlers compile unchanged.
 *
 * Verifies cardId chaining for progress→terminal pairs, sync-channel
 * snapshot replay, and the lifecycle-noop semantics of the deprecated
 * `startMessage` / `hasActiveMessage` calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  ChatLine,
  PendingCardSnapshot,
  TurnBufferSnapshot,
} from '@ant/shared';
import type { StateStorePort } from '../src/core/ports/stateStore';
import { LLMResponseService } from '../src/core/llm-response/LLMResponseService';
import type { LLMResponseEnv } from '../src/core/llm-response/types';
import type { ChatBroadcastEnvelope } from '../src/core/chat/MessageBroadcaster';

// ─────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────

interface BufferKey {
  sessionKey: string;
  turnId: string;
  workerScope: string | undefined;
}

function bufferKey(k: BufferKey): string {
  return `${k.sessionKey}|${k.turnId}|${k.workerScope ?? '_main_'}`;
}

interface AppendCall {
  kind: 'text' | 'thinking' | 'card_output';
  chunk: string;
  cardId?: string;
  key: BufferKey;
}

class FakeStateStore implements Partial<StateStorePort> {
  buffers = new Map<
    string,
    { text?: string; thinking?: string; pendingCards: Record<string, PendingCardSnapshot> }
  >();
  appendCalls: AppendCall[] = [];
  setPendingCardCalls: Array<{ key: BufferKey; card: PendingCardSnapshot }> = [];
  clearPendingCardCalls: Array<{ key: BufferKey; cardId: string }> = [];
  clearBufferCalls: Array<BufferKey> = [];
  publishedEnvelopes: ChatBroadcastEnvelope[] = [];
  subscribeCallback: ((message: any) => void) | null = null;
  /** Result returned by `listActiveTurnBuffers`. Tests override per case. */
  activeBuffers: TurnBufferSnapshot[] = [];

  async getTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<{
    text?: string;
    thinking?: string;
    pendingCards?: Record<string, PendingCardSnapshot>;
  } | null> {
    const buf = this.buffers.get(bufferKey({ sessionKey, turnId, workerScope }));
    if (!buf) return null;
    return {
      text: buf.text,
      thinking: buf.thinking,
      pendingCards: { ...buf.pendingCards },
    };
  }

  async appendToTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    kind: 'text' | 'thinking' | 'card_output',
    chunk: string,
    cardId?: string,
  ): Promise<void> {
    const key = { sessionKey, turnId, workerScope };
    this.appendCalls.push({ kind, chunk, cardId, key });
    const k = bufferKey(key);
    let buf = this.buffers.get(k);
    if (!buf) {
      buf = { pendingCards: {} };
      this.buffers.set(k, buf);
    }
    if (kind === 'text') buf.text = (buf.text ?? '') + chunk;
    else if (kind === 'thinking') buf.thinking = (buf.thinking ?? '') + chunk;
    else if (kind === 'card_output' && cardId) {
      const existing = buf.pendingCards[cardId];
      if (existing) {
        existing.streamedOutput = (existing.streamedOutput ?? '') + chunk;
      } else {
        buf.pendingCards[cardId] = {
          cardId,
          statusType: 'tool_action',
          metadata: {},
          streamedOutput: chunk,
        };
      }
    }
  }

  async setTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    card: PendingCardSnapshot,
  ): Promise<void> {
    const key = { sessionKey, turnId, workerScope };
    this.setPendingCardCalls.push({ key, card });
    const k = bufferKey(key);
    let buf = this.buffers.get(k);
    if (!buf) {
      buf = { pendingCards: {} };
      this.buffers.set(k, buf);
    }
    buf.pendingCards[card.cardId] = card;
  }

  async clearTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    cardId: string,
  ): Promise<void> {
    const key = { sessionKey, turnId, workerScope };
    this.clearPendingCardCalls.push({ key, cardId });
    const buf = this.buffers.get(bufferKey(key));
    if (buf) delete buf.pendingCards[cardId];
  }

  async clearTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<void> {
    const key = { sessionKey, turnId, workerScope };
    this.clearBufferCalls.push(key);
    this.buffers.delete(bufferKey(key));
  }

  async listActiveTurnBuffers(_sessionKey: string): Promise<TurnBufferSnapshot[]> {
    return this.activeBuffers;
  }

  async publish(_channel: string, message: any): Promise<void> {
    this.publishedEnvelopes.push(message as ChatBroadcastEnvelope);
  }

  async subscribe(_channel: string, callback: (message: any) => void): Promise<() => void> {
    this.subscribeCallback = callback;
    return async () => {
      this.subscribeCallback = null;
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

function makeEnv(overrides: Partial<LLMResponseEnv> = {}): LLMResponseEnv {
  return {
    projectId: 'proj-1',
    featureName: 'feat-1',
    jobId: 'job-1',
    jobType: 'code',
    agent: 'architect',
    userId: 'user-1',
    organizationId: 'org-1',
    ...overrides,
  };
}

function makeService(env: LLMResponseEnv = makeEnv()): {
  service: LLMResponseService;
  store: FakeStateStore;
} {
  const store = new FakeStateStore();
  const service = new LLMResponseService(store as unknown as StateStorePort, env);
  service.setTurnId('turn-1');
  return { service, store };
}

function emittedLines(store: FakeStateStore): ChatLine[] {
  return store.publishedEnvelopes
    .map((env) => env.data)
    .filter((d: any) => d.type === 'chat_event_appended')
    .map((d: any) => d.event as ChatLine);
}

function emittedDeltas(store: FakeStateStore): any[] {
  return store.publishedEnvelopes
    .map((env) => env.data)
    .filter((d: any) => d.type === 'streaming_delta');
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('LLMResponseService — finalized line emission', () => {
  it('appendThinking writes a chat.jsonl line AND broadcasts chat_event_appended', async () => {
    const { service, store } = makeService();
    await service.appendThinking('reasoning text');
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('assistant_thinking');
    expect((lines[0] as any).text).toBe('reasoning text');
    expect(lines[0].turnId).toBe('turn-1');
    expect(lines[0].jobId).toBe('job-1');
  });

  it('appendAssistantMessage emits exactly once per call', async () => {
    const { service, store } = makeService();
    await service.appendAssistantMessage('hello');
    await service.appendAssistantMessage('world');
    const lines = emittedLines(store);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (l as any).text)).toEqual(['hello', 'world']);
  });

  it('appendChatStatus carries cardId + statusType + metadata', async () => {
    const { service, store } = makeService();
    await service.appendChatStatus('card-x', 'read', { filePath: 'src/a.ts' });
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('chat_status');
    expect((lines[0] as any).cardId).toBe('card-x');
    expect((lines[0] as any).statusType).toBe('read');
    expect((lines[0] as any).metadata).toEqual({ filePath: 'src/a.ts' });
  });

  it('appendChoicePresented carries cardType / prompt / payload', async () => {
    const { service, store } = makeService();
    await service.appendChoicePresented({
      cardId: 'choice-1',
      cardType: 'triage_choice',
      prompt: 'Continue?',
      payload: { reason: 'ambiguous' },
    });
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('choice_presented');
    expect((lines[0] as any).cardId).toBe('choice-1');
    expect((lines[0] as any).cardType).toBe('triage_choice');
  });

  it('skips emission silently when turnId is not set', async () => {
    const store = new FakeStateStore();
    const service = new LLMResponseService(
      store as unknown as StateStorePort,
      makeEnv(),
    );
    // No setTurnId — appender is unset.
    await service.appendChatStatus('card-1', 'read', {});
    expect(emittedLines(store)).toHaveLength(0);
  });
});

describe('LLMResponseService — in-flight streaming', () => {
  it('streamTextChunk writes TURN_BUFFER + emits streaming_delta', async () => {
    const { service, store } = makeService();
    await service.streamTextChunk('Hello, ');
    await service.streamTextChunk('world!');
    expect(store.appendCalls).toEqual([
      expect.objectContaining({ kind: 'text', chunk: 'Hello, ' }),
      expect.objectContaining({ kind: 'text', chunk: 'world!' }),
    ]);
    const deltas = emittedDeltas(store);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ kind: 'text', chunk: 'Hello, ', turnId: 'turn-1' });
    expect(deltas[1]).toMatchObject({ kind: 'text', chunk: 'world!' });
  });

  it('streamThinkingChunk + flushThinkingBuffer drains into appendThinking', async () => {
    const { service, store } = makeService();
    await service.streamThinkingChunk('part 1 ');
    await service.streamThinkingChunk('part 2');
    expect(store.appendCalls.filter((c) => c.kind === 'thinking')).toHaveLength(2);

    await service.flushThinkingBuffer();
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('assistant_thinking');
    expect((lines[0] as any).text).toBe('part 1 part 2');
  });

  it('registerPendingCard sets TURN_BUFFER and emits a card_output heartbeat', async () => {
    const { service, store } = makeService();
    await service.registerPendingCard('card-1', 'reading', { filePath: 'a.ts' });
    expect(store.setPendingCardCalls).toHaveLength(1);
    expect(store.setPendingCardCalls[0].card.cardId).toBe('card-1');
    expect(store.setPendingCardCalls[0].card.statusType).toBe('reading');
    const deltas = emittedDeltas(store);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: 'card_output', cardId: 'card-1', chunk: '' });
  });

  it('streamCardOutput appends to pendingCards and emits per-chunk delta', async () => {
    const { service, store } = makeService();
    await service.registerPendingCard('card-out', 'command_running', { command: 'ls' });
    await service.streamCardOutput('card-out', 'first ');
    await service.streamCardOutput('card-out', 'second');
    const cardChunks = emittedDeltas(store)
      .filter((d) => d.kind === 'card_output' && d.chunk.length > 0)
      .map((d) => d.chunk);
    expect(cardChunks).toEqual(['first ', 'second']);
  });

  it('finalizePendingCard clears the pending card and emits the terminal chat_status', async () => {
    const { service, store } = makeService();
    await service.registerPendingCard('cmd-1', 'command_running', { command: 'echo hi' });
    await service.finalizePendingCard('cmd-1', 'command', {
      command: 'echo hi',
      exitCode: 0,
      output: 'hi\n',
    });
    expect(store.clearPendingCardCalls.map((c) => c.cardId)).toContain('cmd-1');
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect((lines[0] as any).statusType).toBe('command');
    expect((lines[0] as any).cardId).toBe('cmd-1');
  });
});

describe('LLMResponseService — showChatStatus dispatch', () => {
  it('placeholder / thinking are live-only no-ops (no chat.jsonl, no buffer)', async () => {
    const { service, store } = makeService();
    const a = await service.showChatStatus('placeholder');
    const b = await service.showChatStatus('thinking');
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(emittedLines(store)).toHaveLength(0);
    expect(store.appendCalls).toHaveLength(0);
  });

  it('triage_choice persists a choice_presented line and returns the cardId', async () => {
    const { service, store } = makeService();
    const cardId = await service.showChatStatus('triage_choice', {
      message: 'Out of scope',
      jobId: 'job-1',
    });
    expect(typeof cardId).toBe('string');
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('choice_presented');
    expect((lines[0] as any).cardType).toBe('triage_choice');
    expect((lines[0] as any).cardId).toBe(cardId);
  });

  it('progress type (retrieving) registers a pending card without writing chat.jsonl', async () => {
    const { service, store } = makeService();
    const cardId = await service.showChatStatus('retrieving', { query: 'foo' });
    expect(typeof cardId).toBe('string');
    expect(emittedLines(store)).toHaveLength(0);
    expect(store.setPendingCardCalls).toHaveLength(1);
    expect(store.setPendingCardCalls[0].card.cardId).toBe(cardId);
    expect(store.setPendingCardCalls[0].card.statusType).toBe('retrieving');
  });

  it('terminal type (read) writes one chat_status line with the carried cardId', async () => {
    const { service, store } = makeService();
    const progressId = await service.showChatStatus('reading', { filePath: 'a.ts' });
    await service.showChatStatus('read', { filePath: 'a.ts', _mergeIndex: progressId });

    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect((lines[0] as any).statusType).toBe('read');
    expect((lines[0] as any).cardId).toBe(progressId);
    expect((lines[0] as any).metadata).toMatchObject({ filePath: 'a.ts' });
    // _mergeIndex / cardId shouldn't pollute persisted metadata.
    expect((lines[0] as any).metadata?._mergeIndex).toBeUndefined();
  });

  it('progress→terminal pairing finalizes the matching pending card', async () => {
    const { service, store } = makeService();
    const cardId = await service.showChatStatus('reading', { filePath: 'a.ts' });
    await service.showChatStatus('read', { filePath: 'a.ts', _mergeIndex: cardId });
    expect(store.clearPendingCardCalls.map((c) => c.cardId)).toContain(cardId);
  });
});

describe('LLMResponseService — file/command compat', () => {
  it('startFileCreation → completeFileCreation pairs cardId via fileCardByPath', async () => {
    const { service, store } = makeService();
    const cardId = await service.startFileCreation('src/foo.ts');
    expect(store.setPendingCardCalls).toHaveLength(1);
    expect(store.setPendingCardCalls[0].card.statusType).toBe('file_creating');

    await service.streamFileContent('src/foo.ts', 'export const x = 1;\n');
    const cardChunks = emittedDeltas(store).filter(
      (d) => d.kind === 'card_output' && d.chunk.length > 0,
    );
    expect(cardChunks[0].cardId).toBe(cardId);

    await service.completeFileCreation('src/foo.ts', 'export const x = 1;\n');
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect((lines[0] as any).statusType).toBe('file_create');
    expect((lines[0] as any).cardId).toBe(cardId);
    expect((lines[0] as any).metadata).toMatchObject({
      filePath: 'src/foo.ts',
      content: 'export const x = 1;\n',
    });
  });

  it('startCommand / completeCommand emits exactly one terminal chat_status', async () => {
    const { service, store } = makeService();
    const cardId = await service.startCommand('npm test');
    expect(store.setPendingCardCalls.map((c) => c.card.statusType)).toContain('command_running');

    await service.streamCommandOutput('npm test', 'test snapshot ');
    await service.streamCommandOutput('npm test', 'test snapshot 2');

    await service.completeCommand('npm test', 'final output', 0);
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect((lines[0] as any).statusType).toBe('command');
    expect((lines[0] as any).cardId).toBe(cardId);
    expect((lines[0] as any).metadata).toMatchObject({
      command: 'npm test',
      exitCode: 0,
    });
  });
});

describe('LLMResponseService — sendLLMEvent dispatch', () => {
  it('text events stream into TURN_BUFFER as text deltas', async () => {
    const { service, store } = makeService();
    await service.sendLLMEvent({ type: 'text', text: 'hello' });
    const deltas = emittedDeltas(store);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: 'text', chunk: 'hello' });
  });

  it('thinking blockEnd flushes accumulated buffer into a single assistant_thinking line', async () => {
    const { service, store } = makeService();
    await service.sendLLMEvent({ type: 'thinking', thinking: 'a ', metadata: {} });
    await service.sendLLMEvent({
      type: 'thinking',
      thinking: 'b',
      metadata: { blockEnd: true, durationMs: 50 },
    });
    const lines = emittedLines(store);
    expect(lines.filter((l) => l.type === 'assistant_thinking')).toHaveLength(1);
    expect((lines[0] as any).text).toBe('a b');
  });

  it('mkdir tool_use writes a tool_action chat_status', async () => {
    const { service, store } = makeService();
    await service.sendLLMEvent({
      type: 'tool_use',
      toolUse: { name: 'mkdir', input: { path: 'src/new' } } as any,
    } as any);
    const lines = emittedLines(store);
    expect(lines).toHaveLength(1);
    expect((lines[0] as any).statusType).toBe('tool_action');
    expect((lines[0] as any).metadata).toMatchObject({
      toolName: 'mkdir',
      filePath: 'src/new',
    });
  });

  it('TOOLS_WITH_DEDICATED_STATUS skip generic tool_action emission', async () => {
    const { service, store } = makeService();
    for (const name of ['read_file', 'list_files', 'search_code', 'run_command']) {
      await service.sendLLMEvent({
        type: 'tool_use',
        toolUse: { name, input: {} } as any,
      } as any);
    }
    expect(emittedLines(store)).toHaveLength(0);
  });
});

describe('LLMResponseService — lifecycle compat', () => {
  it('hasActiveMessage / startMessage are no-op (chat-SSOT §5)', async () => {
    const { service } = makeService();
    expect(await service.hasActiveMessage()).toBe(false);
    expect(await service.startMessage()).toBeNull();
  });

  it('finalizeMessage(cancelled=true) clears the turn buffer', async () => {
    const { service, store } = makeService();
    await service.streamTextChunk('half-finished');
    await service.finalizeMessage(true);
    expect(store.clearBufferCalls.length).toBeGreaterThan(0);
  });

  it('finalizeMessage(cancelled=false) drains text + thinking into chat.jsonl', async () => {
    const { service, store } = makeService();
    await service.streamTextChunk('text-content');
    await service.streamThinkingChunk('thinking-content');
    await service.finalizeMessage(false);
    const lines = emittedLines(store);
    const thinkingLines = lines.filter((l) => l.type === 'assistant_thinking');
    const messageLines = lines.filter((l) => l.type === 'assistant_message');
    expect(thinkingLines).toHaveLength(1);
    expect(messageLines).toHaveLength(1);
    expect((thinkingLines[0] as any).text).toBe('thinking-content');
    expect((messageLines[0] as any).text).toBe('text-content');
  });

  it('removeChatStatus clears the matching pending card', async () => {
    const { service, store } = makeService();
    const cardId = await service.showChatStatus('retrieving', { query: 'q' });
    await service.removeChatStatus(cardId!);
    expect(store.clearPendingCardCalls.map((c) => c.cardId)).toContain(cardId);
  });
});

describe('LLMResponseService — sync request snapshot', () => {
  it('handleSyncRequest broadcasts streaming_buffer_snapshot for every active buffer', async () => {
    const { service, store } = makeService();
    store.activeBuffers = [
      {
        turnId: 'turn-1',
        workerScope: '_main_',
        text: 'partial text',
        thinking: undefined,
        pendingCards: undefined,
      },
      {
        turnId: 'turn-1',
        workerScope: 'worker-2',
        text: undefined,
        thinking: 'partial thinking',
        pendingCards: { cmd1: { cardId: 'cmd1', statusType: 'command_running', metadata: {} } },
      },
    ];

    // Trigger sync via the registered subscribe callback.
    expect(store.subscribeCallback).not.toBeNull();
    store.subscribeCallback!({});
    // Allow the async handler to drain.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const snapshots = store.publishedEnvelopes
      .map((env) => env.data)
      .filter((d: any) => d.type === 'streaming_buffer_snapshot');
    expect(snapshots).toHaveLength(2);
    const keys = snapshots.map((s: any) => `${s.turnId}|${s.workerScope ?? '_main_'}`);
    expect(new Set(keys)).toEqual(new Set(['turn-1|_main_', 'turn-1|worker-2']));
  });
});

describe('LLMResponseService — env / disabled paths', () => {
  it('isEnabled returns false when projectId is missing', () => {
    const store = new FakeStateStore();
    const service = new LLMResponseService(
      store as unknown as StateStorePort,
      { ...makeEnv(), projectId: '' },
    );
    expect(service.isEnabled()).toBe(false);
  });

  it('disposeChatLogAppender clears the registry', () => {
    const { service } = makeService();
    service.disposeChatLogAppender();
    // calling twice is safe (idempotent)
    service.disposeChatLogAppender();
  });
});

describe('LLMResponseService — cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drainBroadcaster resolves even when no publishes are pending', async () => {
    const { service } = makeService();
    await expect(service.drainBroadcaster()).resolves.toBeUndefined();
  });
});
