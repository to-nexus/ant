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
    expect(out).toMatch(/inert placeholder target/i);
    expect(out).toMatch(/#`-only/);
    expect(out).toMatch(/no-op/i);
  });

  it('cross-app / cross-package outbound references resolve to the destination entry contract', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(out).toMatch(/Cross-app \/ cross-package outbound references resolve/);
    expect(out).toMatch(/published entry\s+contract/);
    expect(out).toMatch(/never a raw literal absolute path and never an inert placeholder/);
  });

  it('plan parent (seamPlanning, not a slice): enumerates over a module-scoped denominator & partitions', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/CROSS-FEATURE REFERENCE \+ AFFORDANCE CLOSURE/);
    // Denominator: the prior-completed manifest restricted to THIS module's path,
    // walked file by file (recall-sweep → grounded enumeration). Root fix for the
    // snowy-grilling-shelf shallow seam (flat_plan_no_batches under-enumeration).
    expect(out).toMatch(/restrict it\s+to the files under THIS module's own path/);
    expect(out).toMatch(/Walk it file by file/);
    expect(out).toMatch(/A file left unexamined — in either\s+direction — is a hole in the closure\./);
    // Partition is runtime-owned, not LLM-discretion: the enumeration is emitted
    // as a REQUIRED `closureSlices[]`; 2+ slices auto-fan-out (RCA: third-housing-
    // forge — flat_plan_no_batches let a whole-app audit run as one shallow pass).
    expect(out).toMatch(/closureSlices/);
    expect(out).toMatch(/REQUIRED output of the enumeration/);
    expect(out).toMatch(/two or more.* disjoint file sets/);
    // single set → inline flat plan (no closureSlices), so the flat path always
    // carries an implementation — never a closureSlices-with-no-implementation gap.
    expect(out).toMatch(/exactly \*\*one\*\* disjoint file set.* do NOT emit\s+`closureSlices`/);
    expect(out).not.toMatch(/This is one slice\./);
    // resolve-or-remove remediation always present.
    expect(out).toMatch(/References resolve\./);
    expect(out).toMatch(/Affordances resolve or are removed\./);
  });

  it('closure is BIDIRECTIONAL — backward direction catches built-but-unreached parts (orphans / empty mount slots)', async () => {
    // RCA (neat-melting-kayak): the outbound/dangling-only model missed a built
    // CommentThreadScreen that nothing mounted and a data-comment-anchor slot
    // left empty — inbound/missing-edge gaps invisible to "references it EMITS".
    // Fix completes seam's own "operable whole" principle to a symmetric relation.
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    // intro frames closure as bidirectional
    expect(out).toMatch(/Closure is \*\*bidirectional\*\*/);
    // planning walks both directions, naming the inbound walk
    expect(out).toMatch(/Walk it file by file in BOTH directions/);
    expect(out).toMatch(/\*\*Inbound\*\*/);
    expect(out).toMatch(/reach-role/);
    // a backward remediation edge mirrors "References resolve"
    expect(out).toMatch(/Reach-role parts are reached \(the closure is bidirectional\)\./);
    expect(out).toMatch(/nothing mounts/);
    expect(out).toMatch(/mount\/extension slot left empty/);
    // still grounded in materialized code (observe, not intent-recall)
    expect(out).toMatch(/Both ends already\s+exist in the materialized code/);
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
