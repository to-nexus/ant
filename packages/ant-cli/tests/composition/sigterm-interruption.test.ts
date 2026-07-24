import { describe, it, expect } from 'vitest';
import { resolveKillReason, buildSigtermInterruption } from '../../src/composition/sigtermInterruption.js';

// A minimal Redis-shaped stub exposing only `.get`, which is all
// resolveKillReason touches.
const redisReturning = (value: string | null | Promise<string | null>) =>
  ({ get: async () => (value instanceof Promise ? value : value) } as any);

const NEVER = new Promise<string | null>(() => { /* never resolves → 100ms race wins */ });

// Regression guard for `pure-logging-orbit`: a rolling-deploy SIGTERM was
// mislabeled `server_crash` ("terminated unexpectedly", a defect-class reason)
// instead of `server_shutdown`. Reaching the SIGTERM handler proves a graceful
// signal, so a missing/unreadable kill-reason must fall back to server_shutdown.
describe('resolveKillReason', () => {
  it('falls back to server_shutdown when no Redis handle is available', async () => {
    expect(await resolveKillReason('job-1', null)).toBe('server_shutdown');
    expect(await resolveKillReason('job-1', undefined)).toBe('server_shutdown');
  });

  it('falls back to server_shutdown when the kill-reason key is missing', async () => {
    expect(await resolveKillReason('job-1', redisReturning(null))).toBe('server_shutdown');
  });

  it('falls back to server_shutdown when the Redis read exceeds the 100ms budget', async () => {
    expect(await resolveKillReason('job-1', redisReturning(NEVER))).toBe('server_shutdown');
  });

  it('falls back to server_shutdown when the Redis read throws', async () => {
    const throwing = { get: async () => { throw new Error('conn refused'); } } as any;
    expect(await resolveKillReason('job-1', throwing)).toBe('server_shutdown');
  });

  it('never falls back to the defect-class server_crash inside the SIGTERM handler', async () => {
    for (const redis of [null, redisReturning(null), redisReturning(NEVER)]) {
      expect(await resolveKillReason('job-1', redis as any)).not.toBe('server_crash');
    }
  });

  it('preserves a specific reason written by the worker', async () => {
    for (const reason of ['user_stopped', 'worker_stalled', 'lock_expired', 'system_sleep', 'server_shutdown']) {
      const redis = redisReturning(JSON.stringify({ reason }));
      expect(await resolveKillReason('job-1', redis)).toBe(reason);
    }
  });
});

describe('buildSigtermInterruption', () => {
  it('produces the non-alarming graceful message for server_shutdown (code = resumable)', () => {
    const r = buildSigtermInterruption('server_shutdown', 'code');
    expect(r.reason).toBe('server_shutdown');
    expect(r.canResume).toBe(true);
    expect(r.message).toBe('Server is shutting down. You can resume this job.');
  });

  it('gates canResume via the single owner — plan is not mid-graph resumable', () => {
    expect(buildSigtermInterruption('server_shutdown', 'plan').canResume).toBe(false);
  });

  it('routes user_stopped to the terminal finalize payload', () => {
    const r = buildSigtermInterruption('user_stopped', 'code');
    expect(r.reason).toBe('user_stopped');
    expect(r.message).toBe('Task stopped by user');
    expect(r.metadata).toMatchObject({ stoppedBy: 'user_action' });
  });
});
