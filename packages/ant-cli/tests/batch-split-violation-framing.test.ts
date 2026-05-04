/**
 * Verifies `buildBatchSplitSchemaViolationFraming` (the prompt suffix the
 * plan-node retry loop appends to the user message before re-issuing the
 * call) names the violating entry kind, ordinal, missing field, and
 * concrete per-kind guidance so the next attempt has unambiguous targets.
 *
 * The framing is the analogue of `buildExecutionTierViolationFraming` in
 * `core/executionTier/parseExecutionTierTag.ts` (decompose's retry SSOT).
 */

import { describe, it, expect } from 'vitest';
import {
  BatchSplitSchemaViolation,
  buildBatchSplitSchemaViolationFraming,
} from '../src/agents/architect/graph/code/tasks/_shared/batchSplit';

function frame(detail: ConstructorParameters<typeof BatchSplitSchemaViolation>[0]): string {
  return buildBatchSplitSchemaViolationFraming(new BatchSplitSchemaViolation(detail));
}

describe('buildBatchSplitSchemaViolationFraming — per-entry-kind guidance', () => {
  it('create violation: names the kind, index, missing field, and provides a noun-phrase example', () => {
    const text = frame({
      entryKind: 'create',
      ordinal: 2,
      missingField: 'name',
      observed: { target: 'src/foo.ts', purpose: 'module' },
    });
    expect(text).toMatch(/violated the plan schema/i);
    expect(text).toMatch(/create entry at index 2/);
    expect(text).toMatch(/REQUIRED field: 'name'/);
    expect(text).toMatch(/firebase-web-singleton/); // concrete example
    expect(text).toMatch(/noun phrase/i);
    // Observed object preview helps the LLM see exactly what it sent.
    expect(text).toMatch(/"target":"src\/foo\.ts"/);
  });

  it('modify violation: names the verb-phrase example (action field)', () => {
    const text = frame({
      entryKind: 'modify',
      ordinal: 0,
      missingField: 'action',
      observed: { target: 'package.json' },
    });
    expect(text).toMatch(/modify entry at index 0/);
    expect(text).toMatch(/REQUIRED field: 'action'/);
    expect(text).toMatch(/Add runtime dependencies/);  // verb-phrase example
    expect(text).toMatch(/short verb phrase/i);
  });

  it('delete violation: names the reason field and explains its child-task-name role', () => {
    const text = frame({
      entryKind: 'delete',
      ordinal: 1,
      missingField: 'reason',
      observed: { target: 'old.ts' },
    });
    expect(text).toMatch(/delete entry at index 1/);
    expect(text).toMatch(/REQUIRED field: 'reason'/);
    expect(text).toMatch(/why this is being deleted/i);
    expect(text).toMatch(/verbatim/i);
  });

  it('batch violation: names BOTH name and rationale as REQUIRED on the batches[] level', () => {
    const text = frame({
      entryKind: 'batch',
      ordinal: 3,
      missingField: 'rationale',
      observed: { name: 'unit-x', modify: [] },
    });
    expect(text).toMatch(/batch entry at index 3/);
    expect(text).toMatch(/REQUIRED field: 'rationale'/);
    // batch-kind framing reminds the LLM that BOTH name + rationale are required —
    // the next attempt must keep `name` valid AND add the missing `rationale`.
    expect(text).toMatch(/batches\[\]\.name/);
    expect(text).toMatch(/batches\[\]\.rationale/);
  });

  it('framing always reminds that the system MUST NOT fabricate names', () => {
    for (const entryKind of ['create', 'modify', 'delete', 'batch'] as const) {
      const text = frame({ entryKind, ordinal: 0, missingField: 'x', observed: null });
      expect(text).toMatch(/MUST NOT fabricate/i);
      expect(text).toMatch(/Re-emit the entire <plan>/);
    }
  });

  it('observed=undefined renders a placeholder rather than throwing', () => {
    const text = frame({
      entryKind: 'create',
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
      entryKind: 'create',
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
