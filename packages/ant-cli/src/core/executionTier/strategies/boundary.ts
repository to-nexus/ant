/**
 * Boundary operation strategies.
 *
 * A boundary terminates the current user_turn context and triggers the
 * primary Collapse (§4.2). Variants:
 *   - {@link NoopBoundary}          — tiers that never emit boundary
 *   - {@link AutoCompleteBoundary}  — Tier 3 generate/refactor
 *   - {@link ExplainOnlyBoundary}   — Tier 3 explain (Boundary only;
 *                                     Breadcrumb is Noop on that axis)
 *
 * AutoComplete and ExplainOnly share the same `reason:
 * 'auto_job_complete_todo'` on-disk literal. The literal is intentionally
 * preserved across the 5-tier rename so older `feature.jsonl` lines stay
 * readable (see `FileSessionAdapter.normalizeLegacyComplexity`).
 *
 * Collapse is invoked transitively: `apply` writes the boundary via
 * `SessionPort.appendBoundary` (which itself performs the atomic
 * collapse), then delegates to the injected {@link CollapseStrategy} so
 * future collapse variants can piggy-back on the write path.
 */

import type { FeatureBoundaryLine } from '@ant/shared';
import type { ExecutionTierState } from '../types';
import type { CollapseStrategy } from './collapse';

export interface BoundaryStrategy {
  apply(state: ExecutionTierState): Promise<void>;
}

export class NoopBoundary implements BoundaryStrategy {
  async apply(): Promise<void> {
    /* noop — tier does not emit boundary */
  }
}

abstract class AutoBoundaryBase implements BoundaryStrategy {
  constructor(protected readonly collapse: CollapseStrategy) {}

  async apply(state: ExecutionTierState): Promise<void> {
    const session = state.deps?.session;
    const { jobId, turnId } = state;
    if (!session || !jobId || !turnId) return;

    const boundary: FeatureBoundaryLine = {
      type: 'boundary',
      ts: new Date().toISOString(),
      jobId,
      turnId,
      jobType: 'code',
      reason: 'auto_job_complete_todo',
    };
    try {
      await session.appendBoundary(boundary);
      await this.collapse.apply(session, boundary);
      console.log(`📌 [Tier] boundary appended (reason=${boundary.reason})`);
    } catch (err) {
      console.warn('⚠️  [Tier] appendBoundary failed:', err);
    }
  }
}

/** Tier 3 generate/refactor — boundary paired with full breadcrumb. */
export class AutoCompleteBoundary extends AutoBoundaryBase {}

/** Tier 3 explain — boundary only (breadcrumb axis is Noop). */
export class ExplainOnlyBoundary extends AutoBoundaryBase {}

export const noopBoundary = new NoopBoundary();
