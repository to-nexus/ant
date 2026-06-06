// hidden-mooring-rivet prompt regression guards.
//
// Fix 1 - base.md Task Boundary Principle is fail-closed (refuses sibling
// scope absorption even when the spec spans both surfaces).
//
// Fix 2 - empty-plan-as-done is a task-type-agnostic contract. base.md /
// rules.md / every variants/*/base.md must teach the LLM to emit the empty
// plan when investigation shows the task surface has nothing left to do,
// and must forbid a verification command before doing so.
//
// If a future prompt refactor moves these clauses out of the main flow,
// this guard fails - the same regression the hidden-mooring-rivet stall
// exposed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../src/core/prompt/templates/jobs/code/nodes/plan');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

describe('hidden-mooring-rivet Fix 1: Task Boundary Principle is fail-closed', () => {
  const BASE = read('base.md');

  it('base.md heading marks the principle as non-negotiable', () => {
    expect(BASE).toMatch(/Task Boundary Principle \(non-negotiable\)/);
  });

  it('positive rule: stay inside the task description surface', () => {
    expect(BASE).toMatch(/MUST stay within the files, symbols, and\s+modules your task description claims/);
  });

  it('negative rule: refuse to absorb sibling work even when spec spans both surfaces', () => {
    expect(BASE).toMatch(/Do NOT absorb it into\s+your plan/);
    expect(BASE).toMatch(/surrounding spec document describes both responsibilities/);
  });

  it('articulation failures explicitly named', () => {
    expect(BASE).toMatch(/articulation failures/i);
    expect(BASE).toMatch(/Efficient to do both at once/);
    expect(BASE).toMatch(/recipe is uniform/);
  });

  it('fail-closed escape: either narrow scope OR emit empty plan', () => {
    expect(BASE).toMatch(/your only honest options are/i);
    expect(BASE).toMatch(/your own\s+surface has nothing\s+left to do, emit an empty plan/);
    expect(BASE).toMatch(/do NOT issue a verification command/i);
    expect(BASE).toMatch(/downstream verification task owns that gate/);
  });
});

describe('hidden-mooring-rivet Fix 2: empty-plan-as-done in default rules.md', () => {
  const RULES = read('rules.md');

  it('rules.md has an explicit Empty plan main-flow section', () => {
    expect(RULES).toMatch(/Empty plan .* when surface shows no work left/);
    expect(RULES).toMatch(/\(non-negotiable\)/);
  });

  it('positive rule: investigation shows surface clean, emit empty plan', () => {
    expect(RULES).toMatch(/MUST emit the empty plan below and stop/);
  });

  it('negative rule: verification command before empty plan is a slice violation', () => {
    expect(RULES).toMatch(/Do NOT run a verification command/);
    expect(RULES).toMatch(/slice violation/);
    expect(RULES).toMatch(/downstream\s+verification task owns that gate/i);
  });

  it('rule is framed as plan-node property, not per-task-type', () => {
    expect(RULES).toMatch(/property of the plan node, not of any task type/);
  });
});

describe('hidden-mooring-rivet Fix 2: empty-plan main flow in every variant', () => {
  const ERROR = read('variants/error/base.md');
  // test-code is non-forking — its empty-plan flow lives in the gated
  // protocol overlay, not in a self-contained variant.
  const TESTCODE = read('injections/test-code-protocol.md');
  const VERIFY = read('variants/verification/base.md');

  it('error variant has Step 3 Recognize Already-Resolved State in protocol', () => {
    expect(ERROR).toMatch(/Recognize Already-Resolved State \(non-negotiable\)/);
    expect(ERROR).toMatch(/Emit the empty plan\s+in Step 5 and stop/);
    expect(ERROR).toMatch(/Do NOT run a verification command/);
  });

  it('error variant constraint references Step 3 and forbids verification commands', () => {
    expect(ERROR).toMatch(/Constraint \(mandatory, MUST follow Step 3\)/);
    expect(ERROR).toMatch(/MUST\s+emit the empty plan below and stop/);
    expect(ERROR).toMatch(/Do NOT run a verification command/);
    expect(ERROR).toMatch(/downstream verification\s+task owns that gate/);
  });

  it('test-code protocol overlay teaches recognize-sufficient-coverage → empty plan', () => {
    expect(TESTCODE).toMatch(/Recognize already-sufficient coverage/i);
    expect(TESTCODE).toMatch(/emit an\s+empty plan/i);
    expect(TESTCODE).toMatch(/Do NOT run the test suite/);
    expect(TESTCODE).toMatch(/verification task owns that gate/i);
  });

  it('verification variant empty-plan is mandatory and consistent with siblings', () => {
    expect(VERIFY).toMatch(/Constraint \(mandatory\)/);
    expect(VERIFY).toMatch(/you MUST emit the empty plan below\s+and stop/);
    expect(VERIFY).toMatch(/same\s+empty-plan contract that error \/ test-code variants follow/);
  });
});
