/**
 * Locks the generalization of execute Section 1-1 from a parentReasoning-
 * gated "Pre-Planned Sub-Task" rule to an always-on "Plan Application &
 * Refinement Authority" Principle.
 *
 * Two axes are covered:
 *
 *   1. execute/variants/default/rules.md — Section 1-1 now applies to
 *      ALL execute tasks (not just batches[] children). The new Principle
 *      states the defining-file SSOT rule for signatures and call shapes.
 *      The parentReasoning-specific sibling-naming constraint is
 *      preserved as a sub-constraint under the generalized Section.
 *
 *   2. plan/rules.md — INTERFACE CONTRACT CONFORMANCE was broadened to
 *      EXISTING-IDENTIFIER CONTRACT. The principle now covers any
 *      identifier defined in the codebase at task-run time (factory,
 *      hook, exported class, type alias, constant), not just interfaces.
 *      Task hierarchy is explicitly named as irrelevant — the only
 *      axis is temporal precedence (already exists vs being created now).
 *
 * Companion partials:
 *   - plan-tools-batch.md (Category A/B/Out-of-scope headings replace
 *     the Priority 1/2/PROHIBITED naming so future axes do not collide).
 *   - execute/variants/default/base.md (Sibling-Convention rule names
 *     the signature-axis boundary so LLM does not conflate convention
 *     mimicking with signature mimicking).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const EXECUTE_RULES = readFileSync(
  path.resolve(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/nodes/execute/variants/default/rules.md',
  ),
  'utf8',
);
const EXECUTE_BASE = readFileSync(
  path.resolve(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/nodes/execute/variants/default/base.md',
  ),
  'utf8',
);
const PLAN_RULES = readFileSync(
  path.resolve(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/nodes/plan/rules.md',
  ),
  'utf8',
);
const PLAN_TOOLS_BATCH = readFileSync(
  path.resolve(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/base/injections/plan-tools-batch.md',
  ),
  'utf8',
);
// The defining-file SSOT grounding mechanic was lifted out of Section 1-1
// into a shared injection so the test-code / error execute variants (which
// are full replacements lacking Section 1-1) inherit it, and so the rule
// generalizes to self-introduced references (fixtures, mocks, props). The
// plan-authority framing (sketch / frozen direction / parentReasoning) stays
// inline in Section 1-1; the grounding sentences now live in the partial.
const SYMBOL_GROUNDING = readFileSync(
  path.resolve(
    __dirname,
    '../../src/core/prompt/templates/jobs/code/base/injections/symbol-grounding.md',
  ),
  'utf8',
);

describe('execute Section 1-1 — generalized to all tasks (no parentReasoning gate)', () => {
  it('renamed Section 1-1 from "Pre-Planned Sub-Task" to "Plan Application & Refinement Authority"', () => {
    expect(EXECUTE_RULES).toMatch(/Plan Application & Refinement Authority/);
    expect(EXECUTE_RULES).not.toMatch(/Pre-Planned Sub-Task/);
  });

  it('opens with the plan-authority Principle and wires in the grounding partial', () => {
    expect(EXECUTE_RULES).toMatch(/The plan is a sketch of WHAT and WHERE/);
    // The defining-file SSOT mechanic now lives in the shared partial,
    // included by Section 1-1 so the rendered rules still carry it.
    expect(EXECUTE_RULES).toMatch(/\{\{>\s*jobs\/code\/base\/injections\/symbol-grounding\s*\}\}/);
    expect(SYMBOL_GROUNDING).toMatch(/the defining file wins/);
    // The gate phrase that previously restricted the section is gone.
    expect(EXECUTE_RULES).not.toMatch(/If the plan JSON contains a top-level `parentReasoning` field, this task is/);
  });

  it('grounding partial tells execute NOT to mimic drifted earlier callers in the codebase', () => {
    expect(SYMBOL_GROUNDING).toMatch(
      /[Dd]o NOT mimic the nearest existing caller in the codebase — earlier callers may have drifted/,
    );
  });

  it('grounding partial extends the rule to self-introduced references (fixtures / props)', () => {
    expect(SYMBOL_GROUNDING).toMatch(/test fixtures, mock data/);
    expect(SYMBOL_GROUNDING).toMatch(/permitted literal set of any enumerated field/);
  });

  it('preserves the ✅/❌ refinement-authority table verbatim under the new title', () => {
    expect(EXECUTE_RULES).toMatch(
      /Use `read_file` \/ `search_code` to confirm exact import paths, function signatures, type shapes, file conventions/,
    );
    expect(EXECUTE_RULES).toMatch(/Change the chosen approach, library, naming, or architecture/);
  });

  it('preserves the parentReasoning-specific sibling-naming rule as a sub-constraint', () => {
    expect(EXECUTE_RULES).toMatch(
      /Additional constraint \(when `parentReasoning` is present in the plan\)/,
    );
    expect(EXECUTE_RULES).toMatch(/sibling sub-tasks share the SAME `parentReasoning`/i);
  });
});

describe('plan/rules.md — EXISTING-IDENTIFIER CONTRACT broadened scope', () => {
  it('renamed section from INTERFACE CONTRACT CONFORMANCE to EXISTING-IDENTIFIER CONTRACT', () => {
    expect(PLAN_RULES).toMatch(/## 🔌 EXISTING-IDENTIFIER CONTRACT/);
    expect(PLAN_RULES).not.toMatch(/INTERFACE CONTRACT CONFORMANCE/);
  });

  it('Principle names the broader identifier kinds beyond interfaces', () => {
    expect(PLAN_RULES).toMatch(
      /a factory, hook, interface, exported class, type alias, or constant/,
    );
    expect(PLAN_RULES).toMatch(/the \*\*defining file\*\* is the single source of truth/);
  });

  it('explicitly states task hierarchy is irrelevant — only temporal precedence matters', () => {
    expect(PLAN_RULES).toMatch(
      /Task hierarchy \(parent \/ sibling \/ foundation\) is irrelevant/,
    );
    expect(PLAN_RULES).toMatch(/whether the file already exists when this task executes/);
  });

  it('Constraint covers both inline-path (flat plan) and requiredFiles (batches[]) channels', () => {
    expect(PLAN_RULES).toMatch(/record the \*\*defining file path\*\* inline/);
    expect(PLAN_RULES).toMatch(/list that defining file in the child batch's `requiredFiles`/);
  });

  it('Blind spot example covers both interface and factory (createApiPort) drift', () => {
    expect(PLAN_RULES).toMatch(/subscribe\(symbol, callback\)/);
    expect(PLAN_RULES).toMatch(/createApiPort\(session\)/);
  });
});

describe('plan-tools-batch.md — heading rename + Category A sketch tone', () => {
  it('renamed the section header from "Tool Priority Protocol" to "Tool Observation Categories"', () => {
    expect(PLAN_TOOLS_BATCH).toMatch(/## Tool Observation Categories/);
    expect(PLAN_TOOLS_BATCH).not.toMatch(/## Tool Priority Protocol/);
  });

  it('renamed Priority 1 → Category A, Priority 2 → Category B, PROHIBITED → Out of scope', () => {
    expect(PLAN_TOOLS_BATCH).toMatch(/### Category A — Design-Prescribed Dependency Discovery/);
    expect(PLAN_TOOLS_BATCH).toMatch(/### Category B — Codebase Observation/);
    expect(PLAN_TOOLS_BATCH).toMatch(/### Out of scope — Well-Known Packages/);
    expect(PLAN_TOOLS_BATCH).not.toMatch(/### Priority 1 — Design-Prescribed/);
    expect(PLAN_TOOLS_BATCH).not.toMatch(/### PROHIBITED — Well-Known/);
  });

  it('Category A tone explicitly defers exact-shape verification to execute (sketch framing)', () => {
    expect(PLAN_TOOLS_BATCH).toMatch(
      /execute verifies the exact shape against the package source at write-time/,
    );
    // The old false-premise wording must be gone.
    expect(PLAN_TOOLS_BATCH).not.toMatch(/invisible to the implementation phase/);
    expect(PLAN_TOOLS_BATCH).not.toMatch(/implementation phase cannot see your tool output/);
  });

  it('Out of scope section names the axis-vs-category distinction so it does not get conflated', () => {
    expect(PLAN_TOOLS_BATCH).toMatch(/This is a constraint axis, not a category/);
  });
});

describe('execute base.md — Sibling-Convention axis separation', () => {
  it('adds the signature-axis boundary line so convention rule does not bleed into signatures', () => {
    expect(EXECUTE_BASE).toMatch(
      /This rule applies to convention-level patterns \(export style, casing, formatting\)/,
    );
    expect(EXECUTE_BASE).toMatch(
      /existing callers in the codebase may have drifted; verify against the defining file, not against a nearby caller/,
    );
    expect(EXECUTE_BASE).toMatch(/Plan Application & Refinement Authority/);
  });
});
