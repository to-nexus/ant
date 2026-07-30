/**
 * Directive Q&A SSOT — locks the in-document answer channel for questions
 * embedded in the user's directive (plan curious-spinning-twilight).
 *
 * The partial `jobs/shared/injections/directive-qa.md` is the single
 * authority for the section's semantics; wiring sites carry membership /
 * placement pointers only. These assertions lock:
 *
 *   1. The partial's contract strings (H2 name, epigraph, omit-when-no-questions,
 *      MECE channel boundaries, revision replace-or-remove policy).
 *   2. Wiring at the four sites (spec execute, spec plan, PRD execute rules,
 *      PRD domain overlays' skeleton membership).
 *   3. The requirement-synthesis carve-out — the categorical "NOT a section
 *      in the document" prohibition is rescoped to decisions-ledger sections.
 *   4. The code-decompose informative-section guard (Q&A tail never becomes
 *      work units under the Tier-4 Development Source rule).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const T = (p: string) =>
  readFileSync(path.resolve(__dirname, '../../src/core/prompt/templates', p), 'utf8');

const PARTIAL = T('jobs/shared/injections/directive-qa.md');
const INCLUDE = '{{> jobs/shared/injections/directive-qa}}';

const SPEC_EXEC_BASE = T('jobs/design/nodes/execute/variants/spec/base.md');
const SPEC_PLAN_BASE = T('jobs/design/nodes/plan/variants/spec/base.md');
const PRD_EXEC_RULES = T('jobs/plan/nodes/execute/variants/default/rules.md');
const PRD_PLAN_RULES = T('jobs/plan/nodes/plan/variants/default/rules.md');
const PRD_SERVICE = T('jobs/plan/domain/service.md');
const PRD_GAME = T('jobs/plan/domain/game.md');
const SYNTHESIS = T('jobs/design/base/injections/requirement-synthesis.md');
const CODE_DECOMPOSE_RULES = T('jobs/code/nodes/decompose/variants/default/rules.md');

describe('directive-qa partial — section contract', () => {
  it('locks the exact H2 heading', () => {
    expect(PARTIAL).toContain('`## Directive Q&A`');
  });

  it('locks the verbatim informative epigraph', () => {
    expect(PARTIAL).toContain(
      '> Answers to questions embedded in the user\'s directive. Informative only — entries are not requirements, tasks, or acceptance criteria.',
    );
  });

  it('forbids the section when the directive has no questions', () => {
    expect(PARTIAL).toMatch(/the section MUST NOT exist/);
    expect(PARTIAL).toMatch(/empty or\s+placeholder Directive Q&A section is forbidden/);
  });

  it('partitions the four channels by direction + blocking (MECE)', () => {
    expect(PARTIAL).toContain('<clarify>');
    expect(PARTIAL).toContain('Open Questions');
    expect(PARTIAL).toMatch(/questions the USER asked YOU, answered/);
    expect(PARTIAL).toMatch(/MUST NOT be the sole carrier/);
  });

  it('states the directive-scoped replace-or-remove revision policy', () => {
    expect(PARTIAL).toMatch(/replace the section body/);
    expect(PARTIAL).toMatch(/remove the section entirely/);
    expect(PARTIAL).toMatch(/always sanctioned/);
    expect(PARTIAL).toMatch(/Never accumulate answers across\s+revisions/);
  });

  it('grounds answers in observation with an honest insufficient-evidence path', () => {
    expect(PARTIAL).toMatch(/grounded in what you actually observed/);
    expect(PARTIAL).toMatch(/never fabricate an answer/);
  });

  it('flags the requirements-leak blind spot (no downstream work units)', () => {
    expect(PARTIAL).toMatch(/Downstream consumers derive NO work\s+units/);
  });
});

describe('directive-qa wiring — one partial, N includes', () => {
  it('spec execute base includes the partial and names the optional tail', () => {
    expect(SPEC_EXEC_BASE).toContain(INCLUDE);
    expect(SPEC_EXEC_BASE).toMatch(/\*\*Directive Q&A\*\* — only when the directive embeds/);
  });

  it('spec plan base includes the partial in both branches', () => {
    expect(SPEC_PLAN_BASE).toContain(INCLUDE);
    // generate branch: tail outline entry
    expect(SPEC_PLAN_BASE).toMatch(/plan a tail `Directive Q&A` section/);
    // refactor branch: disposition policy
    expect(SPEC_PLAN_BASE).toMatch(/`Directive Q&A` section is directive-scoped/);
  });

  it('PRD execute rules include the partial and reference the overlay tail', () => {
    expect(PRD_EXEC_RULES).toContain(INCLUDE);
    expect(PRD_EXEC_RULES).toMatch(/conditional `Directive Q&A` tail/);
  });

  it('PRD plan rules route directive questions to the brief, not Open Questions or clarify', () => {
    expect(PRD_PLAN_RULES).toMatch(/never parked in Open Questions/);
    expect(PRD_PLAN_RULES).toMatch(/never re-asked via `<clarify>`/);
  });

  it('PRD domain overlays declare skeleton membership without restating semantics', () => {
    expect(PRD_SERVICE).toMatch(/\| 15 \| Directive Q&A \|/);
    expect(PRD_SERVICE).toContain('MECE PRD section map (15 sections)');
    expect(PRD_GAME).toMatch(/\*\*§Directive Q&A\*\* \(document tail\)/);
    // membership pointers only — the epigraph text lives in the partial alone
    const epigraph = 'Informative only — entries are not requirements';
    expect(PRD_SERVICE).not.toContain(epigraph);
    expect(PRD_GAME).not.toContain(epigraph);
  });
});

describe('directive-qa boundary carve-outs', () => {
  it('requirement-synthesis no longer categorically bans document sections', () => {
    expect(SYNTHESIS).not.toContain('NOT a section in the document');
    expect(SYNTHESIS).toContain('NOT a decisions-ledger section in the document');
    // retention — the reply-surfacing rule itself survives
    expect(SYNTHESIS).toContain('Surface material judgment calls in your `<reply>`');
  });

  it('code decompose carries the informative-section guard next to the Tier-4 rule', () => {
    expect(CODE_DECOMPOSE_RULES).toMatch(/Constraint — informative sections/);
    expect(CODE_DECOMPOSE_RULES).toMatch(/declares itself non-normative/);
    expect(CODE_DECOMPOSE_RULES).toMatch(/do NOT emit tasks from it/);
  });
});
