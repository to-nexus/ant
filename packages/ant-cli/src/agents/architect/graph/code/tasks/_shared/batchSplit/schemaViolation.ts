/**
 * BatchSplit schema-violation channel — when the plan-LLM emits a
 * `batches[]` entry missing the LLM-authored semantic fields the
 * framework uses to label each child task, the system MUST NOT
 * fabricate names. Instead it throws this typed error so the plan
 * node can re-issue the call with violation framing — mirrors the
 * `ExecutionTierViolation` retry pattern in
 * `nodes/decompose/index.ts:548-826` SSOT.
 *
 * Required fields:
 *   - `batches[]` → `name` AND `rationale`.
 *
 * (Top-level `implementation.{create,modify,delete}` entries are no
 * longer auto-converted into sub-tasks, so their per-entry semantic
 * fields are not gated here — the LLM owns the fan-out decision via
 * explicit `batches[]`.)
 *
 * The framing builder below produces the prompt suffix the next attempt
 * appends to the user message (decompose's `buildExecutionTierViolation
 * Framing` is the structural twin).
 */

export type BatchSplitEntryKind = 'batch';

export interface BatchSplitSchemaViolationDetail {
  entryKind: BatchSplitEntryKind;
  ordinal: number;
  missingField: string;
  observed: unknown;
}

export class BatchSplitSchemaViolation extends Error {
  readonly detail: BatchSplitSchemaViolationDetail;
  constructor(detail: BatchSplitSchemaViolationDetail) {
    super(
      `BatchSplitSchemaViolation: ${detail.entryKind}[${detail.ordinal}] missing '${detail.missingField}'`,
    );
    this.detail = detail;
    this.name = 'BatchSplitSchemaViolation';
  }
}

const BATCH_FIELD_GUIDANCE =
  "`name` (REQUIRED — noun phrase identifying the unit, e.g. \"firebase-web-singleton\") AND `rationale` (REQUIRED — why this batch is one isolated unit; becomes child task description). The framework uses `batches[].name` and `batches[].rationale` verbatim — do NOT use placeholders or paths.";

/**
 * Build a framing block to append to the plan-LLM user prompt for the
 * next retry attempt. Mirrors `buildExecutionTierViolationFraming`.
 */
export function buildBatchSplitSchemaViolationFraming(
  e: BatchSplitSchemaViolation,
): string {
  const { entryKind, ordinal, missingField, observed } = e.detail;
  const observedSnippet =
    observed && typeof observed === 'object'
      ? JSON.stringify(observed).slice(0, 240)
      : String(observed ?? '<missing>');

  return [
    '',
    '⚠️  Your previous response violated the plan schema:',
    `- ${entryKind} entry at index ${ordinal} is missing the REQUIRED field: '${missingField}'.`,
    `- Observed: ${observedSnippet}`,
    '',
    'The framework uses LLM-authored semantic fields verbatim as child task names and descriptions when a plan is fanned out into sub-tasks. The system MUST NOT fabricate names — they are LLM-authored or fan-out is rejected.',
    '',
    `Re-emit the entire <plan> block. For every ${entryKind} entry, provide ${BATCH_FIELD_GUIDANCE}`,
    '',
  ].join('\n');
}
