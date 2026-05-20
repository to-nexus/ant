/**
 * GET /api/jobs/baseline-estimate — endpoint contract guard.
 *
 * Locks the four response codes the FE depends on:
 *   - 400 when intent / projectId / featureName missing
 *   - 400 when intent is unmapped
 *   - 503 when Anthropic countTokens fails (FE hides the gauge — honest)
 *   - 200 with a BaselineEstimate JSON body on success
 *
 * The estimator itself is mocked so this test never depends on
 * `ANTHROPIC_API_KEY` or template loading; the faithfulness of the
 * compaction call is locked separately by `compaction-faithfulness.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { BaselineEstimate } from '@ant/shared';

vi.mock('../../../src/periphery/adapters/http/middleware/rateLimiter', () => ({
  chatRateLimiter: (_req: any, _res: any, next: any) => next(),
  jobExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

// `extractUserContext` reads cookies/headers via `getUserContextFromRequest`.
// For unit-test mode we shortcut it.
vi.mock('../../../src/periphery/adapters/http/routes/helpers/userContext', () => ({
  extractUserContext: () => ({ userId: 'u1', organizationId: 'o1' }),
}));

const estimateSpy = vi.fn();
class FakeError extends Error {
  constructor(public readonly kind: string, msg: string) {
    super(msg);
    this.name = 'BaselineEstimateError';
  }
}
vi.mock('../../../src/core/baselineEstimate/estimator', () => ({
  estimateBaseline: (...args: any[]) => estimateSpy(...args),
  BaselineEstimateError: FakeError,
}));

import { createJobRoutes } from '../../../src/periphery/adapters/http/routes/job.routes';

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

const fakeResolver: any = {
  getFeaturePath: (_uc: any, _pid: string, fname: string) => `/tmp/ws/${fname}`,
};
const fakeDeps: any = {
  workspaceResolver: fakeResolver,
  executeJob: vi.fn(),
  cleanupJobState: vi.fn(),
  workflowStateService: {},
  chatService: { appendAssistantMessage: vi.fn() },
  stateStore: {
    getKey: async () => null,
    setKeyWithTTL: async () => {},
    getJobStatus: async () => null,
  },
  stateTracker: { activeJobs: new Map() },
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes(fakeDeps));
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

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

const sampleEstimate: BaselineEstimate = {
  heaviestNode: { job: 'code', node: 'decompose', reason: 'static-max' },
  staticFloor: { tokens: 0 },
  dynamic: { racBodyTokens: 0, userMessageTokens: 0 },
  total: 8_421,
  contextWindow: 200_000,
  modelId: 'claude-opus-4-7',
  timing: 'T0',
};

describe('GET /api/jobs/baseline-estimate', () => {
  it('400 when intent is missing', async () => {
    const res = await fetch(
      `${baseUrl}/jobs/baseline-estimate?projectId=p&featureName=f`,
    );
    expect(res.status).toBe(400);
  });

  it('400 when projectId is missing', async () => {
    const res = await fetch(
      `${baseUrl}/jobs/baseline-estimate?intent=gen-code-spec&featureName=f`,
    );
    expect(res.status).toBe(400);
  });

  it('400 when featureName is missing', async () => {
    const res = await fetch(
      `${baseUrl}/jobs/baseline-estimate?intent=gen-code-spec&projectId=p`,
    );
    expect(res.status).toBe(400);
  });

  it('400 when estimator throws BaselineEstimateError("intent-unmapped")', async () => {
    estimateSpy.mockRejectedValueOnce(
      new FakeError('intent-unmapped', 'no such intent'),
    );
    const res = await fetch(
      `${baseUrl}/jobs/baseline-estimate?intent=fake-intent&projectId=p&featureName=f`,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('intent-unmapped');
  });

  it('503 when estimator throws BaselineEstimateError("count-tokens-unavailable")', async () => {
    estimateSpy.mockRejectedValueOnce(
      new FakeError('count-tokens-unavailable', 'network blip'),
    );
    const res = await fetch(
      `${baseUrl}/jobs/baseline-estimate?intent=gen-code-spec&projectId=p&featureName=f`,
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('count_tokens unavailable');
    expect(body.reason).toBe('network blip');
  });

  it('200 with BaselineEstimate JSON on success + propagates query args to estimator', async () => {
    estimateSpy.mockClear();
    estimateSpy.mockResolvedValueOnce(sampleEstimate);
    const url =
      `${baseUrl}/jobs/baseline-estimate?intent=gen-code-spec&projectId=p&featureName=f` +
      `&draftText=hello&refs=a.md,b.md&context=c.md`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BaselineEstimate;
    expect(body).toEqual(sampleEstimate);

    expect(estimateSpy).toHaveBeenCalledTimes(1);
    const args = estimateSpy.mock.calls[0][0];
    expect(args.intent).toBe('gen-code-spec');
    expect(args.refs).toEqual(['a.md', 'b.md']);
    expect(args.context).toEqual(['c.md']);
    expect(args.draftText).toBe('hello');
    expect(args.tenantScope).toEqual({
      orgId: 'o1',
      userId: 'u1',
      projectId: 'p',
      featureName: 'f',
    });
  });

  it('does not hijack /jobs/:jobId/status — route ordering guard', async () => {
    // If /jobs/baseline-estimate were declared AFTER /jobs/:jobId/status,
    // express would match `jobId=baseline-estimate` first and our route
    // would never fire. This guard locks the ordering by exercising the
    // status route for a jobId that does NOT match `baseline-estimate`.
    const res = await fetch(`${baseUrl}/jobs/some-job-123/status`);
    // No stateStore.getJobStatus stub => returns 404 from the session
    // fallback (projectId/featureName missing). What matters: NOT 400
    // from baseline-estimate's validation.
    expect(res.status).toBe(404);
  });
});
