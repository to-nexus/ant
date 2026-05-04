/**
 * Snapshot guard for the plan rules.md changes that bind the
 * `BatchSplitSchemaViolation` retry contract on the LLM side:
 *
 *   1. The JSON SCHEMA section marks the LLM-authored semantic fields as
 *      REQUIRED so the LLM knows the framework will not fabricate them
 *      (`create.name`, `create.purpose`, `modify.action`, `modify.changes`,
 *      `delete.reason`, `batches[].name`, `batches[].rationale`).
 *
 *   2. A `delete[]` entry schema exists at the entry level (the legacy
 *      template only described `delete: []` inside `batches[]`).
 *
 *   3. The fan-out section is renamed PROACTIVE FAN-OUT and includes the
 *      6-entries / 3-directories observation trigger so plan-LLM emits
 *      `batches[]` proactively rather than waiting for system-side
 *      conversion.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RULES_PATH = path.resolve(
  __dirname,
  '../src/core/prompt/templates/jobs/code/nodes/plan/rules.md',
);

const RULES = readFileSync(RULES_PATH, 'utf8');

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

describe('plan/rules.md — PROACTIVE FAN-OUT trigger contract', () => {
  it('section heading is PROACTIVE FAN-OUT (renamed from OPTIONAL FAN-OUT)', () => {
    expect(RULES).toMatch(/##\s+🌿\s+PROACTIVE FAN-OUT \(feature \/ ui\)/);
    // Legacy header MUST NOT survive — there is one fan-out section, named PROACTIVE.
    expect(RULES).not.toMatch(/##\s+🌿\s+OPTIONAL FAN-OUT/);
  });

  it('declares the 6-entries / 3-directories observation trigger', () => {
    expect(RULES).toMatch(/exceed 6 entries OR span 3\+ independent output directories/);
  });

  it('forbids verb-style names in batches[] (verb is owned by the runtime UI)', () => {
    expect(RULES).toMatch(/Do NOT include framework verbs/);
    expect(RULES).toMatch(/Fix.*Create.*Add/);
  });

  it('explains the cost of leaving N units in a flat plan (overlimit at execute)', () => {
    expect(RULES).toMatch(/produces overlimit at execute/i);
  });
});
