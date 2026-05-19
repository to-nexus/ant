/**
 * POST /cloud-ide/reset — HTTP handler contract.
 *
 *   1. Missing projectId → 400.
 *   2. Orchestrator success → 200 with `{ success: true, cleared: { pod, stateStore } }`.
 *   3. Orchestrator failure (success:false) → 500.
 *
 * JWT authentication is enforced by `setupIdeProxyAuth` middleware mounted
 * BEFORE this router in `ServerConfigurator` — out of scope for the route
 * handler unit test. Set ANT_SERVER_MODE=local so `extractUserContext` falls
 * back to local-default identity without needing a JWT.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createCloudIDERoutes } from '../../src/periphery/adapters/http/routes/cloud-ide.routes';
import type { IDEOrchestratorPort } from '../../src/core/ports/ideOrchestrator';

const ORIGINAL_MODE = process.env.ANT_SERVER_MODE;

function makeOrchestrator(forceResetImpl: (...args: any[]) => Promise<any>): IDEOrchestratorPort {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    forceReset: vi.fn(forceResetImpl),
    getStatus: vi.fn(),
    list: vi.fn(),
    listByUser: vi.fn(),
    cleanupProject: vi.fn(),
    cleanup: vi.fn(),
    startIdleCheck: vi.fn(),
    stopIdleCheck: vi.fn(),
  } as unknown as IDEOrchestratorPort;
}

async function startApp(orchestrator: IDEOrchestratorPort): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/cloud-ide', createCloudIDERoutes(orchestrator, {} as any, undefined, undefined));

  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe('POST /cloud-ide/reset', () => {
  beforeAll(() => {
    process.env.ANT_SERVER_MODE = 'local'; // bypass JWT — fall back to local default tenant
  });
  afterAll(() => {
    if (ORIGINAL_MODE === undefined) delete process.env.ANT_SERVER_MODE;
    else process.env.ANT_SERVER_MODE = ORIGINAL_MODE;
  });

  let app: Awaited<ReturnType<typeof startApp>>;
  let orchestrator: IDEOrchestratorPort;

  beforeEach(async () => {
    if (app) await app.close();
  });

  it('returns 400 when projectId is missing', async () => {
    orchestrator = makeOrchestrator(async () => ({ success: true }));
    app = await startApp(orchestrator);

    const res = await fetch(`${app.url}/cloud-ide/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureName: 'main' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/projectId/);
    expect((orchestrator.forceReset as any)).not.toHaveBeenCalled();
  });

  it('returns 200 + cleared:{pod,stateStore} on success', async () => {
    orchestrator = makeOrchestrator(async () => ({ success: true }));
    app = await startApp(orchestrator);

    const res = await fetch(`${app.url}/cloud-ide/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj', featureName: 'main' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, cleared: { pod: true, stateStore: true } });
    expect((orchestrator.forceReset as any)).toHaveBeenCalledTimes(1);
    expect((orchestrator.forceReset as any)).toHaveBeenCalledWith(
      expect.stringContaining(':'),
      'proj',
      'main',
    );
  });

  it('defaults featureName to RESERVED_FEATURE_NAME when omitted', async () => {
    orchestrator = makeOrchestrator(async () => ({ success: true }));
    app = await startApp(orchestrator);

    const res = await fetch(`${app.url}/cloud-ide/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj' }),
    });

    expect(res.status).toBe(200);
    const [, , feature] = (orchestrator.forceReset as any).mock.calls[0];
    expect(feature).toBeTruthy(); // RESERVED_FEATURE_NAME is non-empty
  });

  it('returns 500 when orchestrator.forceReset reports success:false', async () => {
    orchestrator = makeOrchestrator(async () => ({ success: false, message: 'state-store still has stale mapping' }));
    app = await startApp(orchestrator);

    const res = await fetch(`${app.url}/cloud-ide/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj', featureName: 'main' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/state-store/);
  });
});
