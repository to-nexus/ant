/**
 * Setup task — directory skeleton sealing + ANTRULES discovery checkpoint.
 *
 * Locks the four template surfaces that together fill the Cross-Task Contract
 * vacuum that produced the `upper-choking-point` / `classboard` divergence
 * (parallel `src/{application,domain}` ↔ `src/lib/{application,domain}` trees,
 * Next.js route group `(app)` vs literal `app/` collision, empty ANTRULES):
 *
 *   1. `typescript/setup/constraints.md` — `Source directories` prohibition is
 *      gone; `Directory skeleton` responsibility is positive.
 *   2. `go/setup/constraints.md` — same pattern for `cmd/internal/pkg`.
 *   3. `setup-directory-sealing.md` partial renders with FPOP shape
 *      (Principle / Observation target / Constraint / What to create /
 *       Blind spot) and stays framework-agnostic.
 *   4. `execute/variants/default/base.md` — partial is wired inside the
 *      setup-task block (not in feature / ui / error blocks), AND the
 *      "Pre-`<done>` Discovery Check" paragraph appears at the end of the
 *      setup block so the LLM re-evaluates the 3-condition filter before
 *      emitting `<done>`.
 *   5. `decompose/variants/default/rules.md` — the "Setup task description
 *      MUST mention" list carries a bullet about sealing the initial
 *      directory skeleton.
 *
 * Together these surfaces give the setup task a single, coherent responsibility
 * for sealing the structural contract that all sibling and future tasks
 * inherit via `list_files`. The ANTRULES partial body itself is intentionally
 * UNCHANGED — its existing 3-condition filter (codebase-local + not
 * auto-derivable + cross-task invariant) already covers the broader role
 * of recording cross-task invariants (naming conventions, pinning rationale,
 * etc.); the fix lives in the setup-side trigger, not in ANTRULES's scope.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

describe('setup directory sealing — constraints', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('typescript/setup/constraints.md — Directory skeleton is allowed, Source directories prohibition is gone', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/execute/basis/techTier/typescript/setup/constraints',
      {},
    );

    // Positive responsibility — skeleton + .gitkeep wording.
    expect(out).toMatch(/Directory skeleton/);
    expect(out).toMatch(/\.gitkeep/);
    expect(out).toMatch(/architecture boundaries from system design/i);

    // The legacy blanket prohibition on creating source directories must be
    // gone — that was the exact constraint that produced the vacuum.
    expect(out).not.toMatch(/Source directories: src\/\*, app\/\*, pages\/\*/);
    expect(out).not.toMatch(/Do NOT create application code directories/);

    // The .config.* / source-files prohibition still stands — feature tasks
    // own those.
    expect(out).toMatch(/Application source files/i);
    expect(out).toMatch(/main\.ts, App\.tsx/);
  });

  it('go/setup/constraints.md — Directory skeleton wording is present and cmd/internal/pkg prohibition is gone', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/execute/basis/techTier/go/setup/constraints',
      {},
    );

    expect(out).toMatch(/Directory skeleton/);
    expect(out).toMatch(/\.gitkeep/);
    // Go convention surface MUST appear somewhere in the skeleton guidance
    // so the LLM knows the default top-level shape.
    expect(out).toMatch(/cmd\/.*internal\/.*pkg\//);

    // The legacy blanket prohibition on creating cmd/* / internal/* / pkg/*
    // must be gone.
    expect(out).not.toMatch(/Source directories: cmd\/\*, internal\/\*, pkg\/\*/);
    expect(out).not.toMatch(/Do NOT create application code directories/);

    // Go source file prohibition still stands.
    expect(out).toMatch(/Application source files/i);
    expect(out).toMatch(/main\.go/);
  });
});

describe('setup-directory-sealing partial', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('renders the FPOP-shaped sealing guidance with all five sections', async () => {
    const out = await adapter.render(
      'jobs/code/base/injections/setup-directory-sealing',
      {},
    );

    // FPOP sections.
    expect(out).toMatch(/\*\*Principle\*\*/);
    expect(out).toMatch(/\*\*Observation target\*\*/);
    expect(out).toMatch(/\*\*Constraint\*\*/);
    expect(out).toMatch(/\*\*What to create\*\*/);
    expect(out).toMatch(/Blind spot/i);

    // Core wording — sealing semantics, .gitkeep, list_files binding,
    // parallel-root anti-pattern.
    expect(out).toMatch(/seal|SEAL/i);
    expect(out).toMatch(/\.gitkeep/);
    expect(out).toMatch(/list_files/);
    expect(out).toMatch(/parallel module roots?/i);
  });

  it('stays framework-agnostic — no Next.js / React / Vue / Go names baked in (SBS)', async () => {
    const out = await adapter.render(
      'jobs/code/base/injections/setup-directory-sealing',
      {},
    );

    // The partial activates inside any setup task regardless of framework,
    // so naming a specific framework would be an SBS violation — framework
    // axis is gated separately (basis/techTier/framework/*).
    expect(out).not.toMatch(/\bNext\.js\b/);
    expect(out).not.toMatch(/\bReact\b/);
    expect(out).not.toMatch(/\bVue\b/);
    expect(out).not.toMatch(/\bGo\b/); // `Go` as a framework/language label
    // Universal vocabulary — boundary directory / route-layer parent —
    // signals the abstraction level the partial actually sits at.
    expect(out).toMatch(/boundary direct(ory|ories)|module roots?/i);
  });
});

describe('execute/variants/default/base.md — setup task wiring', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  const BASE_VARS: Record<string, any> = {
    isSpecDriven: false,
    currentTaskIsFinal: false,
    referenceRequests: undefined,
    runtimeContext: '',
    // Service-virt gates default to false so the rules.md surface stays clean
    // — base.md does not gate on these, but we keep the surface predictable.
    hasUi: false,
  };

  it('includes setup-directory-sealing partial AND Pre-<done> Discovery Check when currentTask.type === "setup"', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/execute/variants/default/base',
      {
        ...BASE_VARS,
        currentTask: { id: 'setup-frontend', type: 'setup' },
      },
    );

    // Partial body markers — confirms the partial was actually rendered
    // (not just the wire `{{> ...}}` line).
    expect(out).toMatch(/Directory Skeleton Sealing/i);
    expect(out).toMatch(/binding structural context/);
    expect(out).toMatch(/\.gitkeep/);

    // Pre-<done> Discovery Check paragraph at end of setup block.
    expect(out).toMatch(/Pre-`<done>` Discovery Check/);
    expect(out).toMatch(/re-evaluate/i);
    expect(out).toMatch(/3-condition filter/);
    expect(out).toMatch(/Do NOT fabricate entries/);
  });

  it('does NOT include sealing partial or Discovery Check for feature task', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/execute/variants/default/base',
      {
        ...BASE_VARS,
        currentTask: { id: 'feat-auth', type: 'feature' },
      },
    );

    expect(out).not.toMatch(/Directory Skeleton Sealing/i);
    expect(out).not.toMatch(/Pre-`<done>` Discovery Check/);
  });

  it('does NOT include sealing partial or Discovery Check for error task', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/execute/variants/default/base',
      {
        ...BASE_VARS,
        currentTask: { id: 'fix-auth', type: 'error' },
      },
    );

    expect(out).not.toMatch(/Directory Skeleton Sealing/i);
    expect(out).not.toMatch(/Pre-`<done>` Discovery Check/);
  });
});

describe('decompose/variants/default/rules.md — setup description guidance', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('lists "initial directory skeleton" as something setup task descriptions MUST mention', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      {
        directive: '',
        currentTask: undefined,
        techTier: { language: 'typescript', stack: 'frontend' },
        hasExistingCode: false,
        codebaseFilePaths: [],
        hasDocuments: false,
        documents: [],
        hasUi: false,
        isExplicitPipeline: false,
        isPriorityFromSpec: false,
        visualTierActive: false,
        gameArtTierActive: false,
        gameContentTierActive: false,
        domainTierActive: false,
        needsBoundaryClassification: false,
      },
    );

    // The new bullet sits inside the "Setup task description MUST mention"
    // section and is the channel that nudges decompose to write a setup
    // task description that owns the skeleton sealing.
    expect(out).toMatch(/Initial directory skeleton/);
    expect(out).toMatch(/\.gitkeep/);
    expect(out).toMatch(/architecture boundaries from the system design/i);
    expect(out).toMatch(/list_files/);
  });
});

describe('ANTRULES partial body — UNCHANGED (broad role preserved)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('keeps the broad 3-condition filter framing — directory layout is one example among many', async () => {
    const out = await adapter.render(
      'jobs/code/base/injections/antrules',
      { antrulesContent: undefined },
    );

    // The partial must still list the broad legitimate-entry categories
    // (naming case / hooks prefix / pinning rationale / convention) — not
    // a directory-only schema. This is the explicit regression guard
    // against narrowing ANTRULES to a directory-convention channel.
    expect(out).toMatch(/Codebase-local/);
    expect(out).toMatch(/Not auto-derivable/);
    expect(out).toMatch(/Cross-task invariant/);
    expect(out).toMatch(/pinning|compat/i);
    // No new mandatory schema like "Decision/Rationale/Evolution Rules"
    // — write remains discovery-driven, not schema-enforced.
    expect(out).not.toMatch(/Decision \/ Rationale \/ Evolution Rules/);
    expect(out).not.toMatch(/AUTOGEN:directory-decision/);
  });
});
