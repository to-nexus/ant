/**
 * Locks the `seam` band — the cross-feature REFERENCE CLOSURE tier between
 * `integration` (host-entry wiring) and `ui` (visual pass). One seam task per
 * package owns its outbound-reference closure; its PLAN phase enumerates the
 * reference graph and fans out `batches[]` into disjoint-file slices.
 *
 * Covers:
 *   1. deriveBandFromPriority — seam window [650,669] maps to 'seam';
 *      integration [600,649] and the ui window [670,699] stay band-less.
 *   2. TASK_PRIORITIES — seam window carved before the shifted visual window.
 *   3. FeatureBand discriminated-union — feature may carry 'seam'; other types
 *      may not.
 *   4. feature scheduling classify — seam produces/consumes the seam gate so it
 *      waits on all non-seam feature work, and seam sub-slices never block each
 *      other (no deadlock — mirrors the integration gate split).
 *   5. batchSplit Path B — a seam feature parent splits into seam feature
 *      sub-slices (band carried verbatim, priority preserved) that satisfy the
 *      consume side without producing the gate.
 *   6. seam-connectivity-closure partial — plan parent enumerates, plan slice
 *      does not re-partition, execute renders only the remediation principles,
 *      non-seam bands render nothing; FPOP neutrality.
 *   7. priority SSOT — prompt tables agree with TASK_PRIORITIES; barriers
 *      interface carries `seam`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveBandFromPriority } from '../../src/agents/architect/graph/code/nodes/decompose/responseParser';
import { TASK_PRIORITIES } from '../../src/agents/architect/graph/code/state';
import { FilePromptAdapter } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { hooksForTaskType } from '../../src/agents/architect/graph/code/tasks/_shared/registry';
import { processDiagnosticBatchSplit } from '../../src/agents/architect/graph/code/tasks/_shared/batchSplit';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { CodeTask } from '../../src/agents/architect/types/task';
import type { FeatureTask, VerificationTask } from '@ant/shared';
import type { OrchestratorConfig } from '../../src/agents/common/graph/parallelTypes';

const TEMPLATES = join(
  __dirname,
  '../../src/core/prompt/templates/jobs/code/nodes/decompose/variants/default',
);

describe('seam band — deriveBandFromPriority (priority→band SSOT)', () => {
  it("maps [650,669] → 'seam'", () => {
    expect(deriveBandFromPriority(TASK_PRIORITIES.SEAM_MIN)).toBe('seam');
    expect(deriveBandFromPriority(650)).toBe('seam');
    expect(deriveBandFromPriority(660)).toBe('seam');
    expect(deriveBandFromPriority(TASK_PRIORITIES.SEAM_MAX)).toBe('seam');
    expect(deriveBandFromPriority(669)).toBe('seam');
  });

  it('keeps integration below and ui above band-less', () => {
    expect(deriveBandFromPriority(649)).toBe('integration');
    expect(deriveBandFromPriority(600)).toBe('integration');
    // ui tasks are type 'ui' (no band) — the shifted visual window 670-699
    // derives no feature band.
    expect(deriveBandFromPriority(670)).toBeUndefined();
    expect(deriveBandFromPriority(699)).toBeUndefined();
  });
});

describe('seam band — TASK_PRIORITIES window', () => {
  it('carves [650,669] before the shifted visual window [670,699]', () => {
    expect(TASK_PRIORITIES.SEAM_MIN).toBe(650);
    expect(TASK_PRIORITIES.SEAM_MAX).toBe(669);
    expect(TASK_PRIORITIES.VISUAL_PASS).toBe(670);
    expect(TASK_PRIORITIES.VISUAL_MAX).toBe(699);
    expect(TASK_PRIORITIES.SEAM_MAX).toBeLessThan(TASK_PRIORITIES.VISUAL_PASS);
    expect(TASK_PRIORITIES.INTEGRATION_MAX).toBeLessThan(TASK_PRIORITIES.SEAM_MIN);
  });
});

describe('seam band — FeatureBand discriminated-union guard', () => {
  it('feature carries seam; other types cannot', () => {
    const common = { name: 'n', description: 'd' };
    const seamFeat: FeatureTask = { id: 'f', priority: 650, type: 'feature', band: 'seam', ...common };
    // @ts-expect-error verification tasks carry no band
    const badVerif: VerificationTask = { id: 'v', priority: 1000, type: 'verification', band: 'seam', ...common };
    expect([seamFeat, badVerif]).toHaveLength(2);
    expect(seamFeat.band).toBe('seam');
  });
});

describe('seam band — feature scheduling classify (seam gate split)', () => {
  const classify = hooksForTaskType('feature')?.scheduling?.classify;

  it('seam band consumes the gate, does NOT produce it (sub-slices never self-block)', () => {
    expect(classify).toBeDefined();
    const seam = classify!({ type: 'feature', band: 'seam' } as any);
    expect(seam.consumesSeamGate).toBe(true);
    expect(seam.producesSeamGate).toBe(false);
    expect(seam.expandedRagQuota).toBe(true);
  });

  it('every non-seam feature band produces the seam gate (gates the seam pass)', () => {
    for (const band of ['foundation', 'platform', 'integration', undefined] as const) {
      const c = classify!({ type: 'feature', band } as any);
      expect(c.producesSeamGate).toBe(true);
      expect(c.consumesSeamGate).toBe(false);
    }
  });

  it('feature bundle opts into the pre-seam barrier', () => {
    expect(hooksForTaskType('feature')?.scheduling?.preSeamBarrier).toBe(true);
  });
});

describe('seam band — batchSplit Path B carries the seam band verbatim', () => {
  it('seam feature parent → seam feature sub-slices (band kept, priority preserved, gate not produced)', () => {
    const state: any = {
      taskQueue: new TaskQueue<CodeTask>(),
      _batchSplitRequeued: false,
      context: { featurePath: undefined },
      _httpJobId: undefined,
    };
    const seamParent: CodeTask = {
      id: 'seam-parent',
      name: 'app reference closure',
      type: 'feature',
      priority: 655,
      band: 'seam',
      parallelGroup: 'seam-app',
      description: '',
    } as CodeTask;
    const plan = JSON.stringify({
      task: { id: 'parent', goal: 'close app references' },
      parentReasoning: 'navigation + handlers diverge across feature parts.',
      batches: [
        { name: 'nav slice', rationale: 'routes', modify: [{ target: 'routes.ts' }], create: [], delete: [] },
        { name: 'handler slice', rationale: 'handlers', modify: [{ target: 'handlers.ts' }], create: [], delete: [] },
      ],
    });

    processDiagnosticBatchSplit(state, plan, seamParent);

    const subs = state.taskQueue
      .getAll()
      .filter((t: any) => t.type === 'feature' && t.band === 'seam');
    expect(subs.length).toBe(2);

    const classify = hooksForTaskType('feature')!.scheduling!.classify!;
    for (const s of subs) {
      expect(s.priority).toBe(seamParent.priority); // Path B preserves parent priority
      expect(s.band).toBe('seam'); // verbatim carry-over
      // Deadlock-freedom: seam children consume the gate but never produce it,
      // so once non-seam feature work drains they unblock and never block siblings.
      expect(classify(s as any).consumesSeamGate).toBe(true);
      expect(classify(s as any).producesSeamGate).toBe(false);
    }
  });
});

describe('seam band — seam-connectivity-closure partial', () => {
  const adapter = new FilePromptAdapter();
  const PARTIAL = 'jobs/code/base/injections/seam-connectivity-closure';

  it('plan parent (seamPlanning, not a slice): enumerates & partitions into batches', async () => {
    const out = await adapter.render(PARTIAL, { taskBand: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).toMatch(/CROSS-FEATURE REFERENCE CLOSURE/);
    expect(out).toMatch(/Enumerate this module's\s+references/);
    expect(out).toMatch(/emit them as batches/);
    expect(out).not.toMatch(/This is one slice\./);
    // Remediation principles always present.
    expect(out).toMatch(/References resolve\./);
    expect(out).toMatch(/Gated entry lands\./);
  });

  it('plan slice (isSliceDeclaration): does NOT re-enumerate or re-partition', async () => {
    const out = await adapter.render(PARTIAL, { taskBand: 'seam', seamPlanning: true, isSliceDeclaration: true });
    expect(out).toMatch(/This is one slice\./);
    expect(out).toMatch(/non-negotiable/);
    expect(out).not.toMatch(/emit them as batches/);
  });

  it('execute phase (seamPlanning false): only remediation principles, no planning blocks', async () => {
    const out = await adapter.render(PARTIAL, { taskBand: 'seam', seamPlanning: false, isSliceDeclaration: false });
    expect(out).toMatch(/References resolve\./);
    expect(out).not.toMatch(/emit them as batches/);
    expect(out).not.toMatch(/This is one slice\./);
  });

  it('non-seam band renders nothing', async () => {
    for (const taskBand of ['integration', 'foundation', 'platform', undefined]) {
      const out = await adapter.render(PARTIAL, { taskBand, seamPlanning: true, isSliceDeclaration: false });
      expect(out.trim()).toBe('');
    }
  });

  it('FPOP neutrality — no platform/library/framework terms', async () => {
    const out = await adapter.render(PARTIAL, { taskBand: 'seam', seamPlanning: true, isSliceDeclaration: false });
    expect(out).not.toMatch(/React|Next\.js|Tailwind|router\.push|Express|useNavigate/);
  });
});

describe('seam band — priority SSOT consistency', () => {
  it('decompose tables agree with TASK_PRIORITIES (seam 650–669, ui 670–699)', () => {
    const rules = readFileSync(join(TEMPLATES, 'rules.md'), 'utf8');
    const base = readFileSync(join(TEMPLATES, 'base.md'), 'utf8');
    const unit = readFileSync(join(TEMPLATES, 'output-unit-splitting.md'), 'utf8');

    expect(rules).toMatch(/650–669: feature \(seam/);
    expect(rules).toMatch(/670–699: ui/);
    expect(base).toMatch(/650–669: feature \(seam/);
    expect(base).toMatch(/670–699: ui/);
    expect(unit).toMatch(/670–699 range/);
    // Stale 650–699 ui range must be gone from the unit-splitting constraint.
    expect(unit).not.toMatch(/650–699 range/);
  });

  it('OrchestratorConfig.barriers carries the seam flag', () => {
    const barriers: NonNullable<OrchestratorConfig['barriers']> = { seam: true };
    expect(barriers.seam).toBe(true);
  });
});
