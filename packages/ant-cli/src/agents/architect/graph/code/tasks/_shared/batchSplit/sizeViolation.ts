import type { FlatPlanGateMetrics } from './sizeGate';

/**
 * Size-gate violation — thrown by `processDiagnosticBatchSplit` when a
 * flat plan trips `evaluateFlatPlanSizeGate` and the task still has
 * reframe budget. Structural twin of `BatchSplitSchemaViolation`: the
 * plan-node catch turns it into a forced re-partition with framing rather
 * than letting an over-large flat plan ride into the recursion crash.
 *
 * Carries the over-large flat plan verbatim so the framing can embed it —
 * the LLM re-partitions what it already produced, with NO new
 * investigation (dim-beating-brass user directive #2).
 */
export interface FlatPlanTooLargeDetail extends FlatPlanGateMetrics {
  /** The over-large flat plan text, reused verbatim in the framing. */
  flatPlanText: string;
}

export class FlatPlanTooLargeViolation extends Error {
  readonly detail: FlatPlanTooLargeDetail;
  constructor(detail: FlatPlanTooLargeDetail) {
    super(
      `FlatPlanTooLargeViolation: ${detail.topLevelImplCount} entries across ` +
      `${detail.distinctTopLevelDomains} domains (est ${detail.estRoundTrips} rounds ` +
      `vs ${detail.remainingRecursionBudget} budget)`,
    );
    this.detail = detail;
    this.name = 'FlatPlanTooLargeViolation';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Build the prompt suffix appended (via `state._batchSplitViolationFraming`,
 * the shared plan-retry framing slot) to the next plan-LLM call. It embeds
 * the flat plan verbatim and asks
 * the LLM to re-partition it into `batches[]` along investigation/domain
 * boundaries — explicitly forbidding fresh investigation so the reframe
 * round is a slim re-emission, not a second exploration.
 */
export function buildFlatPlanTooLargeFraming(e: FlatPlanTooLargeViolation): string {
  const { flatPlanText, topLevelImplCount, distinctTopLevelDomains, domainSamples, estRoundTrips, remainingRecursionBudget } = e.detail;
  const domains = domainSamples.length > 0 ? domainSamples.join(', ') : '(multiple areas)';
  return [
    '',
    '⚠️  Your previous plan is a single FLAT `implementation` block that is too large to close in one execute session:',
    `- ${topLevelImplCount} top-level entries spanning ${distinctTopLevelDomains} distinct domains (${domains}).`,
    `- Estimated work ≈ ${estRoundTrips} execute rounds, but only ~${remainingRecursionBudget} recursion rounds remain. A single execute session for this scope read-thrashes and crashes before writing code.`,
    '',
    'You have ALREADY done the investigation — do NOT re-investigate or call tools. Re-emit the SAME work as `batches[]`, splitting along the investigation/domain boundaries you already found (one batch per investigation footprint; for an aggregator, one batch per feature domain plus a dedicated batch for any cross-cutting wiring). Do NOT change the scope — only group your existing entries into batches.',
    '',
    'Each `batches[]` entry MUST carry `name` (noun-phrase identifier), `rationale` (why it is one isolated unit), `parallelGroup` (lane name), and `priorityInParallelGroup` (non-negative integer, distinct within a lane). Put `parentReasoning` at the top naming the cross-batch contracts (shared export names, file paths, types). Carry each original entry\'s intent into the matching batch\'s `rationale`.',
    '',
    'Here is your flat plan to re-partition (regroup it; do not expand or shrink its scope):',
    flatPlanText,
    '',
  ].join('\n');
}
