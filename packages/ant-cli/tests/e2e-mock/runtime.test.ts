/**
 * E2E Runtime Variation Test
 *
 * language x environment 조합 변형.
 * ts/go x frontend/backend/fullstack = 6 시나리오.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isServerRunning,
  ensureProjectAndFeature,
  enqueueJob,
  pollUntilDone,
} from './helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

const DIRECTIVES: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../intents/documents/directives.json'), 'utf-8'),
);

let serverAvailable = false;

beforeAll(async () => {
  serverAvailable = await isServerRunning();
  if (!serverAvailable) {
    console.warn('⚠️  E2E mock server not running. Skipping runtime tests.');
  }
});

interface RuntimeCase {
  label: string;
  jobType: string;
  agent: string;
  intent: string;
  directive: string;
}

const RUNTIME_CASES: RuntimeCase[] = [
  {
    label: 'ts-frontend-code',
    jobType: 'code', agent: 'architect',
    intent: 'gen-code-directive',
    directive: DIRECTIVES['_runtime:ts-frontend'],
  },
  {
    label: 'ts-backend-code',
    jobType: 'code', agent: 'architect',
    intent: 'gen-code-directive',
    directive: DIRECTIVES['_runtime:ts-backend'],
  },
  {
    label: 'ts-fullstack-code',
    jobType: 'code', agent: 'architect',
    intent: 'gen-code-directive',
    directive: DIRECTIVES['_runtime:ts-fullstack'],
  },
  {
    label: 'go-backend-code',
    jobType: 'code', agent: 'architect',
    intent: 'gen-code-directive',
    directive: DIRECTIVES['_runtime:go-backend'],
  },
  {
    label: 'go-frontend-design',
    jobType: 'design', agent: 'architect',
    intent: 'gen-sys-fe',
    directive: DIRECTIVES['_runtime:go-fe-design'],
  },
  {
    label: 'ts-backend-design',
    jobType: 'design', agent: 'architect',
    intent: 'gen-sys-be',
    directive: DIRECTIVES['_runtime:ts-be-design'],
  },
];

describe('E2E Runtime Variations', () => {
  for (const rc of RUNTIME_CASES) {
    const featureName = `e2e-rt-${rc.label}`;

    it(rc.label, { timeout: 120_000 }, async (ctx) => {
      if (!serverAvailable) return ctx.skip();

      await ensureProjectAndFeature(featureName);

      const jobId = await enqueueJob({
        jobType: rc.jobType,
        agent: rc.agent,
        directive: rc.directive,
        actionMetadata: {
          explicit: true,
          intent: rc.intent,
        },
        feature: featureName,
      });

      expect(jobId).toBeTruthy();

      const result = await pollUntilDone(jobId);

      if (result.status === 'failed') {
        console.warn(`  [${rc.label}] FAILED: ${result.error}`);
      }

      expect(
        result.status,
        `Runtime ${rc.label} ended with: ${result.status} — ${result.error || 'ok'}`,
      ).toBe('completed');
    });
  }
});
