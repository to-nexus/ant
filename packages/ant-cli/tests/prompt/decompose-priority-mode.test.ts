/**
 * decompose priority-mode regression guard.
 *
 * Locks the conditional `priority` guidance swap in
 * `templates/jobs/code/nodes/decompose/variants/default/rules.md`:
 *
 *   isPriorityFromSpec = true   → spec-derived free priority 1..999
 *                                 guidance row replaces the canonical
 *                                 bands; the "Note" paragraph about
 *                                 ordering vs scheduling lanes is
 *                                 suppressed (the row itself already
 *                                 carries the equivalent clarification).
 *   isPriorityFromSpec = false  → canonical band guide
 *                                 (100–189: setup, 200–299: foundation,
 *                                 300–599: feature, 600–649: integration,
 *                                 650–699: ui, 700: test-code, 800: doc,
 *                                 900–980: error, 1000: verification)
 *                                 plus the Note paragraph.
 *
 * The runtime gate lives at
 * `packages/ant-cli/src/agents/architect/graph/code/nodes/decompose/index.ts`:
 *
 *     isPriorityFromSpec: state.resolvedAction?.intent === 'gen-code-spec'
 *
 * Only `gen-code-spec` opts into free-priority guidance. `gen-code-sys`
 * and `gen-code-directive` / `rev-code` keep the canonical bands — the
 * scheduling barriers in `parallel/TaskOrchestrator.ts` depend on the
 * canonical bands via each bundle's `classify` hook, so the recommended
 * guide aligns LLM ordering with classify-driven scheduling.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

const BASE_VARS: Record<string, any> = {
  // Minimal vars to avoid undefined traversal errors in the template.
  directive: 'Build a service',
  currentTask: undefined,
  resolvedAction: undefined,
  techTier: { language: 'typescript', stack: 'backend' },
  hasExistingCode: false,
  codebaseFilePaths: [],
  fileList: '',
  hasDocuments: false,
  documents: [],
  hasCompactedArtifacts: false,
  hasErrorInDirective: false,
  hasUi: false,
  uiSource: undefined,
  hasRuntimeError: false,
  isExplicitPipeline: false,
  visualTierActive: false,
  gameArtTierActive: false,
  gameContentTierActive: false,
  domainTierActive: false,
  needsBoundaryClassification: false,
  specClarifyBypassed: false,
  intentClarifyDisabled: true,
};

describe('decompose/variants/default/rules.md — priority guidance gate', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('isPriorityFromSpec=true (gen-code-spec) — free 1..999 guidance, canonical bands absent', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...BASE_VARS, isPriorityFromSpec: true },
    );

    // Free-priority clause present.
    expect(output).toMatch(/Free integer in 1\.\.999/);
    expect(output).toMatch(/1000 is reserved for the Final Verification task only/);
    // Scheduling-lane clarification inlined into the spec row.
    expect(output).toMatch(/Scheduling lanes \(which task type starts/);

    // Canonical band sentinels must NOT appear on the priority table row.
    // The description of shared-foundation type (priority 200–299) appears
    // elsewhere in the document (Task Type Rules section), so scope the
    // negative match tightly to the priority schema row phrasing.
    expect(output).not.toMatch(/100–189: setup, 200–279: feature \(shared foundation/);
    expect(output).not.toMatch(/900–980: error, 1000: verification/);

    // The universal ordering Note is suppressed in spec mode (the free
    // row already covers that semantic).
    expect(output).not.toMatch(
      /`priority` is the ordering key \(lower = earlier\)\. Scheduling/,
    );
  });

  it('isPriorityFromSpec=false (default) — canonical bands + Note paragraph present', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...BASE_VARS, isPriorityFromSpec: false },
    );

    // Canonical band table row.
    expect(output).toMatch(/100–189: setup, 200–279: feature \(shared foundation/);
    expect(output).toMatch(/600–649: feature \(integration\)/);
    expect(output).toMatch(/900–980: error, 1000: verification/);

    // Ordering-vs-scheduling-lanes Note paragraph.
    expect(output).toMatch(
      /\*\*Note\*\*: `priority` is the ordering key \(lower = earlier\)/,
    );
    expect(output).toMatch(/Scheduling\s+lanes — when each task type starts relative/);
    expect(output).toMatch(/`type` is the SSOT for scheduling/);

    // Free-priority clause must NOT leak into the default mode.
    expect(output).not.toMatch(/Free integer in 1\.\.999 reflecting the spec/);
  });

  it('unset isPriorityFromSpec (undefined) behaves like default (Handlebars falsy)', async () => {
    const output = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/rules',
      { ...BASE_VARS /* isPriorityFromSpec omitted */ },
    );
    expect(output).toMatch(/100–189: setup, 200–279: feature \(shared foundation/);
    expect(output).toMatch(
      /\*\*Note\*\*: `priority` is the ordering key \(lower = earlier\)/,
    );
    expect(output).not.toMatch(/Free integer in 1\.\.999 reflecting the spec/);
  });
});
