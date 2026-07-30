import { describe, it, expect, vi } from 'vitest';
import { createResolveNode } from '../../../src/agents/common/graph/nodes/resolve';
import type { ResolvableState } from '../../../src/agents/common/graph/nodes/resolve';

/**
 * `createResolveNode` is generic over the graph's state shape, and its return is
 * `Partial<T>`. Without a type argument `T` collapses to the bare
 * `ResolvableState`, which carries none of the job fields the strategies below
 * actually return — so the assertions read properties the compiler says do not
 * exist. Declaring the probe state is what the generic is for.
 */
interface ProbeState extends ResolvableState {
  jobId?: string;
  turnId?: string;
  loadedJobId?: string;
  loadedTurnId?: string;
  from?: string;
  recursionLimit?: number;
}

describe('createResolveNode init-state propagation', () => {
  it('propagates initNewJob result to loadArtifacts in the same resolve turn', async () => {
    const loadArtifacts = vi.fn(async (state: any) => ({
      loadedJobId: state.jobId,
      loadedTurnId: state.turnId,
    }));
    const onResume = vi.fn(async () => ({}));
    const initNewJob = vi.fn(async () => ({
      jobId: 'clean-handing-dream',
      turnId: 't-4efa948b',
    }));

    const resolve = createResolveNode<ProbeState>({
      initNewJob,
      loadArtifacts,
      onResume,
    } as any);

    const state: ProbeState = {
      isResume: false,
      context: {},
      directive: '',
      deps: {},
      recursionLimit: 12,
    };

    const result = await resolve(state);

    expect(initNewJob).toHaveBeenCalledTimes(1);
    expect(loadArtifacts).toHaveBeenCalledTimes(1);
    expect(loadArtifacts.mock.calls[0][0].jobId).toBe('clean-handing-dream');
    expect(result.jobId).toBe('clean-handing-dream');
    expect(result.loadedJobId).toBe('clean-handing-dream');
    expect(result.loadedTurnId).toBe('t-4efa948b');
  });

  it('skips initNewJob and uses onResume path for resumed jobs', async () => {
    const initNewJob = vi.fn(async () => ({ jobId: 'new-job' }));
    const loadArtifacts = vi.fn(async () => ({ from: 'loadArtifacts' }));
    const onResume = vi.fn(async () => ({ from: 'resume' }));

    const resolve = createResolveNode<ProbeState>({
      initNewJob,
      loadArtifacts,
      onResume,
    } as any);

    const result = await resolve({
      isResume: true,
      context: {},
      directive: '',
      deps: {},
    } as any);

    expect(initNewJob).not.toHaveBeenCalled();
    expect(loadArtifacts).not.toHaveBeenCalled();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(result.from).toBe('resume');
  });
});
