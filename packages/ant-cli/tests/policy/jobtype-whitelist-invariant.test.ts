/**
 * jobtype-whitelist-invariant — Invariant I1
 *
 * Locks two contracts:
 *
 *  1. **Persistence (`isSessionableJobType`)** — BE enqueue paths
 *     (JobExecutionManager, RouteConfigurator) must NEVER silently
 *     downcast to `'code'` when the requested `jobType` falls outside
 *     `SessionableJobType`. The downcast was the root of the
 *     zonal-dreaming-novel regression — a paused plan-job's
 *     clarify-answer enqueue was converted into a brand-new code job by
 *     the JobExecutionManager.ts:43-45 ternary. `inline-ask` and `ask`
 *     are deliberately NOT sessionable (no session file under
 *     `sessions/{agent}/`).
 *
 *  2. **Dispatch (`isExecutableJobType`)** — `executeJob` accepts the
 *     executable union, which is `SessionableJobType ∪ {'inline-ask'}`.
 *     `inline-ask` flows through the same spawn / enqueue plumbing but
 *     skips session-read in `JobExecutionManager.handleSuccessfulExit`
 *     and is short-circuited by JobCleanupManager (`vast-curling-perch`
 *     resume blocker — see `docs/tmp/verify-rca-audit.md` §G).
 */

import { describe, it, expect } from 'vitest';
import {
  isSessionableJobType,
  isExecutableJobType,
  isNonTaskJob,
  NON_TASK_JOB_TYPES,
  SESSIONABLE_JOB_TYPES,
} from '@ant/shared';

describe('Invariant I1 — jobType whitelist', () => {
  it('isSessionableJobType accepts every sessionable union member', () => {
    for (const t of SESSIONABLE_JOB_TYPES) {
      expect(isSessionableJobType(t)).toBe(true);
    }
  });

  it('isSessionableJobType rejects ask / inline-ask (non-sessionable)', () => {
    expect(isSessionableJobType('ask')).toBe(false);
    expect(isSessionableJobType('inline-ask')).toBe(false);
  });

  it('isSessionableJobType rejects unknown / nullish values', () => {
    expect(isSessionableJobType(undefined)).toBe(false);
    expect(isSessionableJobType(null)).toBe(false);
    expect(isSessionableJobType('')).toBe(false);
    expect(isSessionableJobType('not-a-job')).toBe(false);
  });

  it('isExecutableJobType accepts every sessionable type plus inline-ask', () => {
    for (const t of SESSIONABLE_JOB_TYPES) {
      expect(isExecutableJobType(t)).toBe(true);
    }
    expect(isExecutableJobType('inline-ask')).toBe(true);
  });

  it('isExecutableJobType rejects ask / unknown / nullish values', () => {
    expect(isExecutableJobType('ask')).toBe(false);
    expect(isExecutableJobType(undefined)).toBe(false);
    expect(isExecutableJobType(null)).toBe(false);
    expect(isExecutableJobType('')).toBe(false);
    expect(isExecutableJobType('not-a-job')).toBe(false);
  });

  it('isNonTaskJob is true for plan and visual only', () => {
    expect(isNonTaskJob('plan')).toBe(true);
    expect(isNonTaskJob('visual')).toBe(true);
    expect(isNonTaskJob('code')).toBe(false);
    expect(isNonTaskJob('design')).toBe(false);
    expect(isNonTaskJob('learn')).toBe(false);
    expect(isNonTaskJob('ask')).toBe(false);
    expect(isNonTaskJob('inline-ask')).toBe(false);
    expect(isNonTaskJob(undefined)).toBe(false);
  });

  it('NON_TASK_JOB_TYPES set is the canonical [plan, visual] tuple', () => {
    expect([...NON_TASK_JOB_TYPES].sort()).toEqual(['plan', 'visual']);
  });

  it('SESSIONABLE_JOB_TYPES contains every union member exactly once', () => {
    expect([...SESSIONABLE_JOB_TYPES].sort()).toEqual(
      ['code', 'design', 'learn', 'plan', 'visual'],
    );
  });
});
