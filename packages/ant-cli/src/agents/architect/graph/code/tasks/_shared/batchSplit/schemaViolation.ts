/**
 * BatchSplit schema-violation channel — when the plan-LLM emits a
 * `batches[]` entry violating the framework's contract, the system
 * MUST NOT silently fix or fabricate values. Instead it throws this
 * typed error so the plan node can re-issue the call with violation
 * framing — mirrors the `ExecutionTierViolation` retry pattern in
 * `nodes/decompose/index.ts:548-826` SSOT.
 *
 * Validated fields per `batches[]` entry:
 *   - `name`                       (REQUIRED, non-empty string)
 *   - `rationale`                  (REQUIRED, non-empty string)
 *   - `parallelGroup`              (REQUIRED on slim-shape task types,
 *                                   non-empty string — lane identity)
 *   - `priorityInParallelGroup`    (REQUIRED on slim-shape task types,
 *                                   non-negative integer — sort offset
 *                                   added to parent priority; values
 *                                   MUST be distinct within a lane)
 *
 * The slim-shape requirement is gated by `BATCH_SPLIT_POLICY[type]
 * .siblingsSerialize`. Non-slim shapes (error / test-code /
 * verification) keep the legacy file-overlap path and do not advertise
 * the lane fields.
 *
 * The framing builder below produces the prompt suffix the next attempt
 * appends to the user message (decompose's `buildExecutionTierViolation
 * Framing` is the structural twin).
 */

export type BatchSplitEntryKind = 'batch';

export type BatchSplitViolationReason = 'missing' | 'invalid' | 'collision';

export interface BatchSplitSchemaViolationDetail {
  entryKind: BatchSplitEntryKind;
  ordinal: number;
  field: 'name' | 'rationale' | 'parallelGroup' | 'priorityInParallelGroup';
  reason: BatchSplitViolationReason;
  observed: unknown;
  /** Collision only — the other batch index whose value matches this one inside the same lane. */
  collidesWith?: number;
  /** Collision only — the lane name shared by the two batches. */
  laneName?: string;
}

export class BatchSplitSchemaViolation extends Error {
  readonly detail: BatchSplitSchemaViolationDetail;
  constructor(detail: BatchSplitSchemaViolationDetail) {
    super(
      `BatchSplitSchemaViolation: ${detail.entryKind}[${detail.ordinal}] ${detail.reason} '${detail.field}'`,
    );
    this.detail = detail;
    this.name = 'BatchSplitSchemaViolation';
  }
}

const FIELD_GUIDANCE: Record<BatchSplitSchemaViolationDetail['field'], string> = {
  name:
    "`name` (REQUIRED — noun phrase identifying the unit, e.g. \"firebase-web-singleton\"). Becomes the child task name verbatim.",
  rationale:
    "`rationale` (REQUIRED — why this batch is one isolated unit). Becomes the child task description verbatim.",
  parallelGroup:
    "`parallelGroup` (REQUIRED — a short, meaningful lane name, e.g. \"ui-shared-comp\"). Siblings sharing the same `parallelGroup` execute serially; siblings with different `parallelGroup` values run concurrently.",
  priorityInParallelGroup:
    "`priorityInParallelGroup` (REQUIRED — non-negative integer; values within a single lane MUST be distinct). The runtime computes the sub-task's priority as `parentPriority + priorityInParallelGroup`.",
};

/**
 * Build a framing block to append to the plan-LLM user prompt for the
 * next retry attempt. Mirrors `buildExecutionTierViolationFraming`.
 */
export function buildBatchSplitSchemaViolationFraming(
  e: BatchSplitSchemaViolation,
): string {
  const { entryKind, ordinal, field, reason, observed, collidesWith, laneName } = e.detail;
  const observedSnippet =
    observed && typeof observed === 'object'
      ? JSON.stringify(observed).slice(0, 240)
      : String(observed ?? '<missing>');

  const issueLine = (() => {
    switch (reason) {
      case 'missing':
        return `- ${entryKind} entry at index ${ordinal} is missing the REQUIRED field: '${field}'.`;
      case 'invalid':
        return `- ${entryKind} entry at index ${ordinal} has an INVALID value for '${field}'.`;
      case 'collision':
        return (
          `- ${entryKind} entries at index ${ordinal} and ${collidesWith ?? '?'} share lane '${laneName ?? '?'}' ` +
          `but have the SAME '${field}' value. Values within a lane MUST be distinct.`
        );
    }
  })();

  return [
    '',
    '⚠️  Your previous response violated the plan schema:',
    issueLine,
    `- Observed: ${observedSnippet}`,
    '',
    'The framework uses LLM-authored semantic fields verbatim as child task names and descriptions when a plan is fanned out into sub-tasks, and translates the scheduling fields directly onto the runtime\'s parallelGroup + priority axes. The system MUST NOT fabricate or guess these values.',
    '',
    `Re-emit the entire <plan> block. For every ${entryKind} entry, provide ${FIELD_GUIDANCE[field]}`,
    '',
  ].join('\n');
}
