/**
 * Breadcrumb operation strategies.
 *
 * Variants:
 *   - {@link NoopBreadcrumb}  — tiers that never emit breadcrumbs (0 / 1 / 3-explain)
 *   - {@link MiniBreadcrumb}  — Tier 2 SingleTask; emit only when touched ≥ 3
 *   - {@link FullBreadcrumb}  — Tier 3 Task (generate/refactor); always emit
 *
 * Strategies are stateless singletons (module-level `const` via `new X()`).
 * The Tier facade composes the variant it needs in its constructor — the
 * operation method itself MUST NOT compare `mode` / `complexity` literals
 * (D11 invariant).
 */

import {
  buildBreadcrumb,
  buildBreadcrumbSummary,
  collectTouchedFilesFromChatLog,
  type TouchedFromChatLog,
} from '../../context/breadcrumb';
import type { ExecutionTierState } from '../types';

/** Threshold for the Tier 2 SingleTask mini-breadcrumb (§2.4). */
export const MINI_BREADCRUMB_TOUCHED_THRESHOLD = 3;

export interface BreadcrumbStrategy {
  apply(state: ExecutionTierState, touched?: TouchedFromChatLog): Promise<void>;
}

export class NoopBreadcrumb implements BreadcrumbStrategy {
  async apply(): Promise<void> {
    /* intentionally empty — tiers that do not record breadcrumbs */
  }
}

/**
 * Shared breadcrumb write path. Loads touched-file metadata from trace when
 * the caller did not pre-compute it, builds the breadcrumb line, and
 * appends via SessionPort. Logs + swallows failures so a breadcrumb miss
 * never aborts the owning node.
 */
async function writeBreadcrumb(
  state: ExecutionTierState,
  preComputedTouched: TouchedFromChatLog | undefined,
): Promise<void> {
  const session = state.deps?.session;
  if (!session) return;
  const { jobId, turnId } = state;
  if (!jobId || !turnId) return;

  const touched =
    preComputedTouched ?? (await collectTouchedFilesFromChatLog(session, turnId));
  const touchedCount = touched.all.size;
  const mode = state.resolvedAction?.mode as
    | 'explain'
    | 'generate'
    | 'refactor'
    | undefined;

  const anchorsSource = Array.from(touched.all);
  const summary = buildBreadcrumbSummary({
    directive: state.directive || '',
    touchedCount,
    mode,
  });
  const breadcrumb = buildBreadcrumb({
    jobId,
    turnId,
    jobType: 'code',
    mode,
    touched: anchorsSource,
    created: touched.created,
    modified: touched.modified,
    deleted: touched.deleted,
    summary,
    traceRangeRef: touched.range,
  });

  try {
    await session.appendBreadcrumb(breadcrumb);
    console.log(
      `📝 [Tier] breadcrumb appended (scope=${breadcrumb.scope} touched=${touchedCount})`,
    );
  } catch (err) {
    console.warn('⚠️  [Tier] appendBreadcrumb failed:', err);
  }
}

/**
 * Exploratory mini-breadcrumb: only emit when at least
 * {@link MINI_BREADCRUMB_TOUCHED_THRESHOLD} files were touched. Below the
 * threshold the noise/signal ratio of a breadcrumb is too low and we
 * prefer to keep feature.jsonl quiet.
 */
export class MiniBreadcrumb implements BreadcrumbStrategy {
  async apply(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
  ): Promise<void> {
    const session = state.deps?.session;
    if (!session || !state.turnId) return;
    const observed =
      touched ?? (await collectTouchedFilesFromChatLog(session, state.turnId));
    if (observed.all.size < MINI_BREADCRUMB_TOUCHED_THRESHOLD) return;
    await writeBreadcrumb(state, observed);
  }
}

/** Full breadcrumb — always emit for generate / refactor Task tier. */
export class FullBreadcrumb implements BreadcrumbStrategy {
  async apply(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
  ): Promise<void> {
    await writeBreadcrumb(state, touched);
  }
}

export const noopBreadcrumb = new NoopBreadcrumb();
export const miniBreadcrumb = new MiniBreadcrumb();
export const fullBreadcrumb = new FullBreadcrumb();
