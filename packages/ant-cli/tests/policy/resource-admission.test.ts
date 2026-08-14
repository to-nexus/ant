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

describe('workflow SSE takes a connection slot like the feature stream (M-005)', () => {
  const buildRouter = async (allowed: boolean) => {
    const { createSSERoutes } = await import('../../src/periphery/adapters/http/routes/sse.routes.js');
    const sseService = {
      checkConnectionLimit: vi.fn(async () => allowed),
      registerWorkflowClient: vi.fn(async () => {}),
      registerClient: vi.fn(async () => {}),
      sendInitialState: vi.fn(),
      getClientCount: vi.fn(() => 1),
    };
    const router: any = createSSERoutes({
      sseService: sseService as any,
      workflowStateService: { getInitialState: vi.fn(async () => null) } as any,
      kanbanService: {} as any,
      chatService: {} as any,
      projectService: {} as any,
      stateStore: undefined,
    } as any);
    const handler = router.stack.find(
      (l: any) => l.route?.path === '/jobs/:jobId/workflow/stream',
    ).route.stack.at(-1).handle;
    return { handler, sseService };
  };

  const call = async (handler: any) => {
    const res: any = {
      statusCode: 200,
      body: undefined,
      headersSent: false,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
      writeHead: vi.fn(function (this: any, code: number) { this.headersSent = true; this.statusCode = code; return this; }),
      write: vi.fn(),
      on: vi.fn(),
    };
    await handler(
      { params: { jobId: 'j1' }, headers: {}, query: {}, user: { id: 'alice' }, organization: { id: 'acme' } } as any,
      res,
    );
    return res;
  };

  it('refuses with 429 before committing the stream when the budget is spent', async () => {
    const { handler, sseService } = await buildRouter(false);
    const res = await call(handler);

    expect(res.statusCode).toBe(429);
    // the 429 must be a real HTTP status, not JSON written into a committed
    // 200 stream — that shape made EventSource reconnect forever
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(sseService.registerWorkflowClient).not.toHaveBeenCalled();
  });

  it('opens the stream when the budget allows', async () => {
    const { handler, sseService } = await buildRouter(true);
    const res = await call(handler);

    expect(sseService.checkConnectionLimit).toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/event-stream',
    }));
    expect(sseService.registerWorkflowClient).toHaveBeenCalled();
  });
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
