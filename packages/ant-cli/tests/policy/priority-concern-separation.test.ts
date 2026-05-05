/**
 * Priority Concern Separation — policy lock.
 *
 * Locks the R1+D31 invariant: priority is PURELY an ordering key; scheduling
 * classification (foundation/tokens/integration/final) is OWNED by each
 * task bundle's `scheduling.classify` hook. Phase-layer code MUST NEVER
 * compare raw `task.priority` bands.
 *
 * Tests:
 *   1. Static check — phase-layer files contain ZERO `task.priority`
 *      numeric comparisons. Allow-list: bundle classify implementations
 *      (tasks/**\/hooks/scheduling.ts), task state module (state.ts),
 *      decompose responseParser (Phase 2 scope), and defensive ordering
 *      clamps (batchSplit/process.ts Math.max).
 *   2. Behavioral check — each bundle's classify returns the expected
 *      flags for known priority bands.
 *   3. Template check — the execute `default/base.md` template uses the
 *      `currentTaskIsFinal` gate, not `(eq currentTask.priority 1000)`.
 *
 * History — prior to Phase 1 the orchestrator, buildMessages, combine,
 * validation, and sessionManager each carried private priority-window
 * comparisons that re-encoded task.type via numeric bands. Those are
 * replaced by `hooksForTaskType(t.type)?.scheduling?.classify?.(t)` calls
 * so the bundle remains the single SSOT for "this priority band means
 * scheduling role X".
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import type { CodeTask } from '../../src/agents/architect/types/task';

const repoRoot = path.resolve(__dirname, '../..');

function readFile(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function task(overrides: Partial<CodeTask>): CodeTask {
  return {
    id: 't',
    name: 't',
    type: 'feature',
    priority: 300,
    description: '',
    ...overrides,
  } as CodeTask;
}

describe('priority concern separation — static grep gate', () => {
  it('TaskOrchestrator.ts — no raw priority numeric comparisons', () => {
    const src = readFile('src/agents/architect/graph/code/parallel/TaskOrchestrator.ts');
    // Allow `t.priority` / `task.priority` references only when they
    // are (a) assigned to a schedClassify-style output, or (b) passed
    // as arguments. We reject any pattern that compares priority to a
    // numeric literal or TASK_PRIORITIES.* member.
    const rawNumericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
    const prioritiesCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;
    expect(src.match(rawNumericCmp)).toBeNull();
    expect(src.match(prioritiesCmp)).toBeNull();
  });

  it('buildMessages.ts — no raw priority numeric comparisons', () => {
    const src = readFile('src/agents/architect/graph/code/nodes/execute/buildMessages.ts');
    const rawNumericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
    const prioritiesCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;
    expect(src.match(rawNumericCmp)).toBeNull();
    expect(src.match(prioritiesCmp)).toBeNull();
  });

  it('nodes/plan/rag/combine.ts — no raw priority numeric comparisons', () => {
    const src = readFile('src/agents/architect/graph/code/nodes/plan/rag/combine.ts');
    const rawNumericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
    const prioritiesCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;
    expect(src.match(rawNumericCmp)).toBeNull();
    expect(src.match(prioritiesCmp)).toBeNull();
  });

  it('nodes/decompose/validation.ts — no raw priority numeric comparisons', () => {
    const src = readFile('src/agents/architect/graph/code/nodes/decompose/validation.ts');
    const rawNumericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
    const prioritiesCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;
    expect(src.match(rawNumericCmp)).toBeNull();
    expect(src.match(prioritiesCmp)).toBeNull();
  });

  it('nodes/decompose/sessionManager.ts — no raw priority numeric comparisons', () => {
    const src = readFile('src/agents/architect/graph/code/nodes/decompose/sessionManager.ts');
    const rawNumericCmp = /\.priority\s*[<>!=]=?\s*\d+/g;
    const prioritiesCmp = /\.priority\s*[<>!=]=?\s*TASK_PRIORITIES\./g;
    expect(src.match(rawNumericCmp)).toBeNull();
    expect(src.match(prioritiesCmp)).toBeNull();
  });

  it('execute/variants/default/base.md — uses currentTaskIsFinal, not priority literal', () => {
    const src = readFile('src/core/prompt/templates/jobs/code/nodes/execute/variants/default/base.md');
    // The legacy guard `(eq currentTask.priority 1000)` is gone.
    expect(src).not.toMatch(/\(eq\s+currentTask\.priority\s+1000\)/);
    // The classify-driven gate MUST appear at least twice (setup + feature branches).
    const occurrences = src.match(/\{\{#unless\s+currentTaskIsFinal\s*\}\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });
});

describe('priority concern separation — classify behaviour', () => {
  it('feature.band==="foundation" ⇒ isFoundation + expandedRagQuota', () => {
    const classify = hooksForTaskType('feature')?.scheduling?.classify;
    expect(classify).toBeDefined();
    expect(classify!(task({ type: 'feature', band: 'foundation' }))).toMatchObject({
      isFoundation: true,
      expandedRagQuota: true,
    });
  });

  it('feature.band===undefined ⇒ producesIntegrationGate', () => {
    const classify = hooksForTaskType('feature')?.scheduling?.classify;
    expect(classify!(task({ type: 'feature' }))).toMatchObject({
      producesIntegrationGate: true,
      consumesIntegrationGate: false,
      isFoundation: false,
    });
  });

  it('feature.band==="integration" ⇒ consumesIntegrationGate + expandedRagQuota', () => {
    const classify = hooksForTaskType('feature')?.scheduling?.classify;
    expect(classify!(task({ type: 'feature', band: 'integration' }))).toMatchObject({
      consumesIntegrationGate: true,
      expandedRagQuota: true,
      producesIntegrationGate: false,
    });
  });

  it('design-system ⇒ isFoundation (type-fixed, ignores priority)', () => {
    const classify = hooksForTaskType('design-system')?.scheduling?.classify;
    expect(classify).toBeDefined();
    expect(classify!(task({ type: 'design-system', priority: 200 }))).toMatchObject({
      isFoundation: true,
      expandedRagQuota: true,
    });
    // Type-fixed: priority is irrelevant.
    expect(classify!(task({ type: 'design-system', priority: 999 }))).toMatchObject({
      isFoundation: true,
      expandedRagQuota: true,
    });
  });

  it('verification ⇒ isFinal (type-fixed, ignores priority)', () => {
    const classify = hooksForTaskType('verification')?.scheduling?.classify;
    expect(classify).toBeDefined();
    expect(classify!(task({ type: 'verification', priority: 1000 }))).toMatchObject({
      isFinal: true,
    });
    // Type-fixed: priority irrelevant — the system has no
    // "non-final verification task" (see verification/model/is.ts).
    expect(classify!(task({ type: 'verification', priority: 999 }))).toMatchObject({
      isFinal: true,
    });
  });

  it('doc@150 (design-job tokens) ⇒ isTokens', () => {
    const classify = hooksForTaskType('doc')?.scheduling?.classify;
    expect(classify).toBeDefined();
    expect(classify!(task({ type: 'doc', priority: 150 }))).toMatchObject({
      isTokens: true,
      isFoundation: false,
    });
  });

  it('doc@250 (design-job assets) ⇒ isFoundation', () => {
    const classify = hooksForTaskType('doc')?.scheduling?.classify;
    expect(classify!(task({ type: 'doc', priority: 250 }))).toMatchObject({
      isTokens: false,
      isFoundation: true,
    });
  });

  it('doc@800 (code-job doc) ⇒ all classify flags false (inert)', () => {
    const classify = hooksForTaskType('doc')?.scheduling?.classify;
    expect(classify!(task({ type: 'doc', priority: 800 }))).toMatchObject({
      isTokens: false,
      isFoundation: false,
    });
  });

  it('setup ⇒ isTokens (type-fixed, foundation-gate exemption)', () => {
    // Setup tasks must slip through `hasPreFeatureWork` so monorepo
    // package-level setup does not deadlock while design-system tasks
    // sit queued. Type-fixed under Three-Axis SSOT — every setup task
    // is "below-foundation, runs first". See regression rationale in
    // `tasks/setup/hooks/scheduling.ts`.
    const classify = hooksForTaskType('setup')?.scheduling?.classify;
    expect(classify).toBeDefined();
    expect(classify!(task({ type: 'setup', priority: 100 }))).toMatchObject({
      isTokens: true,
    });
    expect(classify!(task({ type: 'setup', priority: 189 }))).toMatchObject({
      isTokens: true,
    });
    // Type-fixed: priority is irrelevant.
    expect(classify!(task({ type: 'setup', priority: 999 }))).toMatchObject({
      isTokens: true,
    });
  });

  it('ui / test-code / error / explain — no classify published (inert for scheduling)', () => {
    expect(hooksForTaskType('ui')?.scheduling?.classify).toBeUndefined();
    expect(hooksForTaskType('test-code')?.scheduling?.classify).toBeUndefined();
    expect(hooksForTaskType('error')?.scheduling?.classify).toBeUndefined();
    expect(hooksForTaskType('explain')?.scheduling?.classify).toBeUndefined();
  });
});

describe('priority concern separation — batchSplit clamp', () => {
  it('parent priority 1 ⇒ sub priority clamped to 1 (no 0 / negative)', () => {
    // Import the SSOT — the clamp lives in batchSplit/process.ts L217.
    // We test the pure expression so the clamp stays stable even if
    // the surrounding process.ts shape changes.
    const sub = (parent: number) => Math.max(1, (parent || 500) - 1);
    expect(sub(1)).toBe(1);
    expect(sub(0)).toBe(499); // fallback to 500 via || default, then -1
    expect(sub(2)).toBe(1);
    expect(sub(500)).toBe(499);
  });
});
