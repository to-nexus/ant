/**
 * F-1 — plan generate basis injection flow (Phase 1)
 *
 * `buildSystemPrompt` (planner / generate) MUST opt into basis injection
 * via `pipeline.includeBasis` + `basis` + `techContext` so
 * buildBasisSection wires `templates/domain/{d}.md` (identity, D27),
 * `templates/jobs/plan/domain/{d}.md` (GDD/PRD skeleton overlay, D27),
 * and any plan-overlay tiers.
 *
 * This is a regression for the v1 plan F-1 defect (`includeBasis` was
 * never set). The test inspects the source of `buildSystemPrompt.ts`
 * directly — a unit-level assertion, not a runtime smoke test, because
 * the runtime path requires a wired LLM client.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FILE = path.resolve(
  __dirname,
  '../src/agents/planner/graph/plan/nodes/generate/buildSystemPrompt.ts',
);

describe('F-1 — plan generate basis injection', () => {
  const src = fs.readFileSync(FILE, 'utf-8');

  it('passes pipeline.includeBasis: true', () => {
    expect(src).toMatch(/includeBasis:\s*true/);
  });

  it('passes basis: state.resolvedAction?.basis', () => {
    expect(src).toMatch(/basis:\s*state\.resolvedAction\?\.basis/);
  });

  it('passes techContext.resolvedAction', () => {
    expect(src).toMatch(/techContext:\s*\{[\s\S]*?resolvedAction:\s*state\.resolvedAction/);
  });
});
