/**
 * Chat routes — Phase 13 integration guard.
 *
 * Phase 9 가 `/chat/triage-choice`, `/chat/eval-save`, `/chat/dismiss-choice`
 * 를 폐기하고 단일 `/chat/choice-resolved` 라우트로 통합했다. 이 파일은
 * 라우트 레벨 계약 (validation / 404 / NX dedup / DELETE cancelActive
 * 분기 / job-error → assistant_message) 을 잠근다.
 *
 * supertest 가 없으므로 진짜 Express 앱 + node:http 서버에 0번 포트를
 * 바인딩한 뒤 fetch 로 호출한다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';
import type { ChatLine } from '@ant/shared';

// Bypass the rate-limit middleware (uses rate-limit-redis, requires
// ANT_REDIS_URL which is not configured in unit-test mode).
vi.mock('../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { ChatService } from '../src/periphery/adapters/http/services/ChatService';
import { createChatRoutes } from '../src/periphery/adapters/http/routes/chat.routes';
import {
  FileSessionAdapter,
  setChatLogLockProvider,
} from '../src/periphery/adapters/session/FileSessionAdapter';
import type { StateStorePort } from '../src/core/ports/stateStore';
import type { ChatBroadcastEnvelope } from '../src/core/chat/MessageBroadcaster';
import type { PendingCardSnapshot, TurnBufferSnapshot } from '@ant/shared';

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

class FakeStateStore implements Partial<StateStorePort> {
  publishedEnvelopes: Array<{ channel: string; envelope: any }> = [];
  acquiredLocks = new Set<string>();
  releasedLocks: string[] = [];
  pauseSeqByTurn = new Map<string, number>();
  setPendingCardCalls: Array<{ sessionKey: string; turnId: string; card: PendingCardSnapshot }> = [];
  activeBuffers: TurnBufferSnapshot[] = [];

  async publish(channel: string, message: any): Promise<void> {
    this.publishedEnvelopes.push({ channel, envelope: message });
  }
  async acquireLock(key: string, _ttl: number): Promise<boolean> {
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
  async clearTurnBuffer(): Promise<void> {}
  async clearTurnBufferPendingCard(): Promise<void> {}
  async appendToTurnBuffer(): Promise<void> {}
}

const USER_CTX = { userId: 'local', organizationId: 'local', email: 'local@local' } as any;

function chatEvents(store: FakeStateStore): ChatLine[] {
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
// Tiny Express harness — no supertest dep.
// ─────────────────────────────────────────────────────────────────────

interface Harness {
  port: number;
  server: http.Server;
  url: (p: string) => string;
  call: (
    method: string,
    p: string,
    init?: { body?: unknown; query?: Record<string, string> },
  ) => Promise<{ status: number; body: any }>;
}

async function startHarness(deps: Parameters<typeof createChatRoutes>[0]): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(createChatRoutes(deps));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('listen failed');
  const port = address.port;
  const base = `http://127.0.0.1:${port}`;
  return {
    port,
    server,
    url: (p) => base + p,
    async call(method, p, init = {}) {
      const search = init.query
        ? '?' + new URLSearchParams(init.query).toString()
        : '';
      const requestInit: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      };
      const res = await fetch(base + p + search, requestInit);
      const text = await res.text();
      return {
        status: res.status,
        body: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null,
      };
    },
  };
}

async function stopHarness(h: Harness): Promise<void> {
  await new Promise<void>((resolve, reject) => h.server.close((err) => (err ? reject(err) : resolve())));
}

// ─────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────

describe('chat.routes — Phase 9/13 contract', () => {
  let tmpRoot: string;
  let featurePath: string;
  let store: FakeStateStore;
  let chatService: ChatService;
  let harness: Harness;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-chat-routes-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
    setChatLogLockProvider(null);

    store = new FakeStateStore();
    const resolverStub = {
      getFeaturePath: () => featurePath,
      getProjectPath: () => path.dirname(featurePath),
    } as any;
    chatService = new ChatService(tmpRoot, store as unknown as StateStorePort, resolverStub);
    chatService.setUserContext(USER_CTX);

    harness = await startHarness({
      chatService,
      workspaceResolver: resolverStub,
    });
  });

  afterEach(async () => {
    await stopHarness(harness);
    await chatService.cleanup();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function seedTurn(jobId: string, turnId: string, text = 'do it') {
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

  // ───────────────────────────────────────────────────────────────────
  // POST /chat/choice-resolved
  // ───────────────────────────────────────────────────────────────────

  describe('POST /chat/choice-resolved', () => {
    it('returns 400 when required fields are missing', async () => {
      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        { body: { cardId: 'x' } },
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cardId, choiceSelected, and resolvedLabel are required/);
    });

    it('returns 404 when the cardId has no originating choice_presented', async () => {
      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        {
          body: {
            cardId: 'card-missing',
            choiceSelected: 'proceed',
            resolvedLabel: 'Proceeded',
          },
        },
      );
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/choice card not found/);
    });

    it('happy path — appends choice_resolved + emits SSE + Pub/Sub fanout', async () => {
      await seedTurn('job-1', 't-aa');
      await chatService.appendChoicePresented('proj', 'feat-a', {
        jobId: 'job-1',
        cardId: 'card-1',
        cardType: 'clarifying',
        userContext: USER_CTX,
      });

      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        {
          body: {
            cardId: 'card-1',
            choiceSelected: 'answered',
            resolvedLabel: 'Answered',
            answer: { primary: 'A' },
          },
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.resolved).toBe(true);

      const resolved = chatEvents(store).find((l) => l.type === 'choice_resolved') as any;
      expect(resolved?.cardId).toBe('card-1');
      expect(resolved?.answer).toEqual({ primary: 'A' });

      const choiceChannel = 'ant:chat:choice-resolved:local:local:proj/feat-a';
      const fanout = store.publishedEnvelopes.filter((p) => p.channel === choiceChannel);
      expect(fanout).toHaveLength(1);
      expect(fanout[0].envelope.cardId).toBe('card-1');
    });

    it('NX dedup — second call for the same cardId returns resolved=false and emits exactly once', async () => {
      await seedTurn('job-1', 't-aa');
      await chatService.appendChoicePresented('proj', 'feat-a', {
        jobId: 'job-1',
        cardId: 'card-dedup',
        cardType: 'triage_choice',
        userContext: USER_CTX,
      });

      const a = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        { body: { cardId: 'card-dedup', choiceSelected: 'proceed', resolvedLabel: 'Proceeded' } },
      );
      const b = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        { body: { cardId: 'card-dedup', choiceSelected: 'proceed', resolvedLabel: 'Proceeded' } },
      );

      expect(a.body.resolved).toBe(true);
      expect(b.body.resolved).toBe(false);
      const resolvedLines = chatEvents(store).filter((l) => l.type === 'choice_resolved');
      expect(resolvedLines).toHaveLength(1);
    });

    it('eval_save card with answer.evalType + content writes the artifact and stamps savedPath into answer', async () => {
      await seedTurn('job-1', 't-aa');
      await chatService.appendChoicePresented('proj', 'feat-a', {
        jobId: 'job-1',
        cardId: 'card-eval',
        cardType: 'eval_save',
        userContext: USER_CTX,
      });

      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/choice-resolved',
        {
          body: {
            cardId: 'card-eval',
            choiceSelected: 'save',
            resolvedLabel: 'Saved',
            answer: { evalType: 'spec-review', content: '# Eval\n\ngood' },
          },
        },
      );
      expect(res.status).toBe(200);

      // Persisted as outputs/evals/spec-review/eval-...md
      const files = await fs.readdir(path.join(featurePath, 'outputs', 'evals', 'spec-review'));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^eval-.*\.md$/);

      const written = await fs.readFile(
        path.join(featurePath, 'outputs', 'evals', 'spec-review', files[0]),
        'utf-8',
      );
      expect(written).toContain('good');

      // savedPath stamped onto the choice_resolved.answer
      const resolved = chatEvents(store).find((l) => l.type === 'choice_resolved') as any;
      expect(resolved?.answer?.savedPath).toMatch(/outputs\/evals\/spec-review\//);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // DELETE /chat/messages
  // ───────────────────────────────────────────────────────────────────

  describe('DELETE /chat/messages', () => {
    it('default (cancelActive=false) collapses chat.jsonl and emits events_cleared(scope=chat)', async () => {
      await seedTurn('job-1', 't-aa');
      await chatService.appendAssistantMessage('proj', 'feat-a', 'before clear', {
        jobId: 'job-1',
        userContext: USER_CTX,
      });

      const res = await harness.call(
        'DELETE',
        '/projects/proj/features/feat-a/chat/messages',
      );
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const cleared = broadcastDataByType<{ scope: string }>(store, 'events_cleared');
      expect(cleared.some((c) => c.scope === 'chat')).toBe(true);

      // collapse: events list is empty after the clear.
      const events = await chatService.loadEventsAsync('proj', 'feat-a', USER_CTX);
      expect(events).toHaveLength(0);
    });

    it('cancelActive=true invokes finalizeActiveJob before clearing the log', async () => {
      const finalizeCalls: Array<{ projectId: string; featureName: string }> = [];
      await stopHarness(harness);
      harness = await startHarness({
        chatService,
        workspaceResolver: { getFeaturePath: () => featurePath } as any,
        finalizeActiveJob: async (projectId, featureName) => {
          finalizeCalls.push({ projectId, featureName });
        },
      });

      await seedTurn('job-running', 't-aa');

      const res = await harness.call(
        'DELETE',
        '/projects/proj/features/feat-a/chat/messages',
        { query: { cancelActive: 'true' } },
      );
      expect(res.status).toBe(200);
      expect(finalizeCalls).toEqual([{ projectId: 'proj', featureName: 'feat-a' }]);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /chat/job-error
  // ───────────────────────────────────────────────────────────────────

  describe('POST /chat/job-error', () => {
    it('emits a single assistant_message line with the failure summary', async () => {
      await seedTurn('job-1', 't-aa');

      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/job-error',
        {
          body: {
            jobId: 'job-1',
            errorMessage: 'something exploded',
            errorDetails: { reason: 'oom' },
          },
        },
      );
      expect(res.status).toBe(200);

      const lines = chatEvents(store);
      const failure = lines.find(
        (l): l is Extract<ChatLine, { type: 'assistant_message' }> =>
          l.type === 'assistant_message',
      );
      expect(failure).toBeDefined();
      expect(failure?.text).toContain('something exploded');
      expect(failure?.text).toContain('oom');
    });

    it('returns 400 when jobId or errorMessage is missing', async () => {
      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/job-error',
        { body: { jobId: 'job-1' } },
      );
      expect(res.status).toBe(400);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /chat/user-message — turnId minting + optimistic SSE
  // ───────────────────────────────────────────────────────────────────

  describe('POST /chat/user-message', () => {
    it('mints a turnId, returns it in the response, and emits chat_event_appended SSE without writing chat.jsonl', async () => {
      const res = await harness.call(
        'POST',
        '/projects/proj/features/feat-a/chat/user-message',
        { body: { content: 'hello world', jobType: 'code' } },
      );
      expect(res.status).toBe(200);
      expect(res.body.turnId).toMatch(/^t-/);
      expect(res.body.messageId).toBe(`user-${res.body.turnId}`);

      const lines = chatEvents(store);
      expect(lines.find((l) => l.type === 'user_turn' && (l as any).text === 'hello world')).toBeDefined();

      // No durable chat.jsonl write yet (the worker's recordUserTurn does that).
      const chatJsonl = path.join(featurePath, 'sessions', 'chat.jsonl');
      await expect(fs.access(chatJsonl)).rejects.toThrow();
    });
  });
});
