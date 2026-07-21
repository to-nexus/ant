/**
 * E2-4 BE — Context Lens panel endpoints contract guard.
 *
 * GET /context/lens — band bodies (exchanges/digests/ledger/summary) from
 *     the same buildFeatureContext assembly as /context/estimate.
 * (POST /context/pin was removed — the ledger grows only via the automatic
 * distill → compaction-union path; there is no user pin.)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';

vi.mock('../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'u1', organizationId: 'o1' }),
  isLocalServerMode: () => true,
}));

const loadSinceBoundaryMock = vi.fn();
const appendContextSummaryMock = vi.fn();
vi.mock('../../src/periphery/adapters/session/FileSessionAdapter', () => ({
  FileSessionAdapter: class {
    loadSinceBoundary = loadSinceBoundaryMock;
    appendContextSummary = appendContextSummaryMock;
  },
}));

const buildFeatureContextMock = vi.fn();
vi.mock('../../src/core/context/featureContextBuilder', () => ({
  buildFeatureContext: (...args: unknown[]) => buildFeatureContextMock(...args),
}));

import { createFeatureLogRoutes } from '../../src/periphery/adapters/http/routes/feature-log.routes';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createFeatureLogRoutes({
    workspaceResolver: { getFeaturePath: () => '/tmp/ws/f1' },
  }));
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('listen failed');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  loadSinceBoundaryMock.mockReset().mockResolvedValue({
    userTurns: [], userTurnMetas: [], breadcrumbs: [], assistantTurns: [], contextSummaries: [],
  });
  appendContextSummaryMock.mockReset().mockResolvedValue(undefined);
  buildFeatureContextMock.mockReset();
});

describe('GET /context/lens', () => {
  it('returns band bodies from buildFeatureContext', async () => {
    buildFeatureContextMock.mockResolvedValue({
      breadcrumbs: [],
      userTurns: [],
      exchanges: [{ turnId: 't1', ts: '2026-07-21T00:00:00.000Z', userText: 'u', assistantFinalText: 'a' }],
      digests: [{ turnId: 't0', ts: '2026-07-20T00:00:00.000Z', digest: { decisions: ['d'], constraints: ['c'], outcome: 'o' } }],
      constraintLedger: ['use port 4200 only'],
      summary: 'rolling summary',
    });

    const res = await fetch(`${baseUrl}/projects/p1/features/f1/context/lens`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exchanges).toHaveLength(1);
    expect(body.digests).toHaveLength(1);
    expect(body.ledger).toEqual(['use port 4200 only']);
    expect(body.summary).toBe('rolling summary');
  });

  it('returns empty bands when context is absent', async () => {
    buildFeatureContextMock.mockResolvedValue(undefined);
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/context/lens`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ exchanges: [], digests: [], ledger: [], summary: null });
  });
});

describe('removed POST /context/pin', () => {
  it('is no longer routed (user pin retired — auto distill/union only)', async () => {
    const res = await fetch(`${baseUrl}/projects/p1/features/f1/context/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'anything' }),
    });
    expect(res.status).toBe(404);
    expect(appendContextSummaryMock).not.toHaveBeenCalled();
  });
});
