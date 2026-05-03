/**
 * Breadcrumb operation strategies.
 *
 * Variants:
 *   - {@link NoopBreadcrumb} — kept for legacy strategy-slot callers; new
 *                              code should use {@link FullBreadcrumb} which
 *                              already self-skips on `mode='explain'` /
 *                              `touched=0`.
 *   - {@link FullBreadcrumb} — emit a breadcrumb with bubble-up anchors
 *                              and stats. job-context-bridge T3 unified
 *                              every tier on this strategy: the per-tier
 *                              `MiniBreadcrumb` + `MINI_BREADCRUMB_TOUCHED_THRESHOLD`
 *                              gate was removed because it silently lost
 *                              anchor info on small-but-meaningful changes.
 *
 * The strategy itself does NOT inspect tier id. Skip semantics are encoded
 * in `writeBreadcrumb`:
 *   - missing session / jobId / turnId   → skip (logged, T1 diagnostic)
 *   - resolvedAction.mode === 'explain'  → skip (no anchor by construction)
 *   - touched file count === 0           → skip (no useful pointer)
 */

import {
  buildBreadcrumb,
  collectTouchedFilesFromChatLog,
  type TouchedFromChatLog,
} from '../../context/breadcrumb';
import { buildLlmBreadcrumbSummary } from '../../context/breadcrumbSummary';
import type { ExecutionTierState } from '../types';

export interface BreadcrumbStrategy {
  apply(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
    options?: BreadcrumbEmitOptions,
  ): Promise<void>;
}

export interface BreadcrumbEmitOptions {
  /**
   * Bypass default skip gates (`mode='explain'`, `touched=0`).
   * Used for failure-context breadcrumbs where mutation anchors may be empty
   * but the failure itself must remain visible for the next turn.
   */
  forceEmit?: boolean;
  /** Optional summary override (e.g. failure-focused 1-line digest). */
  summaryOverride?: string;
}

export class NoopBreadcrumb implements BreadcrumbStrategy {
  async apply(
    _state?: ExecutionTierState,
    _touched?: TouchedFromChatLog,
    _options?: BreadcrumbEmitOptions,
  ): Promise<void> {
    /* intentionally empty — kept for callers that explicitly opt out of
     * BC emission (e.g. legacy tier slots). FullBreadcrumb already handles
     * mode='explain' / touched=0 internally, so most call sites should
     * use it directly. */
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
  options: BreadcrumbEmitOptions = {},
): Promise<void> {
  const session = state.deps?.session;
  if (!session) {
    // Silent skip is hostile to root-cause analysis: when BC stops
    // appearing in feature.jsonl the operator must immediately know
    // which precondition failed (job-context-bridge T1).
    console.warn('⚠️  [Tier] writeBreadcrumb skipped: session port unavailable');
    return;
  }
  const { jobId, turnId } = state;
  if (!jobId || !turnId) {
    console.warn(
      `⚠️  [Tier] writeBreadcrumb skipped: missing context ` +
        `(jobId=${jobId ?? 'undefined'}, turnId=${turnId ?? 'undefined'})`,
    );
    return;
  }

  const mode = state.resolvedAction?.mode as
    | 'explain'
    | 'generate'
    | 'refactor'
    | undefined;
  // Mode gate (job-context-bridge T3). explain mode is read-only by
  // contract; emitting a BC with empty anchors would inflate feature.jsonl
  // without giving the next job any pointer. Logged at debug level — this
  // is an expected skip, not a fault.
  if (mode === 'explain' && options.forceEmit !== true) {
    console.log("📝 [Tier] writeBreadcrumb skipped: mode='explain' (no anchors to record)");
    return;
  }

  const touched =
    preComputedTouched ?? (await collectTouchedFilesFromChatLog(session, turnId));
  const touchedCount = touched.all.size;
  // Touched gate (job-context-bridge T3). Replaces the legacy
  // MINI_BREADCRUMB_TOUCHED_THRESHOLD=3 gate; touched===0 is the only
  // case where a BC carries no information value (every other count is
  // a meaningful anchor target for the next job's tools).
  if (touchedCount === 0 && options.forceEmit !== true) {
    console.log('📝 [Tier] writeBreadcrumb skipped: touched=0 (no code change)');
    return;
  }

  const anchorsSource = Array.from(touched.all);
  // job-context-bridge T4 — LLM-generated noun-form summary. The helper
  // self-falls-back to the legacy directive paraphrase on any failure
  // path (missing llm/promptBuilder, timeout, empty output). BC line
  // emission is therefore never blocked on the LLM side.
  const summary =
    typeof options.summaryOverride === 'string' && options.summaryOverride.trim().length > 0
      ? options.summaryOverride.trim()
      : await buildLlmBreadcrumbSummary({
          directive: state.directive || '',
          mode,
          created: touched.created,
          modified: touched.modified,
          deleted: touched.deleted,
          touchedCount,
          llm: state.deps?.llm,
          promptPort: state.deps?.promptBuilder,
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
    // Identifier-bearing warn — pairs with `📝 [Learn] BC eval — …` so an
    // operator can decide between (a) the outer gate skipped emission and
    // (b) emission was attempted but the SessionPort write failed. Without
    // jobId/turnId here a silent-failure case is indistinguishable from
    // the gate-skip case.
    console.warn(
      `⚠️  [Tier] appendBreadcrumb failed (jobId=${jobId}, turnId=${turnId}, touched=${touchedCount}):`,
      err,
    );
  }
}

/**
 * Full breadcrumb — emit a BC line whenever code changed. Skips internally
 * for explain mode and touched=0; tier code does not need to gate by
 * mode/complexity literals (D11 invariant).
 */
export class FullBreadcrumb implements BreadcrumbStrategy {
  async apply(
    state: ExecutionTierState,
    touched?: TouchedFromChatLog,
    options?: BreadcrumbEmitOptions,
  ): Promise<void> {
    await writeBreadcrumb(state, touched, options);
  }
}

export const noopBreadcrumb = new NoopBreadcrumb();
export const fullBreadcrumb = new FullBreadcrumb();
