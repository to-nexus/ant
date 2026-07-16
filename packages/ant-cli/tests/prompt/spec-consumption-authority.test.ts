/**
 * Spec consumption authority — locks the consumption-side symmetry of the
 * contract/realization axis split (plan spec-design-reflective-fox).
 *
 *   1. execute rules §1-1: a ref/spec's inlined realization detail MAY be
 *      stale — the defining source file in the current codebase is the SSOT
 *      on the realization axis; deviations are recorded, never halted on.
 *   2. execute rules: [VERIFY] items are verification instructions.
 *   3. execute rules §4: realization-level silence in the ref/spec is the
 *      executor's to fill from codebase conventions; the license never
 *      extends to the contract axis (no invented endpoints/wire fields).
 *   4. Wire-format immutability stays untouched (verbatim, surface gaps).
 *   5. Acceptance-criteria consumption loop: decompose guides the Final
 *      Verification task's `include` to the ref; the verification plan
 *      template checks machine-checkable criteria and lists human-only ones;
 *      selectArtifacts honors an explicitly authored verification include.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { selectArtifacts } from '../../src/core/artifact/ArtifactPipeline';

const T = (p: string) =>
  readFileSync(path.resolve(__dirname, '../../src/core/prompt/templates', p), 'utf8');

const EXEC_RULES = T('jobs/code/nodes/execute/variants/default/rules.md');
const DECOMPOSE_RULES = T('jobs/code/nodes/decompose/variants/default/rules.md');
const VERIFY_PLAN_BASE = T('jobs/code/nodes/plan/variants/verification/base.md');

describe('consumption-side axis split (execute rules)', () => {
  it('§1-1: ref/spec realization detail obeys the axis split — defining file wins', () => {
    expect(EXEC_RULES).toContain('ref/spec realization detail obeys the same axis split');
    expect(EXEC_RULES).toContain('MAY be stale');
    expect(EXEC_RULES).toMatch(
      /on the realization axis the defining source file in the current codebase is the SSOT/,
    );
    expect(EXEC_RULES).toMatch(/record the deviation in your report/);
    expect(EXEC_RULES).toMatch(/do NOT halt, and do NOT edit the ref/);
  });

  it('[VERIFY] items are instructions, not facts', () => {
    expect(EXEC_RULES).toContain('`[VERIFY]` items are instructions, not facts');
    expect(EXEC_RULES).toMatch(/reality wins/);
  });

  it('§4: realization-level silence is the executor\'s to fill, contract axis excluded', () => {
    expect(EXEC_RULES).toContain('Ref/spec silence at realization level is yours to fill');
    expect(EXEC_RULES).toMatch(/do NOT halt and do NOT emit `<done>false<\/done>`/);
    expect(EXEC_RULES).toMatch(/This license never extends to the contract axis/);
    expect(EXEC_RULES).toMatch(
      /do NOT invent new endpoints, wire fields, env variable names, or cross-task symbols/,
    );
  });

  it('wire-format immutability untouched (separate SSOT)', () => {
    expect(EXEC_RULES).toContain('Wire-format Identifier Preservation');
    expect(EXEC_RULES).toMatch(/VERBATIM/);
    expect(EXEC_RULES).toMatch(/surface the gap/);
  });
});

describe('acceptance-criteria consumption loop', () => {
  it('decompose guides the verification task include toward the ref document', () => {
    expect(DECOMPOSE_RULES).toMatch(
      /set the verification task's `include` to that ref's pool path/,
    );
    expect(DECOMPOSE_RULES).toMatch(/acceptance criteria are visible at verification time/);
  });

  it('verification plan template has the acceptance-criteria gate block', () => {
    expect(VERIFY_PLAN_BASE).toContain('{{#if hasAcceptanceSource}}');
    expect(VERIFY_PLAN_BASE).toContain('Check Acceptance Criteria');
    expect(VERIFY_PLAN_BASE).toMatch(/Machine-checkable criteria/);
    expect(VERIFY_PLAN_BASE).toMatch(/requiring human confirmation/);
    expect(VERIFY_PLAN_BASE).toMatch(/do NOT invent a machine proxy/);
    expect(VERIFY_PLAN_BASE).toContain('{{{acceptanceSource}}}');
  });

  it('selectArtifacts: verification without include stays empty (defensive default)', () => {
    const pool = [
      { path: 'architecture/spec/foo.md', content: 'x', role: 'ref' } as any,
    ];
    expect(selectArtifacts(pool, { taskType: 'verification' })).toEqual([]);
    expect(selectArtifacts(pool, { taskType: 'verification', include: [] })).toEqual([]);
  });

  it('selectArtifacts: verification WITH authored include is honored', () => {
    const pool = [
      { path: 'architecture/spec/foo.md', content: 'x', role: 'ref' } as any,
      { path: 'architecture/system/bar.md', content: 'y', role: 'context' } as any,
    ];
    const selected = selectArtifacts(pool, {
      taskType: 'verification',
      include: ['architecture/spec/foo.md'],
    });
    expect(selected.map(a => a.path)).toEqual(['architecture/spec/foo.md']);
  });
});
