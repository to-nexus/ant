/**
 * ChatService — Phase 9 contract guard for the HTTP-side chat emission
 * facade (chat-SSOT §5).
 *
 * Locks the invariants that:
 *   (a) `appendUserTurn` emits a `chat_event_appended` SSE only — the
 *       durable user_turn line is written by the worker's
 *       `recordUserTurn` (no duplicate disk write here).
 *   (b) `appendAssistantMessage` / `appendChoicePresented` /
 *       `appendChoiceResolved` write a chat.jsonl line via
 *       `FileSessionAdapter` AND emit a `chat_event_appended` SSE.
 *   (c) `appendChoicePresentedCancelled` is NX-idempotent — the second
 *       call for the same jobId no-ops via `acquireLock`.
 *   (d) `appendChoiceResolved` is single-shot via the per-cardId NX
 *       flag and publishes the choice-resolved Pub/Sub envelope.
 *   (e) `clearEventsAsync` collapses the chat log + emits an
 *       `events_cleared` SSE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type {
  ChatLine,
  ChatChoicePresentedLine,
  ChatChoiceResolvedLine,
  PendingCardSnapshot,
  TurnBufferSnapshot,
} from '@ant/shared';
import type { StateStorePort } from '../src/core/ports/stateStore';
import { ChatService } from '../src/periphery/adapters/http/services/ChatService';
import { FileSessionAdapter, setChatLogLockProvider } from '../src/periphery/adapters/session/FileSessionAdapter';
import type { ChatBroadcastEnvelope } from '../src/core/chat/MessageBroadcaster';
import type { UserContext } from '../src/core/types/user';

// ─────────────────────────────────────────────────────────────────────
// Test doubles
// ─────────────────────────────────────────────────────────────────────

class FakeStateStore implements Partial<StateStorePort> {
  publishedEnvelopes: Array<{ channel: string; envelope: any }> = [];
  acquiredLocks = new Set<string>();
  releasedLocks: string[] = [];
  /** Toggle to force `acquireLock` to return false (NX miss simulation). */
  failNextAcquire = false;
  activeBuffers: TurnBufferSnapshot[] = [];
  setPendingCardCalls: Array<{ sessionKey: string; turnId: string; card: PendingCardSnapshot }> = [];
  pauseSeqByTurn = new Map<string, number>();

  async publish(channel: string, message: any): Promise<void> {
    this.publishedEnvelopes.push({ channel, envelope: message });
  }

  async acquireLock(key: string, _ttl: number): Promise<boolean> {
    if (this.failNextAcquire) {
      this.failNextAcquire = false;
      return false;
    }
    if (this.acquiredLocks.has(key)) return false;
    this.acquiredLocks.add(key);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.releasedLocks.push(key);
    this.acquiredLocks.delete(key);
  }

  async listActiveTurnBuffers(_sessionKey: string): Promise<TurnBufferSnapshot[]> {
    return this.activeBuffers;
  }

  async clearAllTurnBuffersForFeature(_sessionKey: string): Promise<void> {
    this.activeBuffers = [];
  }

  async setTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    _workerScope: string | undefined,
    card: PendingCardSnapshot,
  ): Promise<void> {
    this.setPendingCardCalls.push({ sessionKey, turnId, card });
  }

  async nextPauseSeq(turnId: string): Promise<number> {
    const next = (this.pauseSeqByTurn.get(turnId) ?? 0) + 1;
    this.pauseSeqByTurn.set(turnId, next);
    return next;
  }

  async clearTurnBuffer(): Promise<void> {}
  async clearTurnBufferPendingCard(): Promise<void> {}
  async appendToTurnBuffer(): Promise<void> {}
}

const USER_CTX: UserContext = {
  userId: 'local',
  organizationId: 'local',
  email: 'local@local',
} as any;

function chatEventLines(store: FakeStateStore): ChatLine[] {
  return store.publishedEnvelopes
    .map((p) => p.envelope as ChatBroadcastEnvelope)
    .filter((e) => e?.type === 'chat')
    .map((e) => e.data)
    .filter((d: any) => d?.type === 'chat_event_appended')
    .map((d: any) => d.event as ChatLine);
}

function broadcastDataByType<T = any>(store: FakeStateStore, type: string): T[] {
  return store.publishedEnvelopes
    .map((p) => p.envelope as ChatBroadcastEnvelope)
    .filter((e) => e?.type === 'chat')
    .map((e) => e.data)
    .filter((d: any) => d?.type === type) as T[];
}

// ─────────────────────────────────────────────────────────────────────
// Fixture
// ─────────────────────────────────────────────────────────────────────

describe('ChatService — Phase 9 emission contract', () => {
  let tmpRoot: string;
  let featurePath: string;
  let store: FakeStateStore;
  let service: ChatService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-chatsvc-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });

    setChatLogLockProvider(null);
    store = new FakeStateStore();
    const resolverStub = {
      getFeaturePath: () => featurePath,
      getProjectPath: () => path.dirname(featurePath),
    } as any;
    service = new ChatService(tmpRoot, store as unknown as StateStorePort, resolverStub);
  });

  afterEach(async () => {
    await service.cleanup();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  // Convenience: seed a feature.jsonl user_turn so findTurnIdForJob
  // can resolve the (jobId, turnId) pairing the persistence helpers
  // depend on.
  async function seedUserTurn(jobId: string, turnId: string, text = 'do it') {
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: new Date().toISOString(),
        jobId,
        turnId,
        jobType: 'code',
        text,
      } as any,
      { skipFeature: false },
    );
  }

  it('appendUserTurn emits chat_event_appended SSE without writing chat.jsonl', async () => {
    await service.appendUserTurn('proj', 'feat-a', 'hello world', 't-aa', 'job-1', USER_CTX);
    const lines = chatEventLines(store);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('user_turn');
    expect((lines[0] as any).text).toBe('hello world');

    // No durable disk write — the worker's recordUserTurn owns that.
    const chatJsonl = path.join(featurePath, 'sessions', 'chat.jsonl');
    await expect(fs.access(chatJsonl)).rejects.toThrow();
  });

  it('appendAssistantMessage writes chat.jsonl AND broadcasts the line', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendAssistantMessage('proj', 'feat-a', 'final answer', {
      jobId: 'job-1',
      userContext: USER_CTX,
    });

    const lines = chatEventLines(store);
    const final = lines.filter((l) => l.type === 'assistant_message');
    expect(final).toHaveLength(1);
    expect((final[0] as any).text).toBe('final answer');
    expect(final[0].turnId).toBe('t-aa');

    const chatJsonl = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    const parsed = chatJsonl
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const persisted = parsed.find((p: any) => p.type === 'assistant_message');
    expect(persisted?.text).toBe('final answer');
  });

  it('appendChoicePresented + appendChoiceResolved pair via cardId', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-1',
      cardType: 'triage_choice',
      prompt: 'pick',
      payload: { foo: 'bar' },
      userContext: USER_CTX,
    });

    const presented = chatEventLines(store).find(
      (l): l is ChatChoicePresentedLine => l.type === 'choice_presented',
    );
    expect(presented?.cardId).toBe('card-1');
    expect(presented?.payload).toEqual({ foo: 'bar' });

    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-1',
      choiceSelected: 'proceed',
      resolvedLabel: 'Proceeded',
      userContext: USER_CTX,
    });

    const resolved = chatEventLines(store).find(
      (l): l is ChatChoiceResolvedLine => l.type === 'choice_resolved',
    );
    expect(resolved?.cardId).toBe('card-1');
    expect(resolved?.choiceSelected).toBe('proceed');
    expect(resolved?.resolvedLabel).toBe('Proceeded');
  });

  it('appendChoiceResolved is NX-idempotent — second call no-ops', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-dup',
      cardType: 'triage_choice',
      userContext: USER_CTX,
    });

    const first = await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-dup',
      choiceSelected: 'proceed',
      resolvedLabel: 'Proceeded',
      userContext: USER_CTX,
    });
    expect(first.resolved).toBe(true);

    const second = await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-dup',
      choiceSelected: 'proceed',
      resolvedLabel: 'Proceeded',
      userContext: USER_CTX,
    });
    expect(second.resolved).toBe(false);

    const resolvedLines = chatEventLines(store).filter((l) => l.type === 'choice_resolved');
    expect(resolvedLines).toHaveLength(1);
  });

  it('appendChoicePresentedCancelled is NX-guarded per jobId', async () => {
    await seedUserTurn('job-1', 't-aa');

    const first = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-1', {
      reason: 'user_stopped',
      message: 'Task cancelled',
      userContext: USER_CTX,
    });
    expect(first.emitted).toBe(true);
    // chat-SSOT §7 — cardId carries pauseSeq for uniqueness across cycles.
    expect(first.cardId).toMatch(/^cancelled-t-aa-job-1-/);

    const second = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-1', {
      reason: 'user_stopped',
      message: 'Task cancelled',
      userContext: USER_CTX,
    });
    expect(second.emitted).toBe(false);

    // Only one cancelled card written.
    const cancelledLines = chatEventLines(store).filter(
      (l) => l.type === 'choice_presented' && (l as any).cardType === 'cancelled',
    );
    expect(cancelledLines).toHaveLength(1);
  });

  it('appendChoiceResolved publishes the choice-resolved Pub/Sub envelope', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-pub',
      cardType: 'clarifying',
      userContext: USER_CTX,
    });
    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-pub',
      choiceSelected: 'answered',
      resolvedLabel: 'Answered',
      answer: { reply: 'yes' },
      userContext: USER_CTX,
    });

    const choiceChannel = 'ant:chat:choice-resolved:local:local:proj/feat-a';
    const choiceMsgs = store.publishedEnvelopes.filter((p) => p.channel === choiceChannel);
    expect(choiceMsgs).toHaveLength(1);
    expect(choiceMsgs[0].envelope).toMatchObject({
      cardId: 'card-pub',
      choiceSelected: 'answered',
      resolvedLabel: 'Answered',
      answer: { reply: 'yes' },
    });
  });

  it('clearEventsAsync emits events_cleared SSE', async () => {
    await service.clearEventsAsync('proj', 'feat-a', 'chat', USER_CTX);
    const cleared = broadcastDataByType<{ scope: string }>(store, 'events_cleared');
    expect(cleared).toHaveLength(1);
    expect(cleared[0].scope).toBe('chat');
  });

  it('loadEventsAsync rebuilds chat.jsonl events from disk', async () => {
    await seedUserTurn('job-1', 't-aa', 'hello');
    await service.appendAssistantMessage('proj', 'feat-a', 'world', {
      jobId: 'job-1',
      userContext: USER_CTX,
    });

    const events = await service.loadEventsAsync('proj', 'feat-a', USER_CTX);
    const types = events.map((e) => e.type);
    expect(types).toContain('user_turn');
    expect(types).toContain('assistant_message');
  });

  it('findTurnIdByCardId locates the originating choice_presented line', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-locate',
      cardType: 'eval_save',
      userContext: USER_CTX,
    });

    const ctx = await service.findTurnIdByCardId('proj', 'feat-a', 'card-locate', USER_CTX);
    expect(ctx).toEqual({ turnId: 't-aa', jobId: 'job-1' });
  });

  it('findTurnIdByCardId returns null when no matching presentation exists', async () => {
    await seedUserTurn('job-1', 't-aa');
    const ctx = await service.findTurnIdByCardId('proj', 'feat-a', 'missing-card', USER_CTX);
    expect(ctx).toBeNull();
  });

  it('appendChatStatus persists chat_status line + broadcasts SSE', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChatStatus('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'cmd-1',
      statusType: 'command',
      metadata: { command: 'ls', exitCode: 0 },
      userContext: USER_CTX,
    });

    const lines = chatEventLines(store);
    const status = lines.find((l) => l.type === 'chat_status');
    expect(status).toBeDefined();
    expect((status as any).cardId).toBe('cmd-1');
    expect((status as any).statusType).toBe('command');
    expect((status as any).metadata.exitCode).toBe(0);

    const onDisk = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    expect(onDisk).toContain('"chat_status"');
    expect(onDisk).toContain('"command"');
  });

  it('appendThinking persists assistant_thinking line + broadcasts SSE', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendThinking('proj', 'feat-a', 'reasoning step', {
      jobId: 'job-1',
      cardId: 'thought-1',
      userContext: USER_CTX,
    });

    const lines = chatEventLines(store);
    const thinking = lines.find((l) => l.type === 'assistant_thinking');
    expect(thinking).toBeDefined();
    expect((thinking as any).text).toBe('reasoning step');
    expect((thinking as any).cardId).toBe('thought-1');
  });

  it('autoResolveStaleCancelledCards superseded prior cancelled cards on new emission', async () => {
    // Seed two prior turns with cancelled cards still unresolved.
    await seedUserTurn('job-old', 't-old');
    await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-old', {
      reason: 'user_stopped',
      message: 'Old task cancelled',
      userContext: USER_CTX,
    });

    // Bump the per-job NX flag for the *new* job too: the helper writes
    // `auto_stale` choice_resolved lines for prior cards, then emits the
    // new cancelled card. We simulate the gap by clearing the
    // `cancelled-emitted:job:job-old` lock so the old card stays open.
    store.acquiredLocks.delete('ant:chat:cancelled-emitted:job:job-old');

    await seedUserTurn('job-new', 't-new');
    const result = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-new', {
      reason: 'user_stopped',
      message: 'New task cancelled',
      userContext: USER_CTX,
    });
    expect(result.emitted).toBe(true);

    // Prior card should have been auto-resolved (auto_stale).
    const resolvedLines = chatEventLines(store).filter(
      (l) => l.type === 'choice_resolved' && (l as any).choiceSelected === 'auto_stale',
    );
    expect(resolvedLines.length).toBeGreaterThanOrEqual(1);
  });

  it('clearEventsAsync(scope=chat) collapses chat.jsonl in place', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendAssistantMessage('proj', 'feat-a', 'before clear', {
      jobId: 'job-1',
      userContext: USER_CTX,
    });

    const before = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    expect(before).toContain('before clear');

    await service.clearEventsAsync('proj', 'feat-a', 'chat', USER_CTX);

    const after = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    // collapseChatLog marks lines collapsed=true rather than truncating;
    // the live read filters them, so the visible event list is empty.
    const events = await service.loadEventsAsync('proj', 'feat-a', USER_CTX);
    expect(events).toHaveLength(0);
    void after;

    const cleared = broadcastDataByType<{ scope: string }>(store, 'events_cleared');
    expect(cleared.some((c) => c.scope === 'chat')).toBe(true);
  });

  it('clearEventsAsync(scope=full) skips disk collapse but still drops turn buffers + emits SSE', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendAssistantMessage('proj', 'feat-a', 'before reset', {
      jobId: 'job-1',
      userContext: USER_CTX,
    });

    await service.clearEventsAsync('proj', 'feat-a', 'full', USER_CTX);

    // Disk content remains (caller physically unlinks files).
    const onDisk = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    expect(onDisk).toContain('before reset');

    const cleared = broadcastDataByType<{ scope: string }>(store, 'events_cleared');
    expect(cleared.some((c) => c.scope === 'full')).toBe(true);
  });

  it('loadTurnBuffersAsync surfaces active buffers keyed by turnId:workerScope', async () => {
    store.activeBuffers = [
      { turnId: 't-1', workerScope: '_main_', text: 'hi', pendingCards: {} },
      { turnId: 't-2', workerScope: 'worker-1', thinking: 'pondering', pendingCards: {} },
    ];

    const map = await service.loadTurnBuffersAsync('proj', 'feat-a', USER_CTX);
    expect(Object.keys(map).sort()).toEqual(['t-1:_main_', 't-2:worker-1']);
    expect(map['t-1:_main_'].text).toBe('hi');
    expect(map['t-2:worker-1'].thinking).toBe('pondering');
  });

  it('streamTextChunk + registerPendingCard emit streaming_delta SSE', async () => {
    await service.streamTextChunk('proj', 'feat-a', {
      turnId: 't-aa',
      chunk: 'hello',
      userContext: USER_CTX,
    });
    await service.registerPendingCard('proj', 'feat-a', {
      turnId: 't-aa',
      cardId: 'spinner-1',
      statusType: 'reading',
      metadata: { filePath: 'src/foo.ts' },
      userContext: USER_CTX,
    });

    const deltas = broadcastDataByType<{ kind: string; cardId?: string; chunk: string }>(
      store,
      'streaming_delta',
    );
    expect(deltas.some((d) => d.kind === 'text' && d.chunk === 'hello')).toBe(true);
    expect(
      deltas.some((d) => d.kind === 'card_output' && d.cardId === 'spinner-1' && d.chunk === ''),
    ).toBe(true);
    expect(store.setPendingCardCalls).toHaveLength(1);
    expect(store.setPendingCardCalls[0].card.cardId).toBe('spinner-1');
  });

  it('appendChoiceResolved with answer payload persists and broadcasts the answer', async () => {
    await seedUserTurn('job-1', 't-aa');
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-answer',
      cardType: 'clarifying',
      userContext: USER_CTX,
    });

    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: 'card-answer',
      choiceSelected: 'answered',
      resolvedLabel: 'Answered',
      answer: { primary: 'A', notes: 'looks good' },
      userContext: USER_CTX,
    });

    const resolved = chatEventLines(store).find(
      (l): l is ChatChoiceResolvedLine => l.type === 'choice_resolved',
    );
    expect(resolved?.answer).toEqual({ primary: 'A', notes: 'looks good' });

    const onDisk = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    const persisted = onDisk
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .find((p: any) => p.type === 'choice_resolved');
    expect(persisted?.answer).toEqual({ primary: 'A', notes: 'looks good' });
  });

  it('findTurnIdForJob resolves via feature.jsonl user_turn lines', async () => {
    await seedUserTurn('job-A', 't-aa');
    await seedUserTurn('job-B', 't-bb');

    expect(await service.findTurnIdForJob('proj', 'feat-a', 'job-A', USER_CTX)).toBe('t-aa');
    expect(await service.findTurnIdForJob('proj', 'feat-a', 'job-B', USER_CTX)).toBe('t-bb');
    expect(await service.findTurnIdForJob('proj', 'feat-a', 'job-missing', USER_CTX)).toBeNull();
  });

  it('appendChoicePresentedCancelled returns emitted=false when no user_turn anchors the cancelled card', async () => {
    // No seedUserTurn for this job — findTurnIdForJob will return null.
    const result = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'orphan-job', {
      reason: 'user_stopped',
      message: 'orphan cancel',
      userContext: USER_CTX,
    });
    expect(result.emitted).toBe(false);
    expect(result.cardId).toBe('');
    const cancelledLines = chatEventLines(store).filter(
      (l) => l.type === 'choice_presented' && (l as any).cardType === 'cancelled',
    );
    expect(cancelledLines).toHaveLength(0);
  });

  it('appendUserTurn carries actionMetadata into the broadcast line', async () => {
    await service.appendUserTurn(
      'proj',
      'feat-a',
      'do it',
      't-meta',
      'job-1',
      USER_CTX,
      { intent: 'edit', target: 'src/foo.ts' } as any,
    );
    const lines = chatEventLines(store);
    const userTurn = lines.find((l) => l.type === 'user_turn');
    expect((userTurn as any).actionMetadata).toEqual({ intent: 'edit', target: 'src/foo.ts' });
  });

  it('appendChoiceResolved releases the per-job cancelled NX flag', async () => {
    await seedUserTurn('job-1', 't-aa');
    const cancelled = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-1', {
      reason: 'user_stopped',
      message: 'Task cancelled',
      userContext: USER_CTX,
    });

    expect(store.acquiredLocks.has('ant:chat:cancelled-emitted:job:job-1')).toBe(true);

    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-1',
      cardId: cancelled.cardId,
      choiceSelected: 'resume',
      resolvedLabel: 'Resumed',
      userContext: USER_CTX,
    });

    expect(store.releasedLocks).toContain('ant:chat:cancelled-emitted:job:job-1');
  });

  it('cancelled cardId carries pauseSeq so consecutive cycles do not collide on the per-cardId NX flag', async () => {
    // Cycle 1: cancel → resume on the same job.
    await seedUserTurn('job-cyc', 't-cyc');
    const cycle1 = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-cyc', {
      reason: 'user_stopped',
      message: 'Cancelled',
      userContext: USER_CTX,
    });
    expect(cycle1.emitted).toBe(true);

    const r1 = await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-cyc',
      cardId: cycle1.cardId,
      choiceSelected: 'resume',
      resolvedLabel: 'Resumed',
      userContext: USER_CTX,
    });
    expect(r1.resolved).toBe(true);

    // Cycle 2: same job paused again — must mint a fresh cardId so
    // the per-cardId NX (`getChoiceResolvedNXKey`) does not collide.
    const cycle2 = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-cyc', {
      reason: 'user_stopped',
      message: 'Cancelled again',
      userContext: USER_CTX,
    });
    expect(cycle2.emitted).toBe(true);
    expect(cycle2.cardId).not.toBe(cycle1.cardId);

    const r2 = await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-cyc',
      cardId: cycle2.cardId,
      choiceSelected: 'resume',
      resolvedLabel: 'Resumed',
      userContext: USER_CTX,
    });
    expect(r2.resolved).toBe(true);

    const resolvedLines = chatEventLines(store).filter((l) => l.type === 'choice_resolved');
    expect(resolvedLines.length).toBeGreaterThanOrEqual(2);
  });

  it('resolveAllCancelledForJob walks chat.jsonl and resolves every unresolved cancelled card for the jobId', async () => {
    await seedUserTurn('job-multi', 't-multi');

    // First cancellation cycle.
    const cycle1 = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-multi', {
      reason: 'user_stopped',
      message: 'Cancelled 1',
      userContext: USER_CTX,
    });
    expect(cycle1.emitted).toBe(true);

    // Release the per-job NX flag (simulates the user clicking Resume,
    // then the job pausing again before any choice_resolved was written).
    store.acquiredLocks.delete('ant:chat:cancelled-emitted:job:job-multi');

    const cycle2 = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-multi', {
      reason: 'user_stopped',
      message: 'Cancelled 2',
      userContext: USER_CTX,
    });
    expect(cycle2.emitted).toBe(true);
    expect(cycle2.cardId).not.toBe(cycle1.cardId);

    // resolveAllCancelledForJob must resolve BOTH cards.
    const count = await service.resolveAllCancelledForJob(
      'proj',
      'feat-a',
      'job-multi',
      { userContext: USER_CTX },
    );
    expect(count).toBeGreaterThanOrEqual(2);

    const resolvedCardIds = chatEventLines(store)
      .filter((l): l is ChatChoiceResolvedLine => l.type === 'choice_resolved')
      .map((l) => l.cardId);
    expect(resolvedCardIds).toContain(cycle1.cardId);
    expect(resolvedCardIds).toContain(cycle2.cardId);
  });

  it('appendAssistantMessage falls back to chat.jsonl for ask/inline-ask jobType (skipFeature=true)', async () => {
    // Seed an ask-style user_turn — chat.jsonl only, no feature.jsonl.
    const adapter = new FileSessionAdapter(featurePath, 'architect', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: new Date().toISOString(),
        jobId: 'ask-job',
        turnId: 't-ask',
        jobType: 'ask',
        text: 'what?',
      } as any,
      { skipFeature: true },
    );

    await service.appendAssistantMessage('proj', 'feat-a', 'reply', {
      jobId: 'ask-job',
      userContext: USER_CTX,
    });

    const lines = chatEventLines(store);
    const reply = lines.find((l) => l.type === 'assistant_message' && (l as any).text === 'reply');
    expect(reply).toBeDefined();
    expect(reply?.turnId).toBe('t-ask');
  });
});
