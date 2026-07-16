/**
 * Spec depth calibration SSOT — locks the contract/realization axis split
 * in the spec design templates (plan spec-design-reflective-fox).
 *
 * Single convergence principle: the spec owns the CONTRACT axis (paths,
 * symbols, wire shapes, env vars, ordering, acceptance gates — zero degrees
 * of freedom); the code job owns the REALIZATION axis (function/component
 * bodies, internal state, hook internals). These assertions lock:
 *
 *   1. "zero degrees of freedom" is axis-scoped, not unbounded.
 *   2. The Golden Test has a ceiling branch (implementation bodies compress
 *      to signature + shape + gate).
 *   3. "Full implementation bodies" is in the Forbidden list.
 *   4. Both impl guides carry the realization ceiling.
 *   5. The plan variant carries the converse ceiling.
 *   6. The [VERIFY] marking contract + acceptance-criteria gate contract exist.
 *   7. RETENTION — the identifier requirements and self-contained identity
 *      were rescoped, NOT deleted.
 *   8. Refactor mode forbids <append> (duplicate-root corruption cause).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const T = (p: string) =>
  readFileSync(path.resolve(__dirname, '../../src/core/prompt/templates', p), 'utf8');

const EXEC_BASE = T('jobs/design/nodes/execute/variants/spec/base.md');
const EXEC_RULES = T('jobs/design/nodes/execute/variants/spec/rules.md');
const PLAN_BASE = T('jobs/design/nodes/plan/variants/spec/base.md');
const GUIDE_SERVICE = T('jobs/design/nodes/execute/injections/spec-impl-guide-service.md');
const GUIDE_GAME = T('jobs/design/nodes/execute/injections/spec-impl-guide-game.md');

describe('spec depth calibration — contract axis vs realization axis', () => {
  it('scopes "zero degrees of freedom" to the contract axis', () => {
    expect(EXEC_BASE).toMatch(
      /zero degrees of freedom on WHAT to build, WHERE it lives, and how the parts connect/,
    );
  });

  it('declares realization restraint as the code job\'s axis', () => {
    expect(EXEC_BASE).toContain('Realization restraint (the code job\'s axis)');
    expect(EXEC_BASE).toContain('it does not write the body');
  });

  it('Golden Test carries the ceiling branch', () => {
    expect(EXEC_BASE).toContain('apply the ceiling test');
    expect(EXEC_BASE).toContain('Am I writing the implementation itself');
    expect(EXEC_BASE).toMatch(/compress to signature \+ field shape \+ acceptance gate/);
  });

  it('forbids full implementation bodies with an allowed-content carve-out', () => {
    expect(EXEC_BASE).toContain('Full implementation bodies');
    expect(EXEC_BASE).toMatch(
      /Allowed fenced content: signatures, interface\/DTO\/type stubs, config entries, command invocations, wire payload examples/,
    );
  });

  it('both domain impl guides carry the realization ceiling', () => {
    for (const guide of [GUIDE_SERVICE, GUIDE_GAME]) {
      expect(guide).toContain('realization ceiling');
      expect(guide).toContain('never function/component bodies');
      expect(guide).toMatch(/Wire shapes, env vars, commands, and config values stay exact/);
    }
  });

  it('plan variant carries the converse ceiling', () => {
    expect(PLAN_BASE).toContain('The converse ceiling also binds');
    expect(PLAN_BASE).toContain('never implementation bodies');
  });

  it('declares the [VERIFY] unverified-claim marking contract', () => {
    expect(EXEC_BASE).toContain('[VERIFY:');
    expect(EXEC_BASE).toMatch(/Unverified-claim marking/);
    expect(EXEC_BASE).toMatch(/instruction to confirm before use, not as a settled fact/);
  });

  it('declares the acceptance-criteria gate contract (confirmation means named)', () => {
    expect(EXEC_BASE).toContain('Acceptance criteria are gates, not wishes');
    expect(EXEC_BASE).toMatch(/MUST name its confirmation means/);
    expect(EXEC_BASE).toMatch(/requiring human confirmation/);
  });

  it('RETENTION — identifier requirements and self-contained identity survive', () => {
    expect(EXEC_BASE).toContain('A spec without identifiers is not a spec');
    expect(EXEC_BASE).toContain('self-contained');
    expect(PLAN_BASE).toContain('A spec without identifiers is not a spec');
  });
});

describe('spec refactor mode — append prohibition (duplicate-root cause removal)', () => {
  it('refactor block forbids <append>', () => {
    expect(EXEC_BASE).toContain('`<append>` is FORBIDDEN in refactor mode');
    expect(EXEC_BASE).toMatch(/second complete document below the first/);
  });

  it('rules Rule 3 is section-correct (refactor → <file>; continuation only → <append>)', () => {
    expect(EXEC_RULES).toContain('Spec body via the section-correct tag');
    expect(EXEC_RULES).toMatch(/ANY refactor-mode task: `<file>`/);
    expect(EXEC_RULES).toMatch(/Continuation sections \(section 2\+\) ONLY: `<append>`/);
  });

  it('spec.ts deadline message names only the section-correct tag', () => {
    const specTs = readFileSync(
      path.resolve(
        __dirname,
        '../../src/agents/architect/graph/design/nodes/execute/intent/spec.ts',
      ),
      'utf8',
    );
    expect(specTs).toMatch(/const writeTag = isFirstSection \? '<file>' : '<append>'/);
    expect(specTs).not.toMatch(/using <file> or <append> tag/);
  });
});
