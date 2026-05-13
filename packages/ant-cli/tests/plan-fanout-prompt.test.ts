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

const RULES = readFileSync(RULES_PATH, 'utf8');
const RUBRIC = readFileSync(RUBRIC_PATH, 'utf8');

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

  it('plan-time single-session-closure check is rendered alongside the shared rubric', () => {
    expect(RULES).toMatch(/Single-session closure \(plan-time check\)/);
    expect(RULES).toMatch(/one execute round/);
    expect(RULES).toMatch(/orthogonal to coherence/);
  });

  it('renders the shared task-split-rubric partial (SSOT with decompose)', () => {
    expect(RULES).toMatch(/{{>\s+jobs\/code\/shared\/task-split-rubric\s+}}/);
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
