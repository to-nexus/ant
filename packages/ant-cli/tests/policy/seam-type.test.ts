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

describe('seam type — seam-connectivity-closure partial (type-gated)', () => {
  const adapter = new FilePromptAdapter();
  const PARTIAL = 'jobs/code/base/injections/seam-connectivity-closure';

  it('plan parent (seamPlanning, not a slice): enumerates & partitions into batches', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/CROSS-FEATURE REFERENCE \+ AFFORDANCE CLOSURE/);
    expect(out).toMatch(/Enumerate this module's\s+references AND rendered affordances/);
    expect(out).toMatch(/emit them as batches/);
    expect(out).not.toMatch(/This is one slice\./);
    // resolve-or-remove remediation always present.
    expect(out).toMatch(/References resolve\./);
    expect(out).toMatch(/Affordances resolve or are removed\./);
  });

  it('plan slice (isSliceDeclaration): does NOT re-enumerate or re-partition', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: true, isSliceDeclaration: true });
    expect(out).toMatch(/This is one slice\./);
    expect(out).toMatch(/non-negotiable/);
    expect(out).not.toMatch(/emit them as batches/);
  });

  it('execute phase (seamPlanning false): only remediation, no planning blocks', async () => {
    const out = await adapter.render(PARTIAL, { taskType: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(out).toMatch(/Affordances resolve or are removed\./);
    expect(out).not.toMatch(/emit them as batches/);
    expect(out).not.toMatch(/This is one slice\./);
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
