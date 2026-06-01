/**
 * Locks the Condition 2 DISAMBIGUATION in `jobs/code/base/injections/antrules`.
 *
 * History: Condition 2 once read "any existing file that demonstrates the
 * convention → auto-derivable → exclude". In a greenfield build every
 * convention is demonstrated by the first sibling the moment it is used, so
 * that wording silently excluded the very cross-task conventions ANTRULES
 * exists to anchor — producing a 0-entry ledger on large jobs while the
 * "legitimate entries" list still claimed naming conventions belonged.
 *
 * The disambiguation splits what a sibling can "demonstrate" into two cases:
 *   - a STABLE RECURRING CONVENTION (naming/structure PATTERN every future
 *     sibling must repeat) → RECORDABLE (no single authoritative statement
 *     exists, so tasks otherwise re-discover or drift).
 *   - a SPECIFIC SYMBOL'S SHAPE (a function's params, a type's fields) → the
 *     defining source file is the SSOT, so it stays OUT of scope (recording
 *     it duplicates the SSOT and seeds drift). This anti-drift guarantee is
 *     preserved verbatim from the prior "sharpening".
 *
 * Both branches of the partial ({{#if antrulesContent}} body + {{else}}
 * create-if-needed body) must carry the disambiguation so setup and live-
 * update flows agree.
 */

import { describe, it, expect } from 'vitest';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATE = 'jobs/code/base/injections/antrules';

describe('antrules — Condition 2 disambiguation (convention recordable vs signature out-of-scope)', () => {
  const adapter = new FilePromptAdapter();

  it('content-present branch: stable conventions are recordable, specific shapes are not', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    // Recordable side (the fix): a recurring convention is NOT the disqualifying auto-derivable.
    expect(out).toMatch(/stable recurring convention/i);
    expect(out).toMatch(/RECORD it/);
    // Anti-drift side (preserved): a specific symbol's shape stays the source file's SSOT.
    expect(out).toMatch(/specific symbol's shape/i);
    expect(out).toMatch(/Do NOT record it/);
  });

  it('create-if-needed branch carries the same disambiguation', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: undefined });
    expect(out).toMatch(/stable recurring convention/i);
    expect(out).toMatch(/RECORDABLE/);
    expect(out).toMatch(/specific symbol's shape.*is the SSOT and does NOT belong here/is);
  });

  it('Do NOT record list keeps the shared-signature exclusion (anti-drift)', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    expect(out).toMatch(/a specific symbol's call shape \/ signature \/ type fields/i);
    expect(out).toMatch(/execute verifies against the defining file at write-time/i);
    expect(out).toMatch(/duplicates the SSOT and seeds drift/);
  });

  it('no longer carries the over-broad "any file that demonstrates → exclude" contradiction', async () => {
    const out = await adapter.render(TEMPLATE, { antrulesContent: '## X\n- y\n' });
    // The retired wording excluded conventions wholesale — must be gone.
    expect(out).not.toMatch(/a sibling that demonstrates the convention, it is auto-derivable/);
    expect(out).not.toMatch(/convention restatements the codebase already demonstrates/);
  });
});
