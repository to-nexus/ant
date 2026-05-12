/**
 * E2E Intent Matrix Test
 *
 * 22개 intent fixture를 실제 서버에 enqueue → status polling → 완료/실패 확인.
 * MockLLMClient가 각 노드 파서 형식에 맞는 응답을 반환해야 파이프라인이 완주된다.
 *
 * 사용법:
 *   pnpm dev:infra && pnpm dev:mock
 *   pnpm test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { FIXTURES } from '../intents/dataset';
import {
  isServerRunning,
  ensureProjectAndFeature,
  enqueueJob,
  pollUntilDone,
  PROJECT_ID,
} from './helpers';

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable) {
    console.warn('⚠️  E2E mock server not running. Skipping intent E2E tests.');
    return;
  }
});

describe('E2E Intent Matrix', () => {
  for (const fixture of FIXTURES) {
    const label = fixture.intent;
    const featureName = `e2e-${fixture.intent}`.replace(/[^a-z0-9-]/g, '-');

    it(label, { timeout: 120_000 }, async (ctx) => {
      if (!serverAvailable) return ctx.skip();

      await ensureProjectAndFeature(featureName);

      const jobId = await enqueueJob({
        jobType: fixture.routing.jobType,
        agent: fixture.routing.agent,
        directive: fixture.directive,
        actionMetadata: {
          explicit: true,
          intent: fixture.intent,
          refs: fixture.metadata.refs,
          context: fixture.metadata.context,
        },
        feature: featureName,
      });

      expect(jobId).toBeTruthy();

      const result = await pollUntilDone(jobId);

      if (result.status === 'failed') {
        console.warn(`  [${label}] FAILED: ${result.error}`);
      }

      expect(
        result.status,
        `Job ${label} ended with: ${result.status} — ${result.error || 'ok'}`,
      ).toBe('completed');
    });
  }
});
