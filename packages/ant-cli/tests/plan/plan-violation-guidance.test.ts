/**
 * L1 — `plan/parts/entry.ts` violation guidance composition.
 *
 * After the enforce node removal (docs/tmp/enforce-node-removal-handoff.md),
 * the special formatter branches that previously lived in
 * `nodes/enforce/index.ts` (cross_worker_conflict / file_operation_failed)
 * now live in `renderViolationGuidance` and are appended to the violation
 * text by `composeViolationsText`. This suite locks the behaviour
 * equivalence with the pre-removal enforce output.
 */

import { describe, it, expect } from 'vitest';
import {
  composeViolationsText,
  renderViolationGuidance,
} from '../../src/agents/architect/graph/code/nodes/plan/entry';
import type { Violation } from '../../src/agents/architect/graph/code/state';

function violation(overrides: Partial<Violation> = {}): Violation {
  return {
    type: 'other',
    severity: 'critical',
    message: 'generic error',
    isRetryable: true,
    ...overrides,
  };
}

describe('renderViolationGuidance — type-specific actionable guidance', () => {
  it('cross_worker_conflict → emits merge guidance listing all conflicting files', () => {
    const guidance = renderViolationGuidance([
      violation({ type: 'cross_worker_conflict', file: 'src/a.ts', message: 'conflict a' }),
      violation({ type: 'cross_worker_conflict', file: 'src/b.ts', message: 'conflict b' }),
    ])!;

    expect(guidance).toContain('CROSS-WORKER FILE CONFLICT');
    expect(guidance).toContain('src/a.ts');
    expect(guidance).toContain('src/b.ts');
    expect(guidance).toContain('read_file');
    expect(guidance).toContain('DO NOT use <file> tag to overwrite');
  });

  it('file_operation_failed + Search-block mismatch → emits read-then-edit guidance', () => {
    const guidance = renderViolationGuidance([
      violation({
        type: 'file_operation_failed',
        file: 'src/c.ts',
        message: 'Search block not found in src/c.ts',
      }),
    ])!;

    expect(guidance).toContain('PREVIOUS ATTEMPT FAILED');
    expect(guidance).toContain('src/c.ts');
    expect(guidance).toContain('read_file');
    expect(guidance).toContain('edit_file');
  });

  it('file_operation_failed WITHOUT search-block keyword → undefined (generic path)', () => {
    const guidance = renderViolationGuidance([
      violation({
        type: 'file_operation_failed',
        file: 'src/d.ts',
        message: 'some other failure',
      }),
    ]);
    expect(guidance).toBeUndefined();
  });

  it('non-special violation type → undefined (no guidance)', () => {
    const guidance = renderViolationGuidance([
      violation({ type: 'other', message: 'type mismatch' }),
    ]);
    expect(guidance).toBeUndefined();
  });
});

describe('composeViolationsText — formatter + guidance composition', () => {
  it('appends guidance AFTER the generic formatter output', () => {
    const text = composeViolationsText([
      violation({ type: 'cross_worker_conflict', file: 'src/a.ts', message: 'conflict a' }),
    ])!;

    const formatterIdx = text.indexOf('cross_worker_conflict');
    const guidanceIdx = text.indexOf('CROSS-WORKER FILE CONFLICT');
    expect(formatterIdx).toBeGreaterThanOrEqual(0);
    expect(guidanceIdx).toBeGreaterThan(formatterIdx);
  });

  it('returns undefined when violations are absent', () => {
    // Post-postmortem-§4.1 signature: the second "diagnosticRetryContext"
    // argument was removed alongside `buildDiagnosticRetryContext`.
    // Retry reasoning now flows through Session summary + on-disk
    // session JSON self-service, not through an inline narrative.
    expect(composeViolationsText(undefined)).toBeUndefined();
    expect(composeViolationsText([])).toBeUndefined();
  });

  it('renders violations without any narrative injection channel', () => {
    const text = composeViolationsText([
      violation({ type: 'other', message: 'x' }),
    ])!;
    expect(text).toContain('other');
    // No trailing "diag-context" style narrative — by design.
  });
});
