/**
 * Resource admission — what an inbound request may spend BEFORE it has been
 * authorized, and how much one authenticated account may hold at once.
 *
 * One axis, one row per admission point. All three sinks shared a shape: a
 * per-item cap existed, but nothing bounded the request or the account.
 *
 *   - JSON body parsing ran ahead of the JWT check   (report M-010)
 *   - workflow SSE skipped the connection-slot budget (report M-005)
 *   - multipart uploads capped `fileSize` only        (report M-007)
 *
 * Assertions are on the GATE (order, accept/reject), never on message prose.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { UPLOAD_LIMITS } from '../../src/core/config/uploadLimits.js';

// ────────────────────────────────────────────────────────────────────────────
// Pre-auth body budget (M-010)
// ────────────────────────────────────────────────────────────────────────────

const order: string[] = [];

vi.mock('express', async (importOriginal) => {
  const actual: any = await importOriginal<typeof import('express')>();
  const base = actual.default ?? actual;
  const wrapped: any = (...args: unknown[]) => base(...args);
  Object.assign(wrapped, base);
  wrapped.json = (opts?: { limit?: string }) => {
    order.push(`json:${opts?.limit ?? 'default'}`);
    return (_req: unknown, _res: unknown, next: () => void) => next();
  };
  return { ...actual, default: wrapped };
});

vi.mock('../../src/periphery/adapters/http/middleware/jwtAuth', () => ({
  createJwtAuthMiddleware: () => {
    order.push('jwt-auth');
    return (_req: unknown, _res: unknown, next: () => void) => next();
  },
}));

vi.mock('../../src/periphery/adapters/http/middleware/requireOnboardedJwt', () => ({
  createRequireOnboardedJwt: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe('unauthenticated requests cannot spend the full body budget (M-010)', () => {
  beforeEach(() => {
    order.length = 0;
  });

  const configure = async () => {
    const { ServerConfigurator } = await import(
      '../../src/periphery/adapters/http/express/config/ServerConfigurator.js'
    );
    const app: any = { use: vi.fn(), set: vi.fn(), get: vi.fn() };
    new ServerConfigurator(
      { mode: 'cloud' } as any,
      {
        authService: {} as any,
        jwtService: { verify: () => ({}) } as any,
        previewService: undefined,
        ideOrchestrator: undefined,
      } as any,
    ).configure(app);
    return order;
  };

  it('mounts the small parser first, then auth, then the full-size parser', async () => {
    const seq = await configure();
    const small = seq.indexOf('json:100kb');
    const auth = seq.indexOf('jwt-auth');
    const full = seq.indexOf('json:50mb');

    expect(small).toBeGreaterThanOrEqual(0);
    expect(auth).toBeGreaterThan(small);
    expect(full).toBeGreaterThan(auth);
  });

  it('registers exactly one parser ahead of authentication', async () => {
    const seq = await configure();
    const beforeAuth = seq.slice(0, seq.indexOf('jwt-auth')).filter(s => s.startsWith('json:'));
    expect(beforeAuth).toEqual(['json:100kb']);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Per-account SSE connection slots (M-005)
// ────────────────────────────────────────────────────────────────────────────

// Both SSE streams decide admission BEFORE res.writeHead, because a committed
// 200 can carry no status code: a refusal written into a live text/event-stream
// is invisible to EventSource, which reconnects every 3 s forever.
//   - budget spent            → 429 (M-005: workflow used to skip the budget)
//   - state store unreachable → 503 (the slot key was written AFTER writeHead,
//                              so a dead Redis ended a committed 200)
type Admission =
  | { ok: true; reservation: Record<string, never> }
  | { ok: false; status: 429 | 503; code: string };

const STREAMS: Array<{
  name: string;
  path: string;
  params: Record<string, string>;
  register: 'registerClient' | 'registerWorkflowClient';
}> = [
  {
    name: 'feature',
    path: '/projects/:id/features/:feature/stream',
    params: { id: 'p1', feature: 'universal' },
    register: 'registerClient',
  },
  {
    name: 'workflow',
    path: '/jobs/:jobId/workflow/stream',
    params: { jobId: 'j1' },
    register: 'registerWorkflowClient',
  },
];

const ADMISSIONS: Array<{ label: string; admission: Admission; expected?: 429 | 503 }> = [
  { label: 'budget spent', admission: { ok: false, status: 429, code: 'connection_limit' }, expected: 429 },
  { label: 'store unreachable', admission: { ok: false, status: 503, code: 'transport_unavailable' }, expected: 503 },
  { label: 'admitted', admission: { ok: true, reservation: {} } },
];

describe('SSE admission is decided before the response is committed (M-005)', () => {
  const buildRouter = async (admission: Admission, path: string) => {
    const { createSSERoutes } = await import('../../src/periphery/adapters/http/routes/sse.routes.js');
    const sseService = {
      admitConnection: vi.fn(async () => admission),
      registerWorkflowClient: vi.fn(),
      registerClient: vi.fn(),
      sendInitialState: vi.fn(),
      getClientCount: vi.fn(() => 1),
    };
    const router: any = createSSERoutes({
      sseService: sseService as any,
      workflowStateService: { getInitialState: vi.fn(async () => null) } as any,
      kanbanService: { getKanbanData: vi.fn(async () => ({})) } as any,
      chatService: {
        loadEventsAsync: vi.fn(async () => []),
        loadTurnBuffersAsync: vi.fn(async () => ({})),
      } as any,
      projectService: { getFileTree: vi.fn(async () => []), resolveExistingFeatureForMutation: async () => '/tmp/feature' } as any,
      stateStore: undefined,
    } as any);
    const handler = router.stack.find((l: any) => l.route?.path === path).route.stack.at(-1).handle;
    return { handler, sseService };
  };

  const call = async (handler: any, params: Record<string, string>) => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      headersSent: false,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
      writeHead: vi.fn(function (this: any, code: number) { this.headersSent = true; this.statusCode = code; return this; }),
      write: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
    };
    await handler(
      { params, headers: {}, query: {}, user: { id: 'alice' }, organization: { id: 'acme' } } as any,
      res,
    );
    return res;
  };

  for (const stream of STREAMS) {
    for (const { label, admission, expected } of ADMISSIONS) {
      it(`${stream.name} stream — ${label}`, async () => {
        const { handler, sseService } = await buildRouter(admission, stream.path);
        const res = await call(handler, stream.params);

        expect(sseService.admitConnection).toHaveBeenCalled();

        if (expected) {
          expect(res.statusCode).toBe(expected);
          expect(res.writeHead).not.toHaveBeenCalled();
          expect(res.end).not.toHaveBeenCalled();
          expect(sseService[stream.register]).not.toHaveBeenCalled();
        } else {
          expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
            'Content-Type': 'text/event-stream',
          }));
          expect(sseService[stream.register]).toHaveBeenCalled();
          // a committed stream is never ended by the connect path
          expect(res.end).not.toHaveBeenCalled();
        }
      });
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Multipart request budget (M-007)
// ────────────────────────────────────────────────────────────────────────────

describe('multipart uploads bound the request, not just each file (M-007)', () => {
  it('caps files, parts, fields and field size in addition to fileSize', () => {
    for (const key of ['fileSize', 'files', 'parts', 'fields', 'fieldSize'] as const) {
      expect(UPLOAD_LIMITS[key], key).toBeGreaterThan(0);
    }
  });

  const ROUTERS = [
    'routes/files.routes.ts',
    'routes/accountAgents.routes.ts',
    'routes/customAgents.routes.ts',
  ];

  for (const rel of ROUTERS) {
    it(`${rel} uses the shared budget rather than an inline fileSize cap`, () => {
      const source = readFileSync(
        path.resolve(__dirname, '../../src/periphery/adapters/http', rel),
        'utf8',
      );
      // every multer() in the file takes the SSOT limits
      const configs = source.match(/multer\(\{[\s\S]*?\}\)/g) ?? [];
      expect(configs.length).toBeGreaterThan(0);
      for (const config of configs) {
        expect(config).toContain('UPLOAD_LIMITS');
      }
    });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Durable-write ingress: rate limit + body schema (M-NEW-029)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Authorization answers WHOSE data a route touches. It never answers HOW MUCH
 * work one caller may ask for, and these routes append to durable JSONL logs,
 * rewrite whole logs, or start job runs.
 *
 * A SET, not a list of remembered offenders. `chat/job-error` slipped through
 * the previous round precisely because the guard enumerated the routes someone
 * had thought of; here every route in the file must carry the gate, so a NEW
 * route inherits the requirement instead of having to be remembered.
 *
 * Structural on purpose: the route-level tests mock the limiter out (they are
 * testing behaviour, not admission), so only a source check can see it.
 */
describe('every chat route is admission-gated (M-NEW-029)', () => {
  const chatSrc = readFileSync(
    path.resolve(__dirname, '../../src/periphery/adapters/http/routes/chat.routes.ts'),
    'utf8',
  );
  const ROUTE_RE = /router\.(get|post|put|delete)\((\s*)'([^']+)'([^\n]*)/g;

  const routes = [...chatSrc.matchAll(ROUTE_RE)].map((m) => ({
    method: m[1],
    path: m[3],
    rest: m[4],
  }));

  it('finds the routes it is meant to be guarding', () => {
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  for (const r of routes) {
    // GET /pending-choice reads in-memory state and writes nothing.
    if (r.method === 'get') continue;

    it(`${r.method.toUpperCase()} ${r.path} carries a rate limiter`, () => {
      expect(r.rest).toContain('chatRateLimiter');
    });

    // A DELETE has no body to validate; every POST body reaches a durable line.
    if (r.method !== 'post') continue;
    it(`${r.method.toUpperCase()} ${r.path} validates its body`, () => {
      expect(r.rest).toContain('validateBody(');
    });
  }
});

describe('expensive job routes are admission-gated (M-NEW-029)', () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(__dirname, '../../src/periphery/adapters/http', rel), 'utf8');

  it('/jobs/:jobId/continue is rate-limited like /execute', () => {
    const src = read('routes/job.routes.ts');
    expect(src).toMatch(/router\.post\('\/jobs\/:jobId\/continue',\s*jobExecuteRateLimiter/);
  });

  // The job-history scan walks a whole container and parses everything it finds
  // — the same class of work as the artifact tree, so the same pair of gates.
  it('the job-history route takes both a rate limit and an in-flight slot', () => {
    const src = read('routes/features.routes.ts');
    expect(src).toMatch(/router\.get\('\/projects\/:id\/features\/:feature\/jobs',\s*treeRateLimiter/);
    expect(src).toContain('acquireConcurrencySlot');
    expect(src).toContain('ant:slots:history:');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Aggregation budgets — a per-item cap is not a per-request bound (M-NEW-029)
// ────────────────────────────────────────────────────────────────────────────

describe('history aggregation is bounded cumulatively, not just per file', () => {
  it('collectUniversalRuns declares both a run count and a byte budget', async () => {
    const mod = await import('../../src/periphery/adapters/http/routes/helpers/universalRuns.js');
    // Two axes because either alone is escapable: many small sessions with many
    // runs each, or few sessions that are individually huge.
    expect(mod.UNIVERSAL_RUN_COLLECT_MAX_RUNS).toBeGreaterThan(0);
    expect(mod.UNIVERSAL_RUN_COLLECT_MAX_BYTES).toBeGreaterThan(0);
  });

  it('a partial history says so rather than reading as a complete one', () => {
    const src = readFileSync(
      path.resolve(__dirname, '../../src/periphery/adapters/http/routes/features.routes.ts'),
      'utf8',
    );
    // Additive key — the FE reads `jobs` and ignores the rest, so this cannot
    // break the contract, but a truncated list that is silent about it can.
    expect(src).toMatch(/truncated:\s*true/);
  });
});

describe('actionMetadata bounds the slot COUNT, not only each path', () => {
  it('every RAC slot — target included — is path-checked and count-capped', async () => {
    const { executeJobSchema } = await import(
      '../../src/periphery/adapters/http/middleware/validateBody.js'
    );
    const { ACTION_METADATA_MAX_PATHS } = await import('@ant/shared');
    const over = Array.from({ length: ACTION_METADATA_MAX_PATHS + 1 }, (_, i) => `a/${i}.ts`);

    // `target` used to be absent from the schema entirely and rode
    // `.passthrough()` unchecked, while still reaching the folder walk.
    for (const slot of ['target', 'refs', 'context'] as const) {
      expect(
        executeJobSchema.safeParse({ task: 'code', actionMetadata: { [slot]: over } }).success,
        `${slot} count`,
      ).toBe(false);
      expect(
        executeJobSchema.safeParse({ task: 'code', actionMetadata: { [slot]: ['../etc/passwd'] } }).success,
        `${slot} traversal`,
      ).toBe(false);
      expect(
        executeJobSchema.safeParse({ task: 'code', actionMetadata: { [slot]: ['src/a.ts'] } }).success,
        `${slot} normal`,
      ).toBe(true);
    }
  });
});

describe('actionMetadata bounds the SERIALIZED OBJECT, not only known fields', () => {
  // Field caps cannot bound an open shape: the schema deliberately keeps
  // `.passthrough()` so the RAC contract can evolve, which puts every unknown
  // field outside a field-enumeration model by definition (M-NEW-029). The
  // closed model is one measurement of the whole serialized object, owned by
  // the shared schema so every ingress that reuses it inherits the cap.
  it('both durable-ingress schemas reject an over-budget unknown field with a typed 413 issue', async () => {
    const { executeJobSchema, chatUserMessageSchema } = await import(
      '../../src/periphery/adapters/http/middleware/validateBody.js'
    );
    const { ACTION_METADATA_MAX_SERIALIZED_BYTES } = await import('@ant/shared');
    const oversized = { pad: 'x'.repeat(ACTION_METADATA_MAX_SERIALIZED_BYTES + 1) };

    const cases: Array<[string, { success: boolean }]> = [
      ['execute', executeJobSchema.safeParse({ task: 'code', actionMetadata: oversized })],
      [
        'chat user-message',
        chatUserMessageSchema.safeParse({ content: 'hi', actionMetadata: oversized }),
      ],
    ];
    for (const [label, result] of cases) {
      expect(result.success, `${label} oversized`).toBe(false);
      const issue: any = (result as any).error.issues.find(
        (i: any) => i.params?.httpStatus === 413,
      );
      // The 413 stamp is what lets validateBody answer the typed shape instead
      // of a generic 400 — losing it silently downgrades the contract.
      expect(issue?.params?.code, `${label} issue code`).toBe('ACTION_METADATA_TOO_LARGE');
    }
  });

  it('a small unknown field still passes through — size and shape are orthogonal', async () => {
    const { executeJobSchema } = await import(
      '../../src/periphery/adapters/http/middleware/validateBody.js'
    );
    const parsed = executeJobSchema.safeParse({
      task: 'code',
      actionMetadata: { intent: 'gen-plan', someFutureRacField: { nested: true } },
    });
    expect(parsed.success).toBe(true);
    expect((parsed as any).data.actionMetadata.someFutureRacField).toEqual({ nested: true });
  });

  it('the schema maximum for all three slots stays under the byte budget', async () => {
    // 500 realistic paths × 3 slots must remain a legal request — the byte
    // budget bounds abuse, not the documented slot contract.
    const { executeJobSchema } = await import(
      '../../src/periphery/adapters/http/middleware/validateBody.js'
    );
    const { ACTION_METADATA_MAX_PATHS } = await import('@ant/shared');
    const full = Array.from({ length: ACTION_METADATA_MAX_PATHS }, (_, i) => `src/dir/${i}/file-${i}.ts`);
    expect(
      executeJobSchema.safeParse({
        task: 'code',
        actionMetadata: { target: full, refs: full, context: full },
      }).success,
    ).toBe(true);
  });
});
