/**
 * BatchSplit schema-violation channel — when the plan-LLM emits an
 * `<plan>` body whose `implementation.{create,modify,delete}[]` entries
 * (or top-level `batches[]`) are missing the LLM-authored semantic
 * fields the framework uses to label each child task, the system MUST
 * NOT fabricate names. Instead it throws this typed error so the plan
 * node can re-issue the call with violation framing — mirrors the
 * `ExecutionTierViolation` retry pattern in
 * `nodes/decompose/index.ts:548-826` SSOT.
 *
 * Required fields by entry kind:
 *   - `create[]` → `name` (module name). `purpose` is recommended.
 *   - `modify[]` → `action` (verb phrase). `changes[]` is recommended.
 *   - `delete[]` → `reason`.
 *   - `batches[]` → `name` AND `rationale`.
 *
 * The framing builder below produces the prompt suffix the next attempt
 * appends to the user message (decompose's `buildExecutionTierViolation
 * Framing` is the structural twin).
 */

export type BatchSplitEntryKind = 'modify' | 'create' | 'delete' | 'batch';

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

const FIELD_GUIDANCE: Record<BatchSplitEntryKind, string> = {
  modify:
    "`action` (REQUIRED — short verb phrase that becomes the child task name, e.g. \"Add runtime dependencies for shared layer\"). The framework uses `modify[].action` verbatim — do NOT use a path or a placeholder.",
  create:
    "`name` (REQUIRED — concise noun phrase identifying the module, e.g. \"firebase-web-singleton\"). The framework uses `create[].name` verbatim as the child task name — do NOT use a path or a placeholder.",
  delete:
    "`reason` (REQUIRED — why this is being deleted, e.g. \"Replace with new module\"). The framework uses `delete[].reason` verbatim as the child task name.",
  batch:
    "`name` (REQUIRED — noun phrase identifying the unit, e.g. \"firebase-web-singleton\") AND `rationale` (REQUIRED — why this batch is one isolated unit; becomes child task description). The framework uses `batches[].name` and `batches[].rationale` verbatim — do NOT use placeholders or paths.",
};

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
    `Re-emit the entire <plan> block. For every ${entryKind} entry, provide ${FIELD_GUIDANCE[entryKind]}`,
    '',
  ].join('\n');
}
