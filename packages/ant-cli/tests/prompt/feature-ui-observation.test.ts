/**
 * Axis C (RCA: third-housing-forge) — a renderable `feature` task observes the
 * UI source for AFFORDANCES (not styling), so design-only affordances (a
 * cross-app link, a popup, a secondary action present in the handoff but absent
 * from the PRD) are built + wired by the feature, not left inert for the ui task.
 *
 * The styling `uiSource` discriminator is per-task narrowed (null for a feature
 * whose `include` omits the UI body); these vars are computed from the JOB pool
 * so the affordance-observation partial can fire without pre-loading the body,
 * and are kept SEPARATE from `uiSource` so a feature never trips the design-system
 * styling-inventory branches.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { featureUiObservationVars } from '../../src/agents/architect/graph/code/tasks/_shared/helpers/featureUiObservation';
import type { CodeTask } from '../../src/agents/architect/graph/code/types/task';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const PARTIAL = 'jobs/code/base/injections/feature-ui-observation';

const handoffArtifact = { path: 'visual/ui/handoff/home.html', role: 'context', content: '<div/>' } as any;
const prdArtifact = { path: 'plan/prd-main.md', role: 'ref', content: '# PRD' } as any;

const mkTask = (over: Partial<CodeTask>): CodeTask =>
  ({ id: 't', name: 'n', type: 'feature', description: '', priority: 250, ...over } as CodeTask);

describe('featureUiObservationVars — job-pool affordance signal', () => {
  it('renderable feature + UI source in job pool → observes (source surfaced)', () => {
    const v = featureUiObservationVars([handoffArtifact, prdArtifact], mkTask({ type: 'feature', renderable: true } as any));
    expect(v.featureObservesUiSource).toBe(true);
    expect(v.featureUiSource).toBe('handoff');
  });

  it('non-renderable feature → inert even with a UI source present', () => {
    const v = featureUiObservationVars([handoffArtifact, prdArtifact], mkTask({ type: 'feature' }));
    expect(v.featureObservesUiSource).toBe(false);
    expect(v.featureUiSource).toBeNull();
  });

  it('renderable feature + NO UI source in pool → inert', () => {
    const v = featureUiObservationVars([prdArtifact], mkTask({ type: 'feature', renderable: true } as any));
    expect(v.featureObservesUiSource).toBe(false);
    expect(v.featureUiSource).toBeNull();
  });

  it('ui task is not the owner of this signal (feature-only)', () => {
    const v = featureUiObservationVars([handoffArtifact], mkTask({ type: 'ui', renderable: true } as any));
    expect(v.featureObservesUiSource).toBe(false);
  });
});

describe('feature-ui-observation partial — affordance ownership, not styling', () => {
  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
  });
  const adapter = new FilePromptAdapter(TEMPLATES_DIR);

  it('renders affordance-build guidance when featureObservesUiSource', async () => {
    const out = await adapter.render(PARTIAL, { featureObservesUiSource: true });
    expect(out).toMatch(/Observe the UI Source for Affordances/i);
    // builds + wires affordances the requirements omit but the design implies
    expect(out).toMatch(/requirements[^.]*do NOT enumerate but the design implies/i);
    expect(out).toMatch(/build\s+and wire/i);
    // explicitly NOT styling — paired ui task owns visual
    expect(out).toMatch(/do NOT apply visual styling tokens/i);
    expect(out).toMatch(/Headless.* means unstyled, NOT affordance-blind/i);
  });

  it('renders nothing when the gate is false (non-renderable / no source)', async () => {
    const out = await adapter.render(PARTIAL, { featureObservesUiSource: false });
    expect(out.trim()).toBe('');
  });
});
