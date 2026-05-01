/**
 * routeAfterDecompose — defense-in-depth guard against tier-0 + generate/refactor.
 *
 * validateExecutionTier + the decompose retry loop should prevent this
 * state from ever reaching the router, but if it does (e.g. stale
 * session, bypassed validation), routing must throw rather than
 * silently send the job to the read-only direct path.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeAfterDecompose } from '../../../src/agents/architect/graph/code/routing';
import type { ArchitectGraphState } from '../../../src/agents/architect/graph/code/state';
import { ExecutionTierId } from '@ant/shared';

function mkState(over: Partial<ArchitectGraphState>): ArchitectGraphState {
  return {
    awaitingDecomposeClarify: false,
    ...(over as any),
  } as ArchitectGraphState;
}

describe('routeAfterDecompose defense-in-depth', () => {
  it.each(['generate', 'refactor'] as const)(
    'throws when tier=0 with mode=%s',
    (mode) => {
      const state = mkState({
        executionTier: ExecutionTierId.Reflex,
        resolvedAction: { mode } as any,
      });
      expect(() => routeAfterDecompose(state)).toThrow(
        /executionTier=0 with mode=/,
      );
    },
  );

  it('allows tier=0 with mode=explain (direct path)', () => {
    const state = mkState({
      executionTier: ExecutionTierId.Reflex,
      resolvedAction: { mode: 'explain' } as any,
    });
    // Should not throw; should route to 'direct' via isDirectTier.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(routeAfterDecompose(state)).toBe('direct');
  });

  it.each([
    [ExecutionTierId.OneShot, 'direct'],
  ] as const)(
    'tier=%d + mode=refactor routes to %s',
    (tier, expected) => {
      const state = mkState({
        executionTier: tier,
        resolvedAction: { mode: 'refactor' } as any,
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(routeAfterDecompose(state)).toBe(expected);
    },
  );

  it('awaitingDecomposeClarify short-circuits to __end__ regardless of tier/mode', () => {
    const state = mkState({
      awaitingDecomposeClarify: true,
      executionTier: ExecutionTierId.Reflex,
      resolvedAction: { mode: 'refactor' } as any,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(routeAfterDecompose(state)).toBe('__end__');
  });
});
