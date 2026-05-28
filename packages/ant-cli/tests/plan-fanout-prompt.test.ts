/**
 * Snapshot guard for the plan/rules.md fan-out section, after the rubric
 * was unified with decompose via the shared partial
 * `templates/jobs/code/shared/task-split-rubric.md`. The system no longer
 * auto-converts flat plans; fan-out is LLM-explicit (`batches[]`) only.
 *
 *   1. The JSON SCHEMA section keeps REQUIRED markers on the LLM-authored
 *      semantic fields the framework will not fabricate.
 *
 *   2. The fan-out section renders the shared task-split-rubric partial
 *      so decompose and plan share one principle SSOT.
 *
 *   3. Numeric thresholds (6 entries / 3 directories) and the legacy
 *      "auto-convert"/"overlimit"/"forces system-side fan-out" framing are
 *      gone — those were the witty-fox-era fingerprints that pushed LLMs
 *      toward mechanical splitting.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(
  __dirname,
  '../src/core/prompt/templates/jobs/code/nodes/plan/rules.md',
);
const RUBRIC_PATH = path.resolve(
  __dirname,
  '../src/core/prompt/templates/jobs/code/shared/task-split-rubric.md',
);
const CAPACITY_PATH = path.resolve(
  __dirname,
  '../src/core/prompt/templates/jobs/code/shared/plan-batch-capacity.md',
);

const RULES = readFileSync(RULES_PATH, 'utf8');
const RUBRIC = readFileSync(RUBRIC_PATH, 'utf8');
const CAPACITY = readFileSync(CAPACITY_PATH, 'utf8');

describe('plan/rules.md — REQUIRED markers on LLM-authored semantic fields', () => {
  it('create[].name is annotated REQUIRED with a noun-phrase exemplar', () => {
    expect(RULES).toMatch(/REQUIRED — concise noun phrase identifying the module/i);
    expect(RULES).toMatch(/firebase-web-singleton/);
  });

  it('create[].purpose is annotated REQUIRED', () => {
    expect(RULES).toMatch(/REQUIRED — what this module does/i);
  });

  it('modify[].action is annotated REQUIRED with a verb-phrase exemplar', () => {
    expect(RULES).toMatch(/REQUIRED — short verb phrase/i);
    expect(RULES).toMatch(/Add runtime dependencies for shared layer/);
  });

  it('modify[].changes is annotated REQUIRED', () => {
    expect(RULES).toMatch(/REQUIRED — array of specific changes/i);
  });

  it('delete[] entry-level schema exists with REQUIRED reason', () => {
    expect(RULES).toMatch(/"delete":\s*\[/);
    expect(RULES).toMatch(/"reason":\s*"\[REQUIRED — why this is being deleted/i);
  });

  it('batches[].name is annotated REQUIRED as a noun phrase (NOT verb, NOT path)', () => {
    expect(RULES).toMatch(/REQUIRED — noun phrase identifying the unit/i);
    expect(RULES).toMatch(/NOT a verb/);
    expect(RULES).toMatch(/NOT a path/);
  });

  it('batches[].rationale is annotated REQUIRED', () => {
    expect(RULES).toMatch(/REQUIRED — why this batch is one isolated unit/i);
  });

  it('schema reminds the LLM that the framework MUST NOT fabricate names', () => {
    expect(RULES).toMatch(/system MUST NOT fabricate names/i);
    expect(RULES).toMatch(/fan-out is rejected/i);
  });
});

describe('plan/rules.md — fan-out is LLM-explicit, default is bundle', () => {
  it('section heading covers feature / ui / design-system — no legacy variants', () => {
    expect(RULES).toMatch(/##\s+🌿\s+FAN-OUT AT PLAN TIME \(feature \/ ui \/ design-system\)/);
    expect(RULES).not.toMatch(/##\s+🌿\s+(OPTIONAL|PROACTIVE) FAN-OUT/);
  });

  it('plan-time single-session-capacity partial is rendered alongside the shared rubric', () => {
    // Capacity axis is now a standalone partial (plan-only SSOT), kept
    // separate from the shared semantic rubric so decompose can render the
    // rubric without inheriting the plan-time capacity axis.
    expect(RULES).toMatch(/{{>\s+jobs\/code\/shared\/plan-batch-capacity\s+}}/);
    // Inline legacy wording must not survive — the partial is the only SSOT.
    expect(RULES).not.toMatch(/Single-session closure \(plan-time check\)/);
    expect(RULES).not.toMatch(/orthogonal to coherence/);
  });

  it('plan-batch-capacity partial states the plan-only orthogonal axis with articulation contract', () => {
    expect(CAPACITY).toMatch(/Single-session capacity \(plan-time only\)/);
    expect(CAPACITY).toMatch(/orthogonal/i);
    expect(CAPACITY).toMatch(/parentReasoning/);
  });

  it('plan-batch-capacity partial unit is per-task involvement scope (NOT per-file)', () => {
    // The capacity decision is about the TASK as a whole — the union of
    // files it will read, modify, create, delete, or discover — not just
    // files it edits. Edit count alone was the framing that let
    // ui-instructor slip through: it had only ~16 modifications but 81
    // reads + 53 list_files for design-system landscape discovery.
    expect(CAPACITY).toMatch(/involvement scope/i);
    expect(CAPACITY).toMatch(/task as a whole/i);
  });

  it('plan-batch-capacity partial covers all three dimensions of bulk', () => {
    // Modification breadth, reference depth, exploration breadth — each
    // can trigger split alone; any two reinforce each other. Reference
    // depth alone (the prior framing) misses tasks that overflow on
    // discovery cost (the ui-instructor failure mode).
    expect(CAPACITY).toMatch(/modification breadth/i);
    expect(CAPACITY).toMatch(/reference depth/i);
    expect(CAPACITY).toMatch(/exploration breadth/i);
    // All three must be articulated to defend a bundle.
    expect(CAPACITY).toMatch(/ALL THREE dimensions/i);
  });

  it('plan-batch-capacity partial is budget-value-agnostic (FPOP — intrinsic principle, not arithmetic)', () => {
    // The capacity decision is qualitative, not computational. The LLM
    // recognises bulky scope intrinsically; it does NOT measure cost
    // against a remaining budget number. Anchoring the partial to a
    // budget value (RECURSION_LIMIT magic name OR a runtime-injected
    // remaining-budget variable) reframes the principle as arithmetic
    // and invites both miscounting and "this is under the ceiling so
    // bundle" rationalisation — the failure mode this axis exists to
    // catch. Keep the partial purely intrinsic.
    expect(CAPACITY).not.toMatch(/RECURSION_LIMIT/);
    expect(CAPACITY).not.toMatch(/{{remainingRecursionBudget}}/);
    // Explicitly forbid budget-comparison framing.
    expect(CAPACITY).toMatch(/regardless.*of.*the.*(?:prevailing\s+)?budget/i);
    expect(CAPACITY).toMatch(/do NOT.*(?:compare|compute|estimate)/i);
  });

  it('renders the shared task-split-rubric partial (SSOT with decompose)', () => {
    expect(RULES).toMatch(/{{>\s+jobs\/code\/shared\/task-split-rubric\s+}}/);
  });

  it('decompose does NOT receive the plan-batch-capacity partial (token-weight protection)', () => {
    const DECOMPOSE_OUTPUT_UNIT_PATH = path.resolve(
      __dirname,
      '../src/core/prompt/templates/jobs/code/nodes/decompose/variants/default/output-unit-splitting.md',
    );
    const DECOMPOSE = readFileSync(DECOMPOSE_OUTPUT_UNIT_PATH, 'utf8');
    expect(DECOMPOSE).not.toMatch(/plan-batch-capacity/);
    expect(DECOMPOSE).not.toMatch(/Single-session capacity/);
  });

  it('states that the system does NOT auto-convert flat plans', () => {
    expect(RULES).toMatch(/system does NOT auto-convert flat plans/i);
  });

  it('says fan-out fires if and only if the LLM emits batches[] explicitly', () => {
    expect(RULES).toMatch(/if and only if you decide to split/i);
  });

  it('makes single-task execute the default regardless of file/package/domain count', () => {
    expect(RULES).toMatch(/regardless of file count, package count, or domain count/i);
  });

  it('no legacy numeric thresholds (6 entries / 3 directories) remain', () => {
    expect(RULES).not.toMatch(/exceed 6 entries/);
    expect(RULES).not.toMatch(/span 3\+ independent output directories/);
    expect(RULES).not.toMatch(/N>6/);
  });

  it('no legacy "overlimit at execute" / "forces system-side fan-out" framing remains', () => {
    expect(RULES).not.toMatch(/produces overlimit at execute/i);
    expect(RULES).not.toMatch(/forces system-side fan-out/i);
  });

  it('forbids verb-style names in batches[] (verb is owned by the runtime UI)', () => {
    expect(RULES).toMatch(/Do NOT include framework verbs/);
    expect(RULES).toMatch(/Fix.*Create.*Add/);
  });
});

describe('shared/task-split-rubric.md — SSOT body', () => {
  it('teaches the independent-unit definition with three observable conditions', () => {
    expect(RUBRIC).toMatch(/Independent unit — definition/);
    expect(RUBRIC).toMatch(/integration point/);
    expect(RUBRIC).toMatch(/cognitive mode/);
  });

  it('names the concrete benefits that justify splitting', () => {
    expect(RUBRIC).toMatch(/Failure isolation matters/);
    expect(RUBRIC).toMatch(/Scope boundary matters/);
    expect(RUBRIC).toMatch(/Cognitive mode separation matters/);
  });

  it('explicitly refuses file/package/domain count as a split reason', () => {
    expect(RUBRIC).toMatch(/many files/);
    expect(RUBRIC).toMatch(/files in different places\/packages\/domains/);
  });

  it('warns that splitting a coherent unit risks sibling pattern drift', () => {
    expect(RUBRIC).toMatch(/pattern drift across siblings/i);
  });

  it('requires articulation of the concrete benefit', () => {
    expect(RUBRIC).toMatch(/name the concrete benefit/i);
  });

  it('contains no numeric threshold of its own', () => {
    expect(RUBRIC).not.toMatch(/\b[1-9]\+? (entries|files|directories|dirs|domains)\b/);
  });
});
