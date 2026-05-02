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
import type { StateStorePort } from '../../src/core/ports/stateStore';
import { ChatService } from '../../src/periphery/adapters/http/services/ChatService';
import { FileSessionAdapter, setChatLogLockProvider } from '../../src/periphery/adapters/session/FileSessionAdapter';
import type { ChatBroadcastEnvelope } from '../../src/core/chat/MessageBroadcaster';
import type { UserContext } from '../../src/core/types/user';

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

  async getCurrentPauseSeq(turnId: string): Promise<number> {
    return this.pauseSeqByTurn.get(turnId) ?? 0;
  }

  private cycleSeqByPair = new Map<string, number>();
  async nextWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    const k = `${turnId}::${taskKey}`;
    const next = (this.cycleSeqByPair.get(k) ?? 0) + 1;
    this.cycleSeqByPair.set(k, next);
    return next;
  }
  async getCurrentWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    return this.cycleSeqByPair.get(`${turnId}::${taskKey}`) ?? 0;
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

    // chat-SSOT FE-projector contract: each cancelled card lands in
    // its own synthetic `_cancelled_:{cardId}` workerScope so the FE
    // sorts it chronologically instead of pinning it to `_main_`'s
    // first-position slot.
    expect((cancelledLines[0] as any).workerScope).toBe(
      `_cancelled_:${first.cardId}`,
    );
  });

  // ─── release-on-failure (cancelled-card-stale-NX RCA) ───────────────
  // Before the fix the NX guard was acquired BEFORE emission and never
  // released, so any throw between acquire and `appendAndBroadcast`
  // (Redis blip / chat.jsonl write race / `autoResolveStaleCancelledCards`
  // failure) stranded the key for its full 24h TTL — every subsequent
  // pause source against the same jobId returned `emitted=false` and
  // the user lost the Resume / Dismiss UI permanently.
  //
  // The fix wraps the emission block in try/finally; the lock is
  // released ONLY when the line was not actually emitted. The four
  // cases below pin the truth table for the invariant.

  it('release-on-failure (a): emission throw releases the NX guard so the next pause source can retry', async () => {
    await seedUserTurn('job-fail', 't-fail');

    // Force the chat.jsonl emission path to throw by monkey-patching
    // the private `appendAndBroadcast` method. The try/finally in
    // `appendChoicePresentedCancelled` MUST still release the NX
    // guard so a future pause source can re-acquire and retry —
    // before the fix the lock stayed held for its full 24h TTL.
    const origAppend = (service as any).appendAndBroadcast.bind(service);
    (service as any).appendAndBroadcast = async () => {
      throw new Error('simulated chat.jsonl write race');
    };

    await expect(
      service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-fail', {
        reason: 'user_stopped',
        message: 'fail',
        userContext: USER_CTX,
      }),
    ).rejects.toThrow(/simulated chat.jsonl write race/);

    // Lock released — neither the in-flight set nor the historical set
    // points to a stuck NX guard.
    expect(store.acquiredLocks.has('ant:chat:cancelled-emitted:job:job-fail')).toBe(false);
    expect(store.releasedLocks).toContain('ant:chat:cancelled-emitted:job:job-fail');

    // Restore the real emit path — second call must now acquire AND
    // emit normally with no further release calls.
    (service as any).appendAndBroadcast = origAppend;
    store.releasedLocks.length = 0;

    const retry = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-fail', {
      reason: 'user_stopped',
      message: 'retry',
      userContext: USER_CTX,
    });
    expect(retry.emitted).toBe(true);
    // Success path keeps NX held — no further release.
    expect(store.releasedLocks).not.toContain('ant:chat:cancelled-emitted:job:job-fail');
  });

  it('release-on-failure (b): NX miss path does NOT call release (preserves the multi-source idempotency contract)', async () => {
    await seedUserTurn('job-1', 't-aa');

    const first = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-1', {
      reason: 'user_stopped',
      message: 'first',
      userContext: USER_CTX,
    });
    expect(first.emitted).toBe(true);

    store.releasedLocks.length = 0;

    // NX miss — early return, MUST NOT release the key (otherwise a
    // third caller could squeeze in a duplicate cancelled card).
    const second = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-1', {
      reason: 'user_stopped',
      message: 'second',
      userContext: USER_CTX,
    });
    expect(second.emitted).toBe(false);
    expect(store.releasedLocks).not.toContain('ant:chat:cancelled-emitted:job:job-1');
    expect(store.acquiredLocks.has('ant:chat:cancelled-emitted:job:job-1')).toBe(true);
  });

  it('release-on-failure (c): success path keeps NX held — no release call', async () => {
    await seedUserTurn('job-ok', 't-ok');
    const result = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'job-ok', {
      reason: 'user_stopped',
      message: 'ok',
      userContext: USER_CTX,
    });
    expect(result.emitted).toBe(true);
    // 24h NX held to block duplicate emissions from concurrent pause sources.
    expect(store.acquiredLocks.has('ant:chat:cancelled-emitted:job:job-ok')).toBe(true);
    expect(store.releasedLocks).not.toContain('ant:chat:cancelled-emitted:job:job-ok');
  });

  it('release-on-failure (d): no-user_turn early exit returns BEFORE the NX acquire — nothing to release', async () => {
    // findTurnIdForJobWithFallback returns null → early exit before
    // the NX acquire path. The lock was never taken so the release
    // path must also be untouched.
    const result = await service.appendChoicePresentedCancelled('proj', 'feat-a', 'orphan', {
      reason: 'user_stopped',
      message: 'orphan',
      userContext: USER_CTX,
    });
    expect(result.emitted).toBe(false);
    expect(store.acquiredLocks.has('ant:chat:cancelled-emitted:job:orphan')).toBe(false);
    expect(store.releasedLocks).not.toContain('ant:chat:cancelled-emitted:job:orphan');
  });

  it('appendChoiceResolved inherits the cancelled presented line workerScope so resolved siblings share the synthetic FE section', async () => {
    await seedUserTurn('job-rs', 't-rs');
    const cancelled = await service.appendChoicePresentedCancelled(
      'proj',
      'feat-a',
      'job-rs',
      {
        reason: 'user_stopped',
        message: 'Task cancelled',
        userContext: USER_CTX,
      },
    );
    expect(cancelled.emitted).toBe(true);

    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'job-rs',
      cardId: cancelled.cardId,
      choiceSelected: 'resume',
      resolvedLabel: 'Resumed',
      userContext: USER_CTX,
    });

    const resolved = chatEventLines(store).find(
      (l): l is ChatChoiceResolvedLine =>
        l.type === 'choice_resolved' && l.cardId === cancelled.cardId,
    );
    expect(resolved).toBeDefined();
    expect((resolved as any).workerScope).toBe(`_cancelled_:${cancelled.cardId}`);
  });

  it('autoResolveStaleCancelledCards preserves the originating workerScope on the synthetic Superseded resolved line', async () => {
    // Seed two distinct jobs in the same feature so the second
    // cancellation triggers auto-resolution of the first job's stale
    // cancelled card. The synthetic `auto_stale` resolved line must
    // carry the FIRST job's workerScope so it pairs with its
    // presented sibling in the FE projector.
    await seedUserTurn('job-stale-a', 't-sa');
    await seedUserTurn('job-stale-b', 't-sb');

    const aFirst = await service.appendChoicePresentedCancelled(
      'proj',
      'feat-a',
      'job-stale-a',
      { reason: 'user_stopped', message: 'A cancelled', userContext: USER_CTX },
    );
    expect(aFirst.emitted).toBe(true);

    // New cancelled card for a different job — triggers auto-resolve
    // of every prior unresolved cancelled (excluding the new jobId).
    const bFirst = await service.appendChoicePresentedCancelled(
      'proj',
      'feat-a',
      'job-stale-b',
      { reason: 'user_stopped', message: 'B cancelled', userContext: USER_CTX },
    );
    expect(bFirst.emitted).toBe(true);

    const autoResolved = chatEventLines(store).find(
      (l): l is ChatChoiceResolvedLine =>
        l.type === 'choice_resolved' && (l as any).choiceSelected === 'auto_stale',
    );
    expect(autoResolved).toBeDefined();
    expect(autoResolved!.cardId).toBe(aFirst.cardId);
    expect((autoResolved as any).workerScope).toBe(`_cancelled_:${aFirst.cardId}`);
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
    expect(ctx).toEqual({ turnId: 't-aa', jobId: 'job-1', jobType: 'code' });
  });

  it('findTurnIdByCardId returns null when no matching presentation exists', async () => {
    await seedUserTurn('job-1', 't-aa');
    const ctx = await service.findTurnIdByCardId('proj', 'feat-a', 'missing-card', USER_CTX);
    expect(ctx).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Invariant I3 — Card-identity jobType fidelity
  //
  // The `choice_resolved` line MUST carry the same jobType as the
  // original `choice_presented` line, regardless of whether the
  // resolver was running with a different selectedJobType (the
  // zonal-dreaming-novel regression).
  // ─────────────────────────────────────────────────────────────────
  it('appendChoiceResolved preserves the cards original jobType (Invariant I3)', async () => {
    // Seed a user_turn for a PLAN job — same shape as the runtime
    // produces for `gen-plan` directives.
    const adapter = new FileSessionAdapter(featurePath, 'planner', 'proj', 'feat-a');
    await adapter.appendUserTurn(
      {
        type: 'user_turn',
        ts: new Date().toISOString(),
        jobId: 'plan-job-1',
        turnId: 't-plan',
        jobType: 'plan',
        text: 'make me a match-3 game',
      } as any,
      { skipFeature: false },
    );

    // Plan job presents a clarify card.
    await service.appendChoicePresented('proj', 'feat-a', {
      jobId: 'plan-job-1',
      cardId: 'card-clarify-plan',
      cardType: 'clarifying',
      jobType: 'plan',
      userContext: USER_CTX,
    });

    // Resolve it — caller tries to claim a different jobType (mimicking
    // the regression where FE selectedJobType drifted to 'code'). The
    // service ignores the caller's jobType and reads from the card.
    await service.appendChoiceResolved('proj', 'feat-a', {
      jobId: 'plan-job-1',
      cardId: 'card-clarify-plan',
      choiceSelected: 'submitted',
      resolvedLabel: 'Answered',
      // Intentionally NOT passing jobType — and even if we did, the
      // type signature now rejects it to make the SSOT explicit.
      userContext: USER_CTX,
    });

    const resolvedLines = chatEventLines(store).filter(
      (l): l is ChatChoiceResolvedLine => l.type === 'choice_resolved',
    );
    expect(resolvedLines).toHaveLength(1);
    expect(resolvedLines[0].cardId).toBe('card-clarify-plan');
    expect(resolvedLines[0].jobType).toBe('plan');
    expect(resolvedLines[0].jobId).toBe('plan-job-1');
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
