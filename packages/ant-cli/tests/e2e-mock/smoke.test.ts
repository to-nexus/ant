/**
 * E2E Mock Smoke Test — 서버 기본 동작 확인.
 *
 * pnpm dev:infra && pnpm dev:mock → pnpm test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  api,
  isServerRunning,
  ensureProjectAndFeature,
  enqueueJob,
  PROJECT_ID,
  FEATURE_NAME,
} from './helpers';

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable) {
    console.warn('⚠️  E2E mock server not running. Skipping smoke tests.');
    console.warn('    Start with: pnpm dev:infra && pnpm dev:mock');
  }
});

describe('E2E Mock Smoke', () => {

  it('health check', async (ctx) => {
    if (!serverAvailable) return ctx.skip();
    const res = await api('/api/health');
    expect(res.status).toBe(200);
  });

  it('project and feature setup', async (ctx) => {
    if (!serverAvailable) return ctx.skip();
    await ensureProjectAndFeature();
  });

  it('enqueue code job', async (ctx) => {
    if (!serverAvailable) return ctx.skip();
    const jobId = await enqueueJob({
      jobType: 'code',
      directive: 'E2E smoke: hello world',
      actionMetadata: { explicit: true, intent: 'gen-code-directive' },
    });
    expect(jobId).toBeTruthy();
  });

  it('enqueue design job', async (ctx) => {
    if (!serverAvailable) return ctx.skip();
    const jobId = await enqueueJob({
      jobType: 'design',
      directive: 'E2E smoke: frontend system design',
      actionMetadata: { explicit: true, intent: 'gen-sys-fe' },
    });
    expect(jobId).toBeTruthy();
  });

  it('enqueue plan job', async (ctx) => {
    if (!serverAvailable) return ctx.skip();
    const jobId = await enqueueJob({
      jobType: 'plan',
      agent: 'planner',
      directive: 'E2E smoke: create a project plan',
      actionMetadata: { explicit: true, intent: 'gen-plan' },
    });
    expect(jobId).toBeTruthy();
  });
});
