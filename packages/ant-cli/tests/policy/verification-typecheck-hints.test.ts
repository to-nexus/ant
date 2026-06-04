/**
 * Locks the verify-mode TypeScript type-check guidance.
 *
 * RCA `west-beating-shelf`: the "Verification Order" block mandated a root
 * `tsc --noEmit` and claimed it "surfaces ALL type errors in one pass" + framed
 * the result as errors "collected at once for comprehensive batch remediation".
 * On a pnpm monorepo with one upstream tsconfig fault (e.g. `apps/admin` missing
 * `jsx`) that root run produced ~580 cascaded leaf errors; the LLM chased the
 * leaves instead of the single upstream fault → non-convergence → heavy step →
 * worker_stalled.
 *
 * The fix replaces that block with:
 *   - "Type-Check Invocation" — shape-matched (single → tsc --noEmit; references
 *     → tsc --build; multi-package-no-references → per-package).
 *   - "Cascade Root Cause" — diagnose the upstream fault as the single
 *     `batches[]` entry, NOT one entry per cascaded leaf error.
 *
 * Gate ordering stays owned by `plan/variants/verification/rules.md`
 * ("Verification Gate Ordering"), so this file must NOT re-state the order.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE =
  'jobs/code/nodes/plan/variants/verification/basis/techTier/typescript/hints';

describe('verification typescript hints — shape-matched type-check + cascade root cause', () => {
  const adapter = new FilePromptAdapter();

  it('removes the harmful "surfaces ALL / comprehensive batch remediation" framing', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).not.toMatch(/surfaces ALL type errors in one pass/i);
    expect(out).not.toMatch(/comprehensive batch remediation/i);
    expect(out).not.toMatch(/collected at once/i);
  });

  it('teaches a shape-matched type-check invocation (single / references / multi-package)', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/Type-Check Invocation/);
    // single-package default stays the simple case
    expect(out).toMatch(/tsc --noEmit/);
    // references/composite → tsc --build (long form: matches the build-command recognizer)
    expect(out).toMatch(/tsc --build/);
    expect(out).toMatch(/references.*composite|composite.*references/i);
    // multi-package without references → per-package check, explicitly NOT a root run
    expect(out).toMatch(/tsc -p /);
    expect(out).toMatch(/root `tsc --noEmit`[^.]*not a substitute/i);
  });

  it('teaches cascade root-cause diagnosis as a single batches[] entry (diagnose-only)', async () => {
    const out = await adapter.render(TEMPLATE, {});
    expect(out).toMatch(/Cascade Root Cause/);
    expect(out).toMatch(/single upstream config\/contract fault/i);
    expect(out).toMatch(/single root-cause `batches\[\]` entry/);
    expect(out).toMatch(/do NOT enumerate the cascaded errors as separate fix entries/i);
  });

  it('does not duplicate the generic gate order (owned by rules.md)', async () => {
    const out = await adapter.render(TEMPLATE, {});
    // The numbered "Required execution order" list lived here and duplicated
    // rules.md "Verification Gate Ordering" — it must be gone.
    expect(out).not.toMatch(/Required execution order/i);
  });
});
