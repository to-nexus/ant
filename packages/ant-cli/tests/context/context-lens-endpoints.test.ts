/**
 * E2-4 BE — Context Lens panel endpoints contract guard.
 *
 * GET  /context/lens — band bodies (exchanges/digests/ledger/summary) from
 *      the same buildFeatureContext assembly as /context/estimate.
 * POST /context/pin — ledger promotion: appends a NEW context_summary line
 *      that verbatim-carries the previous checkpoint and unions the pinned
 *      text into constraintLedger. Never folds live lines (epoch sentinel
 *      when no prior checkpoint exists); idempotent on duplicate text.
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

describe('POST /context/pin', () => {
  const pin = (text: unknown) =>
    fetch(`${baseUrl}/projects/p1/features/f1/context/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });

  it('400 when text is missing/empty', async () => {
    expect((await pin('')).status).toBe(400);
    expect((await pin('   ')).status).toBe(400);
    expect(appendContextSummaryMock).not.toHaveBeenCalled();
  });

  it('with no prior checkpoint: appends an epoch-sentinel checkpoint that folds nothing', async () => {
    const res = await pin('always use aurora tokens');
    expect(res.status).toBe(200);
    expect((await res.json()).ledger).toEqual(['always use aurora tokens']);

    expect(appendContextSummaryMock).toHaveBeenCalledTimes(1);
    const line = appendContextSummaryMock.mock.calls[0][0];
    expect(line.type).toBe('context_summary');
    expect(line.coversThroughTs).toBe('1970-01-01T00:00:00.000Z');
    expect(line.summary).toBe('');
    expect(line.constraintLedger).toEqual(['always use aurora tokens']);
  });

  it('with a prior checkpoint: verbatim-carries summary/coversThroughTs and unions the ledger', async () => {
    loadSinceBoundaryMock.mockResolvedValue({
      userTurns: [], userTurnMetas: [], breadcrumbs: [], assistantTurns: [],
      contextSummaries: [{
        type: 'context_summary', ts: '2026-07-20T10:00:00.000Z', jobId: 'j1', turnId: 't1',
        jobType: 'code', coversThroughTs: '2026-07-20T09:00:00.000Z',
        summary: 'old summary', constraintLedger: ['existing constraint'],
      }],
    });

    const res = await pin('new pinned rule');
    expect(res.status).toBe(200);
    expect((await res.json()).ledger).toEqual(['existing constraint', 'new pinned rule']);

    const line = appendContextSummaryMock.mock.calls[0][0];
    expect(line.coversThroughTs).toBe('2026-07-20T09:00:00.000Z');
    expect(line.summary).toBe('old summary');
    expect(line.constraintLedger).toEqual(['existing constraint', 'new pinned rule']);
  });

  it('is idempotent: duplicate text appends no new checkpoint', async () => {
    loadSinceBoundaryMock.mockResolvedValue({
      userTurns: [], userTurnMetas: [], breadcrumbs: [], assistantTurns: [],
      contextSummaries: [{
        type: 'context_summary', ts: '2026-07-20T10:00:00.000Z', jobId: 'j1', turnId: 't1',
        jobType: 'code', coversThroughTs: '2026-07-20T09:00:00.000Z',
        summary: 's', constraintLedger: ['already pinned'],
      }],
    });

    const res = await pin('already pinned');
    expect(res.status).toBe(200);
    expect((await res.json()).ledger).toEqual(['already pinned']);
    expect(appendContextSummaryMock).not.toHaveBeenCalled();
  });
});
