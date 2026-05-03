/**
 * Parallel `<done>` scan regression — pins the buffer-scan promotion
 * of the `_explicitDone` flag used by parallel rendering surfaces
 * (design docGen, code execute) whose per-chunk render path bypasses
 * `SpecialTagTransformer.transform` (see `CommonRenderStrategy` case
 * 'response' when `parallelTaskName` is set).
 *
 * Context (spare-keeping-metal RCA):
 *   - Per-chunk `transform` is unsafe on split streaming tokens, so
 *     parallel surfaces accumulate into `taskResponseBuffer`.
 *   - `finalize()` applied `transformAndStrip` for rendering but did
 *     NOT update the transformer's `_explicitDone` flag — so the
 *     docGen router kept looping until the call-budget safety net
 *     tripped, producing a `task_fail` → re-queue → `plan`-phase
 *     tool-call loop.
 *   - `scanExplicitDone(buffer)` is the SSOT fix: side-effect-only
 *     scan of the full buffer that promotes `_explicitDone` so the
 *     router observes `llmResponse.done === true` and routes to
 *     `checkTaskStatus`.
 *
 * This test pins the tag-registry-driven scan against buffer shapes
 * that historically broke the pipeline.
 */

import { describe, it, expect } from 'vitest';
import { SpecialTagTransformer } from '../../src/core/streaming/transformers/SpecialTagTransformer';

describe('SpecialTagTransformer.scanExplicitDone', () => {
  it('sets _explicitDone when the buffer contains `<done>true</done>`', () => {
    const t = new SpecialTagTransformer('en');
    expect(t.explicitDone).toBe(false);
    t.scanExplicitDone('Everything is in place. <done>true</done>');
    expect(t.explicitDone).toBe(true);
  });

  it('ignores `<done>false</done>` — only `true` signals termination', () => {
    const t = new SpecialTagTransformer('en');
    t.scanExplicitDone('<done>false</done>');
    expect(t.explicitDone).toBe(false);
  });

  it('is case-insensitive on the body (matches `TRUE` / `True` / `true`)', () => {
    const upper = new SpecialTagTransformer('en');
    upper.scanExplicitDone('<done>TRUE</done>');
    expect(upper.explicitDone).toBe(true);

    const mixed = new SpecialTagTransformer('en');
    mixed.scanExplicitDone('<done>True</done>');
    expect(mixed.explicitDone).toBe(true);
  });

  it('finds `<done>true</done>` even when preceded by other registry-known tags', () => {
    // Historical hazard: `transform()` is first-match-only, so a buffer
    // where `<reply>` matches before `<done>` would leave _explicitDone
    // false if the code path used `transform`. The scan method walks
    // globally over the `<done>` pattern alone.
    const t = new SpecialTagTransformer('en');
    const buf =
      '<reply>I have produced the spec document at architecture/spec/foo.md.</reply>\n' +
      '<done>true</done>';
    t.scanExplicitDone(buf);
    expect(t.explicitDone).toBe(true);
  });

  it('idempotent — subsequent scans on flag-already-set do not regress it', () => {
    const t = new SpecialTagTransformer('en');
    t.scanExplicitDone('<done>true</done>');
    expect(t.explicitDone).toBe(true);
    t.scanExplicitDone('some later chunk with no tag');
    expect(t.explicitDone).toBe(true);
  });

  it('no-op on empty / null buffer', () => {
    const t = new SpecialTagTransformer('en');
    t.scanExplicitDone('');
    expect(t.explicitDone).toBe(false);
    // @ts-expect-error — intentionally pass nullish to assert no throw
    t.scanExplicitDone(undefined);
    expect(t.explicitDone).toBe(false);
  });

  it('no-op when the buffer contains no `<done>` at all', () => {
    const t = new SpecialTagTransformer('en');
    t.scanExplicitDone('<reply>just a reply, no done tag</reply>');
    expect(t.explicitDone).toBe(false);
  });

  it('transform() and scanExplicitDone() share the same _explicitDone flag', () => {
    // `scanExplicitDone` is a promoter for the same SSOT state the
    // per-chunk `transform` path writes to. Interleaving must not
    // reset or double-count the flag.
    const t = new SpecialTagTransformer('en');
    t.scanExplicitDone('no tag yet');
    expect(t.explicitDone).toBe(false);
    t.transform('<done>true</done>');
    expect(t.explicitDone).toBe(true);
    t.scanExplicitDone('later chunk, still no new done');
    expect(t.explicitDone).toBe(true);
  });
});
