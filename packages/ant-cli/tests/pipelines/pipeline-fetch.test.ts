/**
 * `on.fetch` — the pull trigger's runtime, one axis one file: item extraction
 * (the poller and the preview share it), the source call through the REST
 * admission owner with the activator's credentials, and the poll itself
 * (room under `concurrency`, batch, claim skip, dead-claim heal, telemetry).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { PipelineFetchTrigger } from '@ant/shared';
import { extractFetchItems, selectItemPath } from '../../src/core/pipelines/fetchSource';
import { fetchSourceJson, pollFetchSource } from '../../src/core/pipelines/fetchConnection';
import { FETCH_SAMPLE_LIMITS, sampleOf } from '../../src/core/pipelines/fetchSample';
import { handleFetchPoll, fetchLockTtlSeconds, FETCH_LOCK_MAX_S, FETCH_LOCK_MIN_S } from '../../src/infrastructure/scheduling/pipelineRun/fetch';
import { handleFire } from '../../src/infrastructure/scheduling/pipelineRun/fire';
import { ITEM_CLAIM_GRACE_MS, isDeadClaim, parseClaimValue } from '../../src/infrastructure/scheduling/pipelineRun/itemLedger';
import { unresolvedTemplateRefs } from '../../src/infrastructure/scheduling/pipelineRun/render';
import { readItemClaims } from '../../src/core/pipelines/store';
import { REST_BODY_CAP_BYTES, REST_CALL_TIMEOUT_DEFAULT_MS } from '../../src/core/customAgents/restApi';

const TRIGGER: PipelineFetchTrigger = {
  customJobRef: 'ops/tickets',
  api: 'jira',
  request: { method: 'GET', path: '/rest/api/3/search', query: { jql: 'status = Open' } },
  items: '$.issues',
  key: '$.key',
  fields: { summary: '$.fields.summary', channel: "$.fields['customfield_1'].value", tags: '$.fields.labels' },
  every: '5m',
};

const RESPONSE = {
  issues: [
    { key: 'OPS-1', fields: { summary: 'refund A', customfield_1: { value: 'web' }, labels: ['a', 'b'] } },
    { key: 'OPS-2', fields: { summary: 'x'.repeat(3_000), customfield_1: null } },
    { key: 'OPS-1', fields: { summary: 'duplicate' } },
    { key: 'bad key!', fields: { summary: 'skipped' } },
    { fields: { summary: 'no key' } },
    { key: 42, fields: { summary: 'numeric key' } },
  ],
};

describe('extractFetchItems — the ONE item reader (poller + preview)', () => {
  it('selects the array, projects key + declared fields, skips bad/duplicate keys, cuts fields, stringifies non-scalars', () => {
    const r = extractFetchItems(RESPONSE, TRIGGER);
    expect(typeof r).not.toBe('string');
    const { items, seen, skipped } = r as Exclude<typeof r, string>;
    expect(seen).toBe(6);
    expect(skipped).toBe(3);
    expect(items.map((i) => i.key)).toEqual(['OPS-1', 'OPS-2', '42']);
    expect(items[0].fields).toEqual({ summary: 'refund A', channel: 'web', tags: '["a","b"]' });
    expect(items[1].fields!.summary).toHaveLength(2_000);
    expect('channel' in items[1].fields!).toBe(false);
  });

  it('a non-array selection is the reason string, not a throw', () => {
    expect(extractFetchItems({ issues: { total: 0 } }, TRIGGER)).toMatch(/did not select an array \(got: object\)/);
    expect(extractFetchItems({}, TRIGGER)).toMatch(/got: nothing/);
    expect(extractFetchItems(null, TRIGGER)).toMatch(/got: nothing/);
  });

  it('scans at most 200 items; an item without declared fields carries no fields key', () => {
    const many = { issues: Array.from({ length: 250 }, (_, i) => ({ key: `K-${i}` })) };
    const r = extractFetchItems(many, { ...TRIGGER, fields: undefined }) as Exclude<ReturnType<typeof extractFetchItems>, string>;
    expect(r.seen).toBe(200);
    expect(r.items).toHaveLength(200);
    expect(r.items[0]).toEqual({ key: 'K-0' });
  });

  it('selectItemPath walks members and indexes and yields undefined on any shape disagreement', () => {
    const doc = { a: [{ b: 'x' }], 'c d': 1 };
    expect(selectItemPath(doc, [{ kind: 'key', name: 'a' }, { kind: 'index', index: 0 }, { kind: 'key', name: 'b' }])).toBe('x');
    expect(selectItemPath(doc, [{ kind: 'key', name: 'c d' }])).toBe(1);
    expect(selectItemPath(doc, [{ kind: 'index', index: 0 }])).toBeUndefined();
    expect(selectItemPath(doc, [{ kind: 'key', name: 'a' }, { kind: 'key', name: 'b' }])).toBeUndefined();
    expect(selectItemPath(doc, [])).toBe(doc);
  });
});

// ---- source call: the activator's scope roots + credential store, the executor's admission ----

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-fetch-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function scaffoldAgent(ws: string, apis: string): void {
  const agentDir = path.join(ws, 'local', 'user', '.ant', 'agents', 'ops');
  fs.mkdirSync(path.join(agentDir, 'jobs', 'tickets'), { recursive: true });
  fs.mkdirSync(path.join(agentDir, 'base'), { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'base', 'role.md'), 'You handle tickets.\n');
  fs.writeFileSync(path.join(agentDir, 'agent.yaml'), `id: ops\nname: Ops\nversion: 1\n${apis}`);
  fs.writeFileSync(path.join(agentDir, 'jobs', 'tickets', 'job.yaml'), 'id: tickets\nname: Tickets\n');
}

const TENANT = { workspacesPath: '', userId: 'user', organizationId: 'local', organizationKind: 'local' as const };
const resolver = (entries: Record<string, string>) => ({ resolve: async (k: string) => entries[k] });

function fetchStub(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return response();
  }) as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sampleOf — the bounded response view the preview shows, never the poller', () => {
  it('keeps shape and counts: first N array items with total, first keys with more, cut strings flagged', () => {
    const json = { total: 40, issues: Array.from({ length: 40 }, (_, i) => ({ key: `OPS-${i}`, note: 'x'.repeat(500) })), nested: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } };
    const node = sampleOf(json);
    expect(node.t).toBe('obj');
    if (node.t !== 'obj') return;
    const issues = node.entries.find(([k]) => k === 'issues')![1];
    expect(issues.t).toBe('arr');
    if (issues.t !== 'arr') return;
    expect(issues.total).toBe(40);
    expect(issues.items).toHaveLength(FETCH_SAMPLE_LIMITS.maxArrayItems);
    const note = (issues.items[0] as Extract<typeof node, { t: 'obj' }>).entries.find(([k]) => k === 'note')![1];
    expect(note).toEqual({ t: 'str', v: 'x'.repeat(FETCH_SAMPLE_LIMITS.maxStringChars), cut: true });
    // Depth is capped: the deepest object comes back empty with its key count, not walked.
    const text = JSON.stringify(node);
    expect(text).not.toContain('"g"');
    expect(text).toContain('"more":1');
  });
  it('a body past the byte ceiling is cut harder until the sample fits', () => {
    const json = { rows: Array.from({ length: 3 }, () => ({ blob: 'y'.repeat(150), keys: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(150)])) })) };
    const node = sampleOf(json, { ...FETCH_SAMPLE_LIMITS, maxBytes: 2_000 });
    expect(Buffer.byteLength(JSON.stringify(node), 'utf-8')).toBeLessThanOrEqual(2_000);
  });
  it('scalars and null at the root are samples too', () => {
    expect(sampleOf(null)).toEqual({ t: 'null' });
    expect(sampleOf(3)).toEqual({ t: 'num', v: 3 });
    expect(sampleOf(true)).toEqual({ t: 'bool', v: true });
  });
});

describe('pollFetchSource — the activator\'s connection, the executor\'s admission, a reason string on every failure', () => {
  it('resolves the job\'s api, sends the declared request with resolved secret headers, and extracts items', async () => {
    scaffoldAgent(tmp, 'apis:\n  jira:\n    baseUrl: https://jira.example.com/api\n    headers:\n      Authorization: ${secret:JIRA_TOKEN}\n    allow:\n      - GET /rest/**\n');
    const { impl, calls } = fetchStub(json(RESPONSE));
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({ JIRA_TOKEN: 'sk-live' }), fetchImpl: impl }, TRIGGER);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://jira.example.com/api/rest/api/3/search?jql=status+%3D+Open');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('sk-live');
    expect(calls[0].init.redirect).toBe('manual');
    expect((r as any).extracted.items.map((i: any) => i.key)).toEqual(['OPS-1', 'OPS-2', '42']);
  });

  it.each([
    ['an undeclared connection', 'apis:\n  github:\n    baseUrl: https://api.github.com\n', {}, /declares no API connection "jira"/],
    ['a self entry', 'apis:\n  jira:\n    self: true\n', {}, /is a self entry/],
    ['an unregistered secret (the config_invalid message, no value)', 'apis:\n  jira:\n    baseUrl: https://jira.example.com\n    headers:\n      Authorization: ${secret:JIRA_TOKEN}\n', {}, /credential key "JIRA_TOKEN" which is not registered/],
    ['a request outside the allow rules (the executor\'s own text)', 'apis:\n  jira:\n    baseUrl: https://jira.example.com\n    allow:\n      - GET /other/**\n', {}, /Policy: GET \/rest\/api\/3\/search is not permitted/],
  ])('fails with a reason for %s', async (_label, apis, secrets, pattern) => {
    scaffoldAgent(tmp, apis);
    const { impl, calls } = fetchStub(json(RESPONSE));
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver(secrets), fetchImpl: impl }, TRIGGER);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(pattern);
    expect(calls).toHaveLength(0);
  });

  const INLINE: PipelineFetchTrigger = {
    ...TRIGGER,
    customJobRef: undefined,
    api: undefined,
    connection: { baseUrl: 'https://queue.example.com/api', headers: { Authorization: '${secret:QUEUE_TOKEN}', Accept: 'application/json' } },
  };

  it('an inline connection sends the declared request with resolved secret headers — no job is loaded', async () => {
    // No agent scaffolded at all: an inline connection resolves nothing in the scope roots.
    const { impl, calls } = fetchStub(json(RESPONSE));
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({ QUEUE_TOKEN: 'q-live' }), fetchImpl: impl }, INLINE);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('https://queue.example.com/api/rest/api/3/search?jql=status+%3D+Open');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('q-live');
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('fetchSourceJson answers the parsed body with NO selection declared — the preview shows a response before items/key exist', async () => {
    const { impl, calls } = fetchStub(json(RESPONSE));
    const r = await fetchSourceJson(
      { tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: impl },
      { connection: { baseUrl: 'https://queue.example.com' }, request: { method: 'GET', path: '/items' } },
    );
    expect(r.ok).toBe(true);
    expect((r as any).json).toEqual(RESPONSE);
    expect(calls[0].url).toBe('https://queue.example.com/items');
  });

  it('an inline connection with an unregistered secret is the config_invalid reason, no egress', async () => {
    const { impl, calls } = fetchStub(json(RESPONSE));
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: impl }, INLINE);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/credential key "QUEUE_TOKEN" which is not registered/) });
    expect(calls).toHaveLength(0);
  });

  it('a missing agent is a reason, not a throw', async () => {
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}) }, TRIGGER);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/failed to load/) });
  });

  it.each([
    ['a 4xx — status line only, never the body', () => new Response('{"secret":"leak"}', { status: 403, statusText: 'Forbidden', headers: { 'content-type': 'application/json' } }), /^HTTP 403 Forbidden$/],
    ['a redirect — never followed', () => new Response('', { status: 302, headers: { location: 'https://evil.example/x' } }), /redirect not followed/],
    ['a non-JSON body', () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }), /not JSON/],
    ['unparseable JSON', () => new Response('{nope', { status: 200, headers: { 'content-type': 'application/json' } }), /not valid JSON/],
    ['a non-array items selection', json({ issues: 'none' }), /did not select an array/],
  ])('%s is a reason string', async (_label, response, pattern) => {
    scaffoldAgent(tmp, 'apis:\n  jira:\n    baseUrl: https://jira.example.com\n');
    const { impl } = fetchStub(response);
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: impl }, TRIGGER);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(pattern);
    expect((r as any).error).not.toMatch(/leak/);
  });

  it('a body over the read cap is a reason (declared up front, or cut mid-stream) — never a buffered 2MB parse', async () => {
    scaffoldAgent(tmp, 'apis:\n  jira:\n    baseUrl: https://jira.example.com\n');
    const declared = fetchStub(() => new Response('{"issues":[]}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(REST_BODY_CAP_BYTES + 1) } }));
    const r1 = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: declared.impl }, TRIGGER);
    expect(r1).toMatchObject({ ok: false, error: expect.stringMatching(/exceeds the \d+-byte cap/) });
    const streamed = fetchStub(() => new Response(`{"issues":[${'1,'.repeat(REST_BODY_CAP_BYTES / 2)}1]}`, { status: 200, headers: { 'content-type': 'application/json' } }));
    const r2 = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: streamed.impl }, TRIGGER);
    expect(r2).toMatchObject({ ok: false, error: expect.stringMatching(/exceeds the \d+-byte cap/) });
  });

  it('a network failure is a reason naming the request, not a throw', async () => {
    scaffoldAgent(tmp, 'apis:\n  jira:\n    baseUrl: https://jira.example.com\n');
    const impl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const r = await pollFetchSource({ tenant: { ...TENANT, workspacesPath: tmp }, credentialResolver: resolver({}), fetchImpl: impl }, TRIGGER);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/network error: ECONNRESET/) });
  });
});

// ---- the poll: room, batch, claims, heal, telemetry ----

const OWNER = { userId: 'user', organizationId: 'local', organizationKind: 'local' as const };

function writeActivationAndDef(ws: string, def: Record<string, unknown>): void {
  const defDir = path.join(ws, 'local', 'user', '.ant', 'pipelines', 'p1');
  fs.mkdirSync(defDir, { recursive: true });
  fs.writeFileSync(path.join(defDir, 'pipeline.yaml'), JSON.stringify(def));
  fs.writeFileSync(path.join(defDir, 'availability.json'), JSON.stringify({ enabled: true, changedAt: '2026-09-16T00:00:00.000Z' }));
  const actDir = path.join(ws, 'local', 'user', '.ant', 'pipeline-activations', 'proj-a');
  fs.mkdirSync(actDir, { recursive: true });
  fs.writeFileSync(path.join(actDir, 'activation.json'), JSON.stringify({ pipelineId: 'p1', pipelineScope: 'user', projectId: 'proj-a', activatedAt: '2026-09-16T00:00:00.000Z' }));
}

function makeCtx(ws: string, fetchImpl: typeof fetch, concurrency = 1) {
  const keys = new Map<string, string>();
  const slots = new Map<string, Set<string>>();
  const enqueued: any[] = [];
  const published: any[] = [];
  const dispatched: any[] = [];
  const locks = new Set<string>();
  /** Keys whose write must fail — the commit-crash rows. */
  const failWrites = new Set<string>();
  const stateStore = {
    acquireLock: async (k: string) => {
      if (locks.has(k)) return false;
      locks.add(k);
      return true;
    },
    releaseLock: async (k: string) => void locks.delete(k),
    releaseLockIfOwner: async (k: string, v: string) => {
      if (keys.get(k) === v) keys.delete(k);
    },
    tryAcquireLock: async (k: string, v: string) => {
      if (keys.has(k)) return false;
      keys.set(k, v);
      return true;
    },
    exists: async (k: string) => keys.has(k),
    getKey: async (k: string) => keys.get(k) ?? null,
    setKeyWithTTL: async (k: string, v: string) => {
      if (failWrites.has(k)) throw new Error('redis down');
      keys.set(k, v);
    },
    deleteKey: async (k: string) => void keys.delete(k),
    countSlots: async (k: string) => slots.get(k)?.size ?? 0,
    listSlots: async (k: string) => [...(slots.get(k) ?? [])],
    reserveSlot: async (k: string, m: string, limit: number) => {
      const set = slots.get(k) ?? new Set<string>();
      slots.set(k, set);
      if (!set.has(m) && set.size >= limit) return false;
      set.add(m);
      return true;
    },
    refreshSlot: async (k: string, m: string) => slots.get(k)?.has(m) ?? false,
    releaseSlot: async (k: string, m: string) => void slots.get(k)?.delete(m),
    publish: async (_ch: string, msg: any) => void published.push(msg),
  };
  const deps = {
    stateStore,
    scheduleQueue: { addNow: async (d: any) => void enqueued.push(d), armDelayed: async () => {} },
    workspacesPath: ws,
    credentialResolverFor: () => resolver({}),
    fetchImpl,
  };
  const ctx = {
    deps,
    executeDispatches: async (_o: any, _d: any, run: any, dispatches: any[]) => void dispatched.push({ run, dispatches }),
  } as any;
  writeActivationAndDef(ws, {
    version: 2,
    name: 'p1',
    concurrency,
    on: { fetch: { ...TRIGGER, batch: 5 } },
    steps: [{ id: 'a', customJobRef: 'ops/tickets', directive: '{{trigger.item.key}} {{trigger.item.summary}}' }],
  });
  scaffoldAgent(ws, 'apis:\n  jira:\n    baseUrl: https://jira.example.com/api\n');
  return { ctx, keys, slots, enqueued, published, dispatched, locks, failWrites };
}

const ACT_ROOT = (ws: string) => path.join(ws, 'local', 'user', '.ant', 'pipeline-activations');
const CLAIM_KEY = (key: string, pipelineId = 'p1') => `ant:pipe:item:local:user:proj-a:${pipelineId}:${key}`;

const POLL = { kind: 'fetch-poll' as const, owner: OWNER, pipelineId: 'p1', pipelineScope: 'user' as const, projectId: 'proj-a' };

describe('handleFetchPoll — room under concurrency, one fire per unclaimed item, telemetry on every exit', () => {
  it('admits min(batch, room) unclaimed items as fire jobs carrying the item; records seen/unclaimed/enqueued; builds the ledger marker', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, enqueued, published } = makeCtx(tmp, impl, 2);
    await handleFetchPoll(ctx, POLL);
    expect(enqueued.map((d) => d.kind)).toEqual(['fire', 'fire']);
    expect(enqueued[0]).toMatchObject({ firedBy: 'fetch', pipelineId: 'p1', projectId: 'proj-a', item: { key: 'OPS-1', fields: expect.objectContaining({ summary: 'refund A' }) } });
    expect(enqueued[1].item.key).toBe('OPS-2');
    const status = JSON.parse(keys.get('ant:pipe:fetch:local:user:proj-a')!);
    expect(status).toMatchObject({ seen: 6, unclaimed: 3, enqueued: 2 });
    expect(status.error).toBeUndefined();
    expect(keys.has('ant:pipe:items-built:local:user:proj-a')).toBe(true);
    expect(published.at(-1).data).toMatchObject({ cause: 'fetchPolled', pipelineId: 'p1', projectId: 'proj-a', lastPoll: expect.objectContaining({ enqueued: 2 }) });
    // The poller does not claim — nothing under ant:pipe:item yet.
    expect([...keys.keys()].filter((k) => k.startsWith('ant:pipe:item:'))).toEqual([]);
  });

  it('a full activation enqueues nothing (backpressure) but still reports what it saw', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, slots, enqueued } = makeCtx(tmp, impl, 1);
    slots.set('ant:pipe:actruns:local:user:proj-a', new Set(['run-live']));
    await handleFetchPoll(ctx, POLL);
    expect(enqueued).toEqual([]);
    expect(JSON.parse(keys.get('ant:pipe:fetch:local:user:proj-a')!)).toMatchObject({ seen: 6, unclaimed: 3, enqueued: 0 });
  });

  it('a claimed item is skipped; a DEAD claim (past grace, no run doc, no run log) is healed and the item re-admitted', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, enqueued } = makeCtx(tmp, impl, 3);
    keys.set('ant:pipe:items-built:local:user:proj-a', 'x');
    keys.set(CLAIM_KEY('OPS-1'), JSON.stringify({ runId: 'run-live', claimedAt: new Date(Date.now() - 2 * ITEM_CLAIM_GRACE_MS).toISOString() }));
    keys.set('ant:pipe:run:run-live', JSON.stringify({ runId: 'run-live', status: 'running' }));
    keys.set(CLAIM_KEY('OPS-2'), JSON.stringify({ runId: 'run-dead', claimedAt: new Date(Date.now() - 2 * ITEM_CLAIM_GRACE_MS).toISOString() }));
    keys.set(CLAIM_KEY('42'), JSON.stringify({ runId: 'run-young', claimedAt: new Date().toISOString() }));
    await handleFetchPoll(ctx, POLL);
    expect(enqueued.map((d) => d.item.key)).toEqual(['OPS-2']);
    expect(keys.has(CLAIM_KEY('OPS-2'))).toBe(false);
    expect(JSON.parse(keys.get('ant:pipe:fetch:local:user:proj-a')!)).toMatchObject({ seen: 6, unclaimed: 1, enqueued: 1 });
  });

  it('claims of pipeline A do not shadow pipeline B on the same project — the claim is namespaced per pipeline', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, enqueued } = makeCtx(tmp, impl, 3);
    keys.set('ant:pipe:items-built:local:user:proj-a', 'x');
    // Project proj-a used to run `staging` against another source; its keys are its own.
    for (const k of ['OPS-1', 'OPS-2', '42']) keys.set(CLAIM_KEY(k, 'staging'), JSON.stringify({ runId: 'run-old', claimedAt: new Date().toISOString() }));
    await handleFetchPoll(ctx, POLL);
    expect(enqueued.map((d) => d.item.key)).toEqual(['OPS-1', 'OPS-2', '42']);
  });

  it('a source failure records the reason and enqueues nothing; a manual poll is marked', async () => {
    const { impl } = fetchStub(json({ error: 'x' }, 500));
    const { ctx, keys, enqueued } = makeCtx(tmp, impl);
    await handleFetchPoll(ctx, { ...POLL, manual: true });
    expect(enqueued).toEqual([]);
    expect(JSON.parse(keys.get('ant:pipe:fetch:local:user:proj-a')!)).toMatchObject({ error: expect.stringMatching(/^HTTP 500/), manual: true, enqueued: 0 });
  });

  it('a held poll lock skips the poll entirely (no egress, no status); the lock is released afterwards — only by its holder', async () => {
    const LOCK = 'ant:lock:pipe-fetch:local:user:proj-a';
    const { impl, calls } = fetchStub(json(RESPONSE));
    const { ctx, keys } = makeCtx(tmp, impl);
    keys.set(LOCK, 'another-replica');
    await handleFetchPoll(ctx, POLL);
    expect(calls).toHaveLength(0);
    expect(keys.has('ant:pipe:fetch:local:user:proj-a')).toBe(false);
    // Compare-and-delete: a poll that lost its lock never frees the next holder's.
    expect(keys.get(LOCK)).toBe('another-replica');
    keys.delete(LOCK);
    await handleFetchPoll(ctx, POLL);
    expect(calls).toHaveLength(1);
    expect(keys.has(LOCK)).toBe(false);
  });

  it('the lock TTL is half the interval, clamped so it outlives the source timeout plus a ledger rebuild', () => {
    expect(FETCH_LOCK_MIN_S).toBeGreaterThanOrEqual(REST_CALL_TIMEOUT_DEFAULT_MS / 1000 + 30);
    expect(FETCH_LOCK_MAX_S).toBeGreaterThanOrEqual(FETCH_LOCK_MIN_S);
    expect(fetchLockTtlSeconds(60_000)).toBe(FETCH_LOCK_MIN_S);
    expect(fetchLockTtlSeconds(5 * 60_000)).toBe(150);
    expect(fetchLockTtlSeconds(60 * 60_000)).toBe(FETCH_LOCK_MAX_S);
  });

  it('a missing item field (or a run without an item) is an UNRESOLVED template ref, audited like a blank steps.* ref', () => {
    const run = { runId: 'r', fireEpoch: 1, steps: [], item: { key: 'OPS-1', fields: { summary: 's' } } } as any;
    const template = '{{trigger.item.key}} {{trigger.item.summary}} {{trigger.item.channel}} {{steps.a.answer}}';
    expect(unresolvedTemplateRefs(template, run)).toEqual(['steps.a.answer', 'trigger.item.channel']);
    expect(unresolvedTemplateRefs('{{trigger.item.key}}', { ...run, item: undefined })).toEqual(['trigger.item.key']);
    expect(unresolvedTemplateRefs(template, { ...run, steps: [{ stepId: 'a', output: { answer: 'x' } }], item: { key: 'k', fields: { summary: 's', channel: 'c' } } })).toEqual([]);
  });
});

describe('handleFire with an item — claim after both slots, ledger line, run.item, item_claimed event', () => {
  const FIRE = { kind: 'fire' as const, owner: OWNER, pipelineId: 'p1', pipelineScope: 'user' as const, projectId: 'proj-a', firedBy: 'fetch' as const, fireEpoch: 1_700_000_000_000 };

  it('claims (Redis NX + disk line) and freezes the item onto the run; the rendered directive carries the item', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, dispatched } = makeCtx(tmp, impl, 2);
    await handleFire(ctx, { ...FIRE, item: { key: 'OPS-1', fields: { summary: 'refund A' } } }, Date.now());
    expect(dispatched).toHaveLength(1);
    const run = dispatched[0].run;
    expect(run).toMatchObject({ firedBy: 'fetch', item: { key: 'OPS-1' } });
    expect(run.prevSuccessFireEpoch).toBeUndefined();
    const claim = JSON.parse(keys.get(CLAIM_KEY('OPS-1'))!);
    expect(claim.runId).toBe(run.runId);
    const ledger = readItemClaims(ACT_ROOT(tmp), 'proj-a', 'p1');
    expect(ledger).toEqual([{ key: 'OPS-1', runId: run.runId, claimedAt: run.startedAt }]);
    expect(fs.existsSync(path.join(ACT_ROOT(tmp), 'proj-a', 'items', 'p1.jsonl'))).toBe(true);
    const events = fs.readFileSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', `${run.runId}.jsonl`), 'utf-8');
    expect(events).toMatch(/"event":"fired"/);
    expect(events).toMatch(/"event":"item_claimed".*"key":"OPS-1"/);
  });

  it('a commit that fails after the claim leaves NO run log, so the claim is dead once past grace (never permanent)', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, keys, failWrites, dispatched } = makeCtx(tmp, impl, 2);
    failWrites.add('ant:pipe:run:');
    ctx.deps.stateStore.setKeyWithTTL = async (k: string, v: string) => {
      if (k.startsWith('ant:pipe:run:')) throw new Error('redis down');
      keys.set(k, v);
    };
    await expect(handleFire(ctx, { ...FIRE, item: { key: 'OPS-1' } }, Date.now())).rejects.toThrow(/redis down/);
    expect(dispatched).toEqual([]);
    const claim = parseClaimValue(keys.get(CLAIM_KEY('OPS-1')) ?? null)!;
    expect(claim).not.toBeNull();
    expect(fs.existsSync(path.join(ACT_ROOT(tmp), 'proj-a', 'runs', `${claim.runId}.jsonl`))).toBe(false);
    expect(await isDeadClaim(ctx.deps.stateStore, ACT_ROOT(tmp), 'proj-a', claim, Date.now() + ITEM_CLAIM_GRACE_MS + 1)).toBe(true);
  });

  it('two fires for the same item in one instant: the second loses the claim and gives both slots back', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, slots, dispatched } = makeCtx(tmp, impl, 3);
    const item = { key: 'OPS-1' };
    await handleFire(ctx, { ...FIRE, item }, Date.now());
    await handleFire(ctx, { ...FIRE, fireEpoch: FIRE.fireEpoch + 1, item }, Date.now());
    expect(dispatched).toHaveLength(1);
    expect(slots.get('ant:pipe:actruns:local:user:proj-a')!.size).toBe(1);
    expect(slots.get('ant:pipe:runslots:local:user')!.size).toBe(1);
  });

  it('a fetch fire without an item is skipped before any reservation', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, slots, dispatched, keys } = makeCtx(tmp, impl);
    await handleFire(ctx, FIRE, Date.now());
    expect(dispatched).toEqual([]);
    expect(slots.size).toBe(0);
    expect([...keys.keys()].some((k) => k.startsWith('ant:pipe:fired:'))).toBe(false);
  });

  it('a full activation never claims: the item stays unclaimed for the next poll', async () => {
    const { impl } = fetchStub(json(RESPONSE));
    const { ctx, slots, keys, dispatched } = makeCtx(tmp, impl, 1);
    slots.set('ant:pipe:actruns:local:user:proj-a', new Set(['run-live']));
    await handleFire(ctx, { ...FIRE, item: { key: 'OPS-9' } }, Date.now());
    expect(dispatched).toEqual([]);
    expect(keys.has(CLAIM_KEY('OPS-9'))).toBe(false);
  });
});
