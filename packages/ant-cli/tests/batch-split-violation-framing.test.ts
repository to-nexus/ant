/**
 * Verifies `buildBatchSplitSchemaViolationFraming` (the prompt suffix the
 * plan-node retry loop appends to the user message before re-issuing the
 * call) names the violating entry kind, ordinal, missing field, and
 * concrete per-kind guidance so the next attempt has unambiguous targets.
 *
 * The framing is the analogue of `buildExecutionTierViolationFraming` in
 * `core/executionTier/parseExecutionTierTag.ts` (decompose's retry SSOT).
 *
 * Only `batches[]` is gated by the schema-violation channel now — top-
 * level `implementation.{modify,create,delete}` entries are not auto-
 * converted, so they no longer need framing guidance.
 */

import { describe, it, expect } from 'vitest';
import {
  BatchSplitSchemaViolation,
  buildBatchSplitSchemaViolationFraming,
} from '../src/agents/architect/graph/code/tasks/_shared/batchSplit';

function frame(detail: ConstructorParameters<typeof BatchSplitSchemaViolation>[0]): string {
  return buildBatchSplitSchemaViolationFraming(new BatchSplitSchemaViolation(detail));
}

describe('buildBatchSplitSchemaViolationFraming — batch-entry guidance', () => {
  it('batch violation (missing name): names the kind, index, missing field, and noun-phrase example', () => {
    const text = frame({
      entryKind: 'batch',
      ordinal: 2,
      missingField: 'name',
      observed: { rationale: 'a slice', modify: [] },
    });
    expect(text).toMatch(/violated the plan schema/i);
    expect(text).toMatch(/batch entry at index 2/);
    expect(text).toMatch(/REQUIRED field: 'name'/);
    expect(text).toMatch(/firebase-web-singleton/); // noun-phrase example
    expect(text).toMatch(/noun phrase/i);
    // Observed object preview helps the LLM see exactly what it sent.
    expect(text).toMatch(/"rationale":"a slice"/);
  });

  it('batch violation (missing rationale): reminds the LLM BOTH name and rationale are required', () => {
    const text = frame({
      entryKind: 'batch',
      ordinal: 3,
      missingField: 'rationale',
      observed: { name: 'unit-x', modify: [] },
    });
    expect(text).toMatch(/batch entry at index 3/);
    expect(text).toMatch(/REQUIRED field: 'rationale'/);
    expect(text).toMatch(/batches\[\]\.name/);
    expect(text).toMatch(/batches\[\]\.rationale/);
    expect(text).toMatch(/verbatim/i);
  });

  it('framing always reminds that the system MUST NOT fabricate names', () => {
    const text = frame({ entryKind: 'batch', ordinal: 0, missingField: 'name', observed: null });
    expect(text).toMatch(/MUST NOT fabricate/i);
    expect(text).toMatch(/Re-emit the entire <plan>/);
  });

  it('observed=undefined renders a placeholder rather than throwing', () => {
    const text = frame({
      entryKind: 'batch',
      ordinal: 0,
      missingField: 'name',
      observed: undefined,
    });
    expect(text).toMatch(/Observed:/);
    // Should not crash on null/undefined observation.
  });

  it('large observed object is truncated to keep the framing token-cheap', () => {
    const big = { x: 'A'.repeat(1000) };
    const text = frame({
      entryKind: 'batch',
      ordinal: 0,
      missingField: 'name',
      observed: big,
    });
    // Framing must NOT include the full 1000-char payload — truncation keeps
    // retry attempts cheap. 240-char snippet ceiling defined in the helper.
    const observedLine = text.split('\n').find(l => l.startsWith('- Observed:'));
    expect(observedLine).toBeTruthy();
    expect(observedLine!.length).toBeLessThan(400);
  });
});
