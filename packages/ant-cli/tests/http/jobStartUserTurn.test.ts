/**
 * Job-start routes own the submit-time `user_turn`.
 *
 * `ChatService.appendUserTurn` is the only writer that both persists the UI
 * copy AND broadcasts `chat_event_appended`; the worker's `recordUserTurn`
 * writes the same line with no broadcaster. A job started without passing
 * through `ensureSubmitUserTurn` therefore streams every assistant line live
 * while the user bubble stays invisible until the next SSE reconnect — the
 * API-started-job defect.
 *
 * This file locks the truth table for that axis: route × (turn already owned?)
 * × (directive present?) → { user_turn written, broadcast, seedTurnId forwarded }.
 * Same no-supertest harness as `chatRoutes.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import http from 'node:http';
import express from 'express';
import type { ChatLine } from '@ant/shared';

vi.mock('../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { ChatService } from '../../src/periphery/adapters/http/services/ChatService';
import { createJobRoutes } from '../../src/periphery/adapters/http/routes/job.routes';
import { setChatLogLockProvider } from '../../src/periphery/adapters/session/FileSessionAdapter';
import type { StateStorePort } from '../../src/core/ports/stateStore';
import type { ChatBroadcastEnvelope } from '../../src/core/chat/MessageBroadcaster';
import type { ExecuteJobParams } from '../../src/core/ports/http';
import { DIRECTIVE_MAX_CHARS } from '../../src/periphery/adapters/http/routes/helpers/submitUserTurn';
import { executeJobSchema, chatUserMessageSchema } from '../../src/periphery/adapters/http/middleware/validateBody';

const USER_CTX = { userId: 'local', organizationId: 'local', email: 'local@local' } as any;

/** Minimal StateStore: chat broadcast sink + the job list `/execute` gates on. */
class FakeStateStore implements Partial<StateStorePort> {
  publishedEnvelopes: Array<{ channel: string; envelope: any }> = [];
  jobsByFeature: Array<{ jobId: string; status: string; type: string }> = [];
  kv = new Map<string, string>();

  async publish(channel: string, message: any): Promise<void> {
    this.publishedEnvelopes.push({ channel, envelope: message });
  }
  async listJobsByFeature(): Promise<any[]> {
    return this.jobsByFeature;
  }
  async acquireLock(): Promise<boolean> { return true; }
  async releaseLock(): Promise<void> {}
  async setKeyWithTTL(key: string, value: string): Promise<void> { this.kv.set(key, value); }
  async getKey(key: string): Promise<string | null> { return this.kv.get(key) ?? null; }
  async nextPauseSeq(): Promise<number> { return 1; }
  async getCurrentPauseSeq(): Promise<number> { return 0; }
  async nextWorkerCycleSeq(): Promise<number> { return 1; }
  async getCurrentWorkerCycleSeq(): Promise<number> { return 0; }
  async listActiveTurnBuffers(): Promise<any[]> { return []; }
  async clearTurnBuffer(): Promise<void> {}
  async clearTurnBufferPendingCard(): Promise<void> {}
  async setTurnBufferPendingCard(): Promise<void> {}
  async appendToTurnBuffer(): Promise<void> {}
}

function broadcastLines(store: FakeStateStore): ChatLine[] {
  return store.publishedEnvelopes
    .map((p) => p.envelope as ChatBroadcastEnvelope)
    .filter((e) => e?.type === 'chat')
    .map((e) => e.data)
    .filter((d: any) => d?.type === 'chat_event_appended')
    .map((d: any) => d.event as ChatLine);
}

interface Harness {
  server: http.Server;
  call: (method: string, p: string, body?: unknown) => Promise<{ status: number; body: any }>;
}

async function startHarness(deps: Parameters<typeof createJobRoutes>[0]): Promise<Harness> {
  const app = express();
  // Mirrors the production AUTHENTICATED parser budget (50 MiB) — the
  // actionMetadata byte-budget rows need a body larger than express's 100 KB
  // default to reach the schema at all.
  app.use(express.json({ limit: '60mb' }));
  app.use(createJobRoutes(deps));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('listen failed');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    server,
    async call(method, p, body) {
      const res = await fetch(base + p, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return {
        status: res.status,
        body: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null,
      };
    },
  };
}

describe('job-start routes — submit-time user_turn ownership', () => {
  let tmpRoot: string;
  let featurePath: string;
  let store: FakeStateStore;
  let chatService: ChatService;
  let harness: Harness;
  let executeCalls: ExecuteJobParams[];

  const EXECUTE_URL = '/projects/proj/features/feat-a/execute';
  const INLINE_ASK_URL = '/projects/proj/features/feat-a/inline-ask';

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-job-user-turn-'));
    featurePath = path.join(tmpRoot, 'features', 'feat-a');
    await fs.mkdir(path.join(featurePath, 'sessions'), { recursive: true });
    setChatLogLockProvider(null);

    store = new FakeStateStore();
    executeCalls = [];
    const resolverStub = {
      getFeaturePath: () => featurePath,
      getProjectPath: () => path.dirname(featurePath),
    } as any;
    chatService = new ChatService(tmpRoot, store as unknown as StateStorePort, resolverStub);
    chatService.setUserContext(USER_CTX);

    harness = await startHarness({
      workspaceResolver: resolverStub,
      executeJob: async (params: ExecuteJobParams) => {
        executeCalls.push(params);
        return { success: true, jobId: 'job-1' };
      },
      cleanupJobState: async () => {},
      workflowStateService: {} as any,
      chatService,
      stateStore: store as unknown as StateStorePort,
      stateTracker: {} as any,
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      harness.server.close((err) => (err ? reject(err) : resolve())),
    );
    await chatService.cleanup();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  /** Durable chat.jsonl lines. */
  async function chatLog(): Promise<any[]> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(featurePath, 'sessions', 'chat.jsonl'), 'utf-8');
    } catch {
      return [];
    }
    return raw.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
  }

  async function userTurns(): Promise<any[]> {
    return (await chatLog()).filter((l) => l.type === 'user_turn');
  }

  // ───────────────────────────────────────────────────────────────────
  // POST .../execute
  // ───────────────────────────────────────────────────────────────────

  it('unowned turn + directive → records it, broadcasts it, and forwards it as seedTurnId', async () => {
    const res = await harness.call('POST', EXECUTE_URL, {
      task: 'code',
      agent: 'architect',
      overrideDirective: 'build the login page',
    });

    expect(res.status).toBe(200);
    expect(res.body.turnId).toBeTruthy();

    const turns = await userTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('build the login page');
    expect(turns[0].turnId).toBe(res.body.turnId);
    expect(turns[0].jobType).toBe('code');

    const broadcast = broadcastLines(store).filter((l) => l.type === 'user_turn');
    expect(broadcast).toHaveLength(1);
    expect((broadcast[0] as any).turnId).toBe(res.body.turnId);

    // The worker must reuse the id, or feature.jsonl and chat.jsonl split.
    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0].seedTurnId).toBe(res.body.turnId);
  });

  it('owned turn (seedTurnId from /chat/user-message) → no second write, id forwarded verbatim', async () => {
    const res = await harness.call('POST', EXECUTE_URL, {
      task: 'code',
      agent: 'architect',
      overrideDirective: 'build the login page',
      seedTurnId: 't-owned01',
    });

    expect(res.status).toBe(200);
    expect(await userTurns()).toHaveLength(0);
    expect(broadcastLines(store).filter((l) => l.type === 'user_turn')).toHaveLength(0);
    expect(executeCalls[0].seedTurnId).toBe('t-owned01');
  });

  it('no directive (file-driven job) → no turn is minted', async () => {
    const res = await harness.call('POST', EXECUTE_URL, { task: 'code', agent: 'architect' });

    expect(res.status).toBe(200);
    expect(res.body.turnId).toBeUndefined();
    expect(await userTurns()).toHaveLength(0);
    expect(executeCalls[0].seedTurnId).toBeUndefined();
  });

  it('rejected start (409 duplicate) → the rejection lands on the user\'s own turn', async () => {
    store.jobsByFeature = [{ jobId: 'job-running', status: 'running', type: 'code' }];

    const res = await harness.call('POST', EXECUTE_URL, {
      task: 'code',
      agent: 'architect',
      overrideDirective: 'build the login page',
    });

    expect(res.status).toBe(409);
    expect(executeCalls).toHaveLength(0);

    const turns = await userTurns();
    expect(turns).toHaveLength(1);

    const assistant = (await chatLog()).filter((l) => l.type === 'assistant_message');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].turnId).toBe(turns[0].turnId);
  });


  // ───────────────────────────────────────────────────────────────────
  // Directive budget (M-NEW-029) — the cap belongs at EVERY ingress that
  // reaches the durable turn writer, applied BEFORE the append. `/continue`
  // had it; `/execute` and `/inline-ask` rode the 50 MiB authenticated JSON
  // body straight into chat.jsonl.
  // ───────────────────────────────────────────────────────────────────

  const overCap = 'x'.repeat(DIRECTIVE_MAX_CHARS + 1);
  const atCap = 'y'.repeat(DIRECTIVE_MAX_CHARS);

  const capCases: Array<{ name: string; url: string; body: (d: string) => any; field: string }> = [
    {
      name: '/execute overrideDirective',
      url: EXECUTE_URL,
      body: (d) => ({ task: 'code', agent: 'architect', overrideDirective: d }),
      field: 'overrideDirective',
    },
    {
      name: '/inline-ask message',
      url: INLINE_ASK_URL,
      body: (d) => ({ message: d }),
      field: 'message',
    },
  ];

  for (const c of capCases) {
    it(`${c.name} over the cap → 413 DIRECTIVE_TOO_LARGE, nothing durably appended`, async () => {
      const res = await harness.call('POST', c.url, c.body(overCap));
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('DIRECTIVE_TOO_LARGE');
      expect(res.body.message).toContain(c.field);
      expect(await chatLog()).toHaveLength(0);
      expect(executeCalls).toHaveLength(0);
    });

    it(`${c.name} exactly at the cap is accepted (boundary is inclusive)`, async () => {
      const res = await harness.call('POST', c.url, c.body(atCap));
      expect(res.status).toBe(200);
      const turns = await userTurns();
      expect(turns).toHaveLength(1);
      expect(turns[0].text).toHaveLength(DIRECTIVE_MAX_CHARS);
    });
  }

  it('/continue over the cap → the same typed 413 (the ingress that already had it)', async () => {
    const res = await harness.call('POST', '/jobs/job-1/continue', {
      projectId: 'proj',
      featureName: 'feat-a',
      newDirective: overCap,
    });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('DIRECTIVE_TOO_LARGE');
    expect(res.body.message).toContain('newDirective');
    expect(await chatLog()).toHaveLength(0);
  });

  // One owner: the schema must NOT re-cap `overrideDirective`, or /execute
  // answers a generic 400 while its two siblings answer 413.
  it('the /execute schema leaves the ceiling to the route (single owner)', () => {
    expect(executeJobSchema.safeParse({ task: 'code', overrideDirective: overCap }).success).toBe(true);
  });

  it('the chat/user-message schema shares the constant (one owner, not a copy)', () => {
    expect(chatUserMessageSchema.safeParse({ content: overCap }).success).toBe(false);
    expect(chatUserMessageSchema.safeParse({ content: atCap }).success).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────
  // actionMetadata byte budget (M-NEW-029) — the schema owns the axis, so
  // the WHOLE serialized object (unknown `.passthrough()` fields included)
  // answers a typed 413 before the folder walk, the durable append, the SSE
  // broadcast, and the job dispatch.
  // ───────────────────────────────────────────────────────────────────

  it('/execute with over-budget actionMetadata → 413, nothing durable, no SSE, no dispatch', async () => {
    const { ACTION_METADATA_MAX_SERIALIZED_BYTES } = await import('@ant/shared');
    const res = await harness.call('POST', EXECUTE_URL, {
      task: 'code',
      agent: 'architect',
      overrideDirective: 'build the login page',
      actionMetadata: { pad: 'x'.repeat(ACTION_METADATA_MAX_SERIALIZED_BYTES + 1) },
    });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('ACTION_METADATA_TOO_LARGE');
    expect(await chatLog()).toHaveLength(0);
    expect(broadcastLines(store)).toHaveLength(0);
    expect(executeCalls).toHaveLength(0);
  });

  it('/execute with roomy-but-legal actionMetadata still lands on the durable line', async () => {
    const res = await harness.call('POST', EXECUTE_URL, {
      task: 'code',
      agent: 'architect',
      overrideDirective: 'build the login page',
      actionMetadata: { intent: 'gen-plan', refs: ['plan/prd.md'], someFutureRacField: 'ok' },
    });
    expect(res.status).toBe(200);
    const turns = await userTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].actionMetadata.refs).toEqual(['plan/prd.md']);
    expect(turns[0].actionMetadata.someFutureRacField).toBe('ok');
  });

  // ───────────────────────────────────────────────────────────────────
  // POST .../inline-ask
  // ───────────────────────────────────────────────────────────────────

  it('inline-ask with an owned turn → no duplicate bubble, id forwarded', async () => {
    const res = await harness.call('POST', INLINE_ASK_URL, {
      message: 'why did it stop?',
      seedTurnId: 't-owned02',
    });

    expect(res.status).toBe(200);
    expect(await userTurns()).toHaveLength(0);
    expect(executeCalls[0].seedTurnId).toBe('t-owned02');
  });

  it('inline-ask without an owned turn → records + stamps jobType inline-ask', async () => {
    const res = await harness.call('POST', INLINE_ASK_URL, { message: 'why did it stop?' });

    expect(res.status).toBe(200);
    const turns = await userTurns();
    expect(turns).toHaveLength(1);
    expect(turns[0].jobType).toBe('inline-ask');
    expect(executeCalls[0].seedTurnId).toBe(turns[0].turnId);
  });
});
