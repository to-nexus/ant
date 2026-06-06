/**
 * Regression guard: test-code is a NON-forking task type.
 *
 * The original recursion-limit bug (lucky-jumping-apple "[앱] 테스트 작성")
 * was caused by test-code FORKING the plan/execute prompt assembly: it
 * published `plan.buildPrompt` + execute `templatePaths` and rendered
 * self-contained variant templates that bypassed the shared base/rules — so
 * it never received the single-session-capacity rubric (`plan-batch-capacity`)
 * that decides "this scope is too large for one cycle, split now".
 *
 * These guards fail the build if any leg of the non-forking wiring regresses:
 *   1. the hook publishes no `plan.buildPrompt` / execute `templatePaths`;
 *   2. the shared FAN-OUT gate includes test-code (so it gets BOTH split
 *      rubrics — task-split-rubric + plan-batch-capacity);
 *   3. the test-code overlays are gate-included into the shared templates;
 *   4. the dead self-contained variant templates are gone.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { hooks as testCodeHooks } from '../../../src/agents/architect/graph/code/tasks/test-code';

const TPL = path.resolve(__dirname, '../../../src/core/prompt/templates');
const read = (rel: string) => readFileSync(path.join(TPL, rel), 'utf8');

describe('test-code non-forking — hook shape', () => {
  it('publishes no plan.buildPrompt and an extraTemplateVars contributor instead', () => {
    expect(testCodeHooks.plan?.buildPrompt).toBeUndefined();
    expect(typeof testCodeHooks.plan?.extraTemplateVars).toBe('function');
    expect(testCodeHooks.plan?.toolLoopLogTemplate).toBeUndefined();
  });

  it('publishes no execute templatePaths swap (rides default execute template)', () => {
    expect(testCodeHooks.execute?.templatePaths).toBeUndefined();
    // skipExamples is the only execute knob test-code keeps.
    expect(testCodeHooks.execute?.skipExamples).toBe(true);
  });
});

describe('test-code non-forking — shared template wiring', () => {
  it('the FAN-OUT gate in plan/rules.md includes test-code (capacity rubric reaches it)', () => {
    const rules = read('jobs/code/nodes/plan/rules.md');
    expect(rules).toMatch(
      /{{#if \(or \(eq taskType "feature"\) \(eq taskType "ui"\) \(eq taskType "design-system"\) \(eq taskType "test-code"\)\)}}/,
    );
    // Both split-decision rubrics live inside that gate — batch-capable
    // types (now incl. test-code) receive both.
    expect(rules).toMatch(/{{>\s+jobs\/code\/shared\/task-split-rubric\s+}}/);
    expect(rules).toMatch(/{{>\s+jobs\/code\/shared\/plan-batch-capacity\s+}}/);
  });

  it('plan/base.md gate-includes the test-code protocol overlay', () => {
    const base = read('jobs/code/nodes/plan/base.md');
    expect(base).toMatch(/{{#if \(eq taskType "test-code"\)}}/);
    expect(base).toMatch(/{{>\s+jobs\/code\/nodes\/plan\/injections\/test-code-protocol\s+}}/);
  });

  it('execute default base.md + rules.md gate-include the test-code overlays', () => {
    const base = read('jobs/code/nodes/execute/variants/default/base.md');
    const rules = read('jobs/code/nodes/execute/variants/default/rules.md');
    expect(base).toMatch(/{{#if \(eq currentTask\.type "test-code"\)}}/);
    expect(base).toMatch(/{{>\s+jobs\/code\/nodes\/execute\/injections\/test-code-task\s+}}/);
    expect(rules).toMatch(/{{#if \(eq currentTask\.type "test-code"\)}}/);
    expect(rules).toMatch(/{{>\s+jobs\/code\/nodes\/execute\/injections\/test-code-rules\s+}}/);
  });

  it('the test-code protocol overlay delegates the split decision to the shared FAN-OUT (no duplicate rubric)', () => {
    const overlay = read('jobs/code/nodes/plan/injections/test-code-protocol.md');
    // The overlay must NOT re-embed its own split rubric or Format A/B schema —
    // those come from the shared FAN-OUT. Re-embedding would re-fragment the SSOT.
    expect(overlay).not.toMatch(/task-split-rubric/);
    expect(overlay).not.toMatch(/plan-batch-capacity/);
  });

  it('dead self-contained test-code variant templates are removed', () => {
    expect(existsSync(path.join(TPL, 'jobs/code/nodes/plan/variants/test-code'))).toBe(false);
    expect(existsSync(path.join(TPL, 'jobs/code/nodes/execute/variants/test-code'))).toBe(false);
  });
});
