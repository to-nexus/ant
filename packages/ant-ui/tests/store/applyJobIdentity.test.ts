/**
 * `applyJobIdentity` — the SSOT writer of the (selectedAgent, selectedJobType)
 * pair. Every identity-change site (toolbar, job-list selection, live
 * re-convergence, feature-entry bootstrap) funnels through this, so the chat
 * toolbar's agent+job can no longer drift from the board.
 *
 * Locks: agent resolved from jobType when not given (canonical jobType→agent
 * map), explicit agent wins, currentJobId set only when supplied.
 */

import { describe, it, expect, vi } from 'vitest';
import { create } from 'zustand';

// SSEManager touches `window` at module init (DEV debug shim); applyJobIdentity
// only calls `updateJobParam`. Stub it so the import graph resolves in node.
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: { updateJobParam: () => {} },
}));

import { createAuthSlice, type AuthSlice } from '../../src/domain/store/slices/authSlice';

function makeStore() {
  return create<AuthSlice>()((set, get, store) => createAuthSlice(set, get, store));
}

describe('applyJobIdentity', () => {
  it('resolves the agent from the job type when none is given', () => {
    const s = makeStore();
    s.getState().applyJobIdentity({ jobType: 'plan' });
    expect(s.getState().selectedJobType).toBe('plan');
    expect(s.getState().selectedAgent).toBe('planner');

    s.getState().applyJobIdentity({ jobType: 'code' });
    expect(s.getState().selectedJobType).toBe('code');
    expect(s.getState().selectedAgent).toBe('architect');

    s.getState().applyJobIdentity({ jobType: 'visual' });
    expect(s.getState().selectedAgent).toBe('creator');
  });

  it('honors an explicitly-supplied agent', () => {
    const s = makeStore();
    s.getState().applyJobIdentity({ jobType: 'code', agent: 'server-provided' });
    expect(s.getState().selectedAgent).toBe('server-provided');
  });

  it('sets currentJobId only when supplied', () => {
    const s = makeStore();
    expect((s.getState() as any).currentJobId).toBeUndefined();

    s.getState().applyJobIdentity({ jobType: 'design' });
    expect((s.getState() as any).currentJobId).toBeUndefined();

    s.getState().applyJobIdentity({ jobType: 'code', jobId: 'job-1' });
    expect((s.getState() as any).currentJobId).toBe('job-1');
  });
});
