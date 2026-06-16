/**
 * Locks the `seam` TaskType — cross-feature REFERENCE + AFFORDANCE closure, run
 * AFTER all authoring (feature + ui) over the materialized graph. Seam was a
 * feature BAND historically; it is now its own TYPE (essence = closure, not
 * authoring — the verification/error family).
 *
 * Covers:
 *   1. seam is a registered TaskType with its own bundle (isSeamTask predicate).
 *   2. deriveBandFromPriority — seam is NOT a band anymore (no priority→'seam').
 *   3. TASK_PRIORITY — seam window [750,799] sits AFTER ui [650,749] and
 *      BEFORE test-code (800).
 *   4. seam bundle scheduling — consumes the seam gate + blocks testgen/doc;
 *      does NOT produce the gate (sub-slices never self-block) and does NOT
 *      block ui (ui runs before seam — no ui↔seam deadlock).
 *   5. every AUTHORING bundle (feature/ui/design-system/setup) PRODUCES the
 *      seam gate, so seam waits for the whole materialized graph incl. ui.
 *   6. batchSplit — a seam parent splits into seam sub-slices (type carried
 *      verbatim).
 *   7. seam-connectivity-closure partial — type-gated; plan parent enumerates,
 *      plan slice does not re-partition, execute renders only remediation,
 *      non-seam renders nothing; resolve-or-remove; FPOP neutrality.
 *   8. priority SSOT — decompose tables agree (700 seam, 750 test-code).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveBandFromPriority } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { windowFor } from '../../src/agents/architect/graph/code/state';
import { renderPriorityBandGuide } from '../../src/agents/architect/graph/code/state.priorityGuide';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import { isSeamTask } from '../../src/agents/architect/graph/code/tasks/seam';
import { processDiagnosticBatchSplit } from '../../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';
import type { OrchestratorConfig } from '../../src/agents/common/graph/parallelTypes';

const TEMPLATES = join(
  __dirname,
  '../../src/core/prompt/templates/jobs/code/nodes/decompose/variants/default',
);

describe('seam type — registry + predicate', () => {
  it('seam is a registered TaskType bundle', () => {
    expect(hooksForTaskType('seam')).toBeDefined();
  });
  it('isSeamTask discriminates on type', () => {
    expect(isSeamTask({ type: 'seam' })).toBe(true);
    expect(isSeamTask({ type: 'feature' })).toBe(false);
    expect(isSeamTask(undefined)).toBe(false);
  });
});

describe('seam type — NOT a band (deriveBandFromPriority)', () => {
  it('no priority maps to a "seam" band', () => {
    // ui [650,749] and seam [750,799] derive no feature band.
    expect(deriveBandFromPriority(650)).toBeUndefined();
    expect(deriveBandFromPriority(700)).toBeUndefined();
    expect(deriveBandFromPriority(749)).toBeUndefined();
    // integration below stays a band.
    expect(deriveBandFromPriority(649)).toBe('integration');
    expect(deriveBandFromPriority(750)).toBeUndefined();
    expect(deriveBandFromPriority(799)).toBeUndefined();
  });
});

describe('seam type — TASK_PRIORITY window (after ui, before test-code)', () => {
  it('seam [750,799] sits after ui [650,749] and before test-code (800)', () => {
    expect(windowFor('seam')).toEqual({ min: 750, max: 799 });
    expect(windowFor('ui')).toEqual({ min: 650, max: 749 });
    expect(windowFor('ui').max).toBeLessThan(windowFor('seam').min);
    expect(windowFor('seam').max).toBeLessThan(windowFor('test-code').min);
    expect(windowFor('test-code').min).toBe(800);
  });
});

describe('seam type — bundle scheduling (gate consumer, never producer; blocks testgen/doc; not ui)', () => {
  const sched = hooksForTaskType('seam')?.scheduling;

  it('consumes the seam gate + expanded RAG; does NOT produce it (no self-block)', () => {
    const c = sched?.classify?.({ type: 'seam' } as any);
    expect(c?.consumesSeamGate).toBe(true);
    expect(c?.expandedRagQuota).toBe(true);
    expect(c?.producesSeamGate).toBeFalsy();
  });

  it('opts into the pre-seam barrier and blocks testgen/doc; never blocks ui', () => {
    expect(sched?.preSeamBarrier).toBe(true);
    expect(sched?.blocksTestgen).toBe(true);
    expect(sched?.blocksDoc).toBe(true);
    // ui runs BEFORE seam — seam blocking ui would deadlock (ui produces the
    // gate seam waits on). Regression guard.
    expect(sched?.blocksUi).toBeUndefined();
  });
});

describe('seam type — every authoring bundle produces the seam gate', () => {
  it('feature / ui / design-system / setup all report producesSeamGate', () => {
    for (const t of ['feature', 'ui', 'design-system', 'setup'] as const) {
      const c = hooksForTaskType(t)?.scheduling?.classify?.({ type: t } as any);
      expect(c?.producesSeamGate).toBe(true);
    }
  });
});

describe('seam type — batchSplit carries the seam TYPE verbatim', () => {
  it('seam parent → seam sub-slices (type kept, consume side, no gate produced)', () => {
    const state: any = {
      taskQueue: new TaskQueue<CodeTask>(),
      _batchSplitRequeued: false,
      context: { featurePath: undefined },
      _httpJobId: undefined,
    };
    const seamParent: CodeTask = {
      id: 'seam-parent',
      name: 'app reference closure',
      type: 'seam',
      priority: windowFor('seam').min,
      parallelGroup: 'seam-app',
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      parentReasoning: 'navigation + handlers diverge across feature parts.',
      batches: [
        { name: 'nav slice', rationale: 'routes', parallelGroup: 'nav', priorityInParallelGroup: 0 },
        { name: 'handler slice', rationale: 'handlers', parallelGroup: 'handlers', priorityInParallelGroup: 0 },
      ],
    });

    processDiagnosticBatchSplit(state, plan, seamParent);

    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'seam');
    expect(subs.length).toBe(2);
    const classify = hooksForTaskType('seam')!.scheduling!.classify!;
    for (const s of subs) {
      expect(s.type).toBe('seam'); // type carry-over
      // child priority = parent + priorityInParallelGroup, inside the window
      expect(s.priority).toBeGreaterThanOrEqual(windowFor('seam').min);
      expect(s.priority).toBeLessThanOrEqual(windowFor('seam').max);
      expect(classify(s as any).consumesSeamGate).toBe(true);
      expect(classify(s as any).producesSeamGate).toBeFalsy();
    }
  });
});

describe('seam type — partition is runtime-owned via closureSlices (RCA: third-housing-forge)', () => {
  const mkState = (): any => ({
    taskQueue: new TaskQueue<CodeTask>(),
    _batchSplitRequeued: false,
    context: { featurePath: undefined },
    _httpJobId: undefined,
  });
  const mkSeam = (): CodeTask => ({
    id: 'seam-parent',
    name: 'app reference closure',
    type: 'seam',
    priority: windowFor('seam').min,
    parallelGroup: 'seam-app',
    description: '',
  } as CodeTask);

  it('flat plan with 2+ closureSlices auto-fans-out (no discretionary flat escape)', () => {
    const state = mkState();
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      parentReasoning: 'navigation + handlers diverge across feature parts.',
      // NOTE: no `batches[]` — the LLM emitted its enumeration as closureSlices.
      closureSlices: [
        { name: 'nav slice', rationale: 'routes', parallelGroup: 'nav', priorityInParallelGroup: 0 },
        { name: 'handler slice', rationale: 'handlers', parallelGroup: 'handlers', priorityInParallelGroup: 0 },
      ],
    });
    const out = processDiagnosticBatchSplit(state, plan, mkSeam());
    // fan-out fired → planText cleared, sub-tasks pushed
    expect(out).toBe('');
    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'seam');
    expect(subs.length).toBe(2);
  });

  it('single closureSlice does NOT fan out (legitimate single disjoint file set → flat)', () => {
    const state = mkState();
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      closureSlices: [{ name: 'only slice', rationale: 'one set' }],
      implementation: { modify: [{ file: 'a', changes: 'x' }], create: [], delete: [] },
    });
    const out = processDiagnosticBatchSplit(state, plan, mkSeam());
    // no fan-out — flat plan flows through unchanged
    expect(out).toBe(plan);
    expect(state.taskQueue.getAll().filter((t: any) => t.type === 'seam').length).toBe(0);
  });

  it('slice closureItems carry into each sub-task prePlanText (no re-derive → no duplicate thin slices)', () => {
    // bright-causing-brick RCA: children that received only the slice NAME
    // re-derived their inventory and emitted duplicate thin slices
    // (`comments-css-closure` x2). seamBatchShape carries the parent's
    // pre-enumerated `closureItems` verbatim so the child remediates exactly
    // those, never re-enumerating.
    const state = mkState();
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      closureSlices: [
        {
          name: 'nav slice',
          rationale: 'routes',
          closureItems: ['Link to /assignments (to-fix: no route owns it)'],
          parallelGroup: 'nav',
          priorityInParallelGroup: 0,
        },
        {
          name: 'css slice',
          rationale: 'selectors',
          closureItems: ['.screen selector named but undefined (to-fix)'],
          parallelGroup: 'css',
          priorityInParallelGroup: 0,
        },
      ],
    });
    const out = processDiagnosticBatchSplit(state, plan, mkSeam());
    expect(out).toBe('');
    const subs = state.taskQueue.getAll().filter((t: any) => t.type === 'seam');
    expect(subs.length).toBe(2);
    // each child's prePlanText carries its own (distinct) closureItems inventory
    const prePlans = subs.map((t: any) => t.prePlanText ?? '');
    expect(prePlans.some((p: string) => p.includes('/assignments'))).toBe(true);
    expect(prePlans.some((p: string) => p.includes('.screen selector'))).toBe(true);
    for (const p of prePlans) expect(p).toMatch(/closureItems/);
  });

  it('explicit batches[] wins — closureSlices does not double-source the fan-out', () => {
    const state = mkState();
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      batches: [
        { name: 'b1', rationale: 'r1' },
        { name: 'b2', rationale: 'r2' },
        { name: 'b3', rationale: 'r3' },
      ],
      closureSlices: [{ name: 's1', rationale: 'x' }, { name: 's2', rationale: 'y' }],
    });
    const out = processDiagnosticBatchSplit(state, plan, mkSeam());
    expect(out).toBe('');
    // 3 from batches[], NOT 2 from closureSlices
    expect(state.taskQueue.getAll().filter((t: any) => t.type === 'seam').length).toBe(3);
  });
});

describe('seam type — seam-connectivity-closure partial (type-gated)', () => {
  const adapter = new FilePromptAdapter();
  const PARTIAL = 'jobs/code/base/injections/seam/connectivity-closure';

  it('inert placeholder targets (href="#"/no-op) are NOT resolved (RCA: third-housing-forge dead links)', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/inert placeholder\s+target/i);
    expect(out).toMatch(/#`-only/);
    expect(out).toMatch(/no-op/i);
  });

  it('cross-app / cross-package outbound references resolve to the destination entry contract', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(out).toMatch(/Cross-app \/ cross-package outbound references resolve/);
    expect(out).toMatch(/published entry\s+contract/);
    expect(out).toMatch(/never a raw literal absolute path and never an inert placeholder/);
  });

  it('FIRST-ENTRY partition-only (isPartitionOnlyPhase): enumerates + partitions, remediation WITHHELD', async () => {
    // bright-causing-brick RCA: a fresh seam parent that saw BOTH the partition
    // and the remediation guidance wandered into solving instead of partitioning
    // (seam-app emitted zero slices; seam-admin emitted 2 duplicate thin slices).
    // First entry is now partition-ONLY — remediation principles are gated out.
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false, isPartitionOnlyPhase: true });
    expect(out).toMatch(/CROSS-FEATURE REFERENCE \+ AFFORDANCE CLOSURE/);
    // single job this phase: partition, not remediate.
    expect(out).toMatch(/Do NOT remediate, fix, or reason about HOW to resolve anything yet/);
    // Denominator: the prior-completed manifest restricted to THIS module's path.
    expect(out).toMatch(/restrict it\s+to the files under THIS module's own path/);
    expect(out).toMatch(/Walk it file by file/);
    expect(out).toMatch(/A file left unexamined — in either\s+direction — is a hole in the closure\./);
    // Partition is runtime-owned: emitted as a REQUIRED `closureSlices[]`.
    expect(out).toMatch(/closureSlices/);
    expect(out).toMatch(/REQUIRED output of this phase/);
    // A2 — always declare the denominator: single set still emits a single-entry
    // array, never a silent flat-solve (the seam-app zero-slice path).
    expect(out).toMatch(/Always emit `closureSlices`, even when your enumeration found exactly one/);
    // A3 — each slice carries its pre-enumerated closureItems inventory (the
    // discriminator that stops duplicate thin slices).
    expect(out).toMatch(/closureItems/);
    expect(out).not.toMatch(/This is one slice\./);
    // remediation principles are WITHHELD in the partition-only phase.
    expect(out).not.toMatch(/\*\*Remediation — resolve OR remove/);
    expect(out).not.toMatch(/Affordances resolve or are removed\./);
  });

  it('closure is BIDIRECTIONAL — partition walks both directions; remediation has the inbound edge', async () => {
    // RCA (neat-melting-kayak): the outbound/dangling-only model missed a built
    // CommentThreadScreen that nothing mounted and a data-comment-anchor slot
    // left empty — inbound/missing-edge gaps invisible to "references it EMITS".
    // Partition phase (first entry) does the bidirectional walk; the inbound
    // remediation edge lives in the remediation phase (slice-child / flat-execute).
    const partition = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false, isPartitionOnlyPhase: true });
    // intro frames closure as bidirectional (header — always present)
    expect(partition).toMatch(/Closure is \*\*bidirectional\*\*/);
    // planning walks both directions, naming the inbound walk
    expect(partition).toMatch(/Walk it file by file in BOTH directions/);
    expect(partition).toMatch(/\*\*Inbound\*\*/);
    expect(partition).toMatch(/reach-role/);

    // remediation phase (execute): the backward edge mirrors "References resolve".
    const remediation = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(remediation).toMatch(/Reach-role parts are reached \(the closure is bidirectional\)\./);
    expect(remediation).toMatch(/nothing mounts/);
    expect(remediation).toMatch(/mount\/extension slot left empty/);
    // still grounded in materialized code (observe, not intent-recall)
    expect(remediation).toMatch(/Both ends already\s+exist in the materialized code/);
  });

  it('plan slice (isSliceDeclaration): does NOT re-enumerate or re-partition', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: true });
    expect(out).toMatch(/This is one slice\./);
    expect(out).toMatch(/non-negotiable/);
    expect(out).not.toMatch(/emit ONE batch per file set/);
    expect(out).not.toMatch(/Walk it file by file/);
  });

  it('execute phase (seamPlanning false): only remediation, no planning blocks', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(out).toMatch(/Affordances resolve or are removed\./);
    expect(out).not.toMatch(/emit ONE batch per file set/);
    expect(out).not.toMatch(/This is one slice\./);
  });

  it('reference taxonomy includes style-selector + a Style-selectors-resolve remediation edge', async () => {
    // classboard `.board-grid`/`.cols`/`.bc-*` undefined-class defect: a named
    // selector with no backing definition is a seam to close, not invisible to it.
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/a style-selector a\s+rendered element names/);
    expect(out).toMatch(/Style-selectors resolve\./);
    expect(out).toMatch(/silently renders the element unstyled/);
  });

  it('gated-entry closure binds "lands" to closed-system usability (admin about:blank#mock defect)', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/Gated entry lands\./);
    expect(out).toMatch(/resolves within the\s+closed system/);
    expect(out).toMatch(/completes back into\s+an authenticated session/);
    expect(out).toMatch(/placeholder\/blank\/external address/);
  });

  it('non-seam task type renders nothing', async () => {
    for (const taskType of ['feature', 'ui', 'integration', undefined]) {
      const out = await adapter.render(PARTIAL, { taskType, seamPlanning: true, isSliceDeclaration: false });
      expect(out.trim()).toBe('');
    }
  });

  it('FPOP neutrality — no platform/library/framework terms', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).not.toMatch(/React|Next\.js|Tailwind|router\.push|Express|useNavigate/);
  });
});

describe('seam type — priority SSOT consistency', () => {
  it('rendered priority band guide agrees with TASK_PRIORITY (seam 750–799 after ui, test-code 800–849)', () => {
    // The band table is rendered from TASK_PRIORITY (single SSOT) and injected
    // into base.md via {{{priorityBandGuide}}} — assert the rendered output, not
    // a hand-copied table.
    const guide = renderPriorityBandGuide();
    expect(guide).toMatch(/650–749: ui/);
    expect(guide).toMatch(/750–799: seam/);
    expect(guide).toMatch(/800–849: test-code/);
    // ui appears before seam in the ordered guide.
    expect(guide.indexOf('ui')).toBeLessThan(guide.indexOf('seam'));
    // No stale feature-band seam line.
    expect(guide).not.toMatch(/feature \(seam/);
  });

  it('OrchestratorConfig.barriers carries the seam flag', () => {
    const barriers: NonNullable<OrchestratorConfig['barriers']> = { seam: true };
    expect(barriers.seam).toBe(true);
  });
});
