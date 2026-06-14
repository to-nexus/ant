/**
 * decompose priority band guide — single-source render guard.
 *
 * The priority band table is rendered from the `TASK_PRIORITY` window map (the
 * numeric SSOT) by `renderPriorityBandGuide()` and injected into
 * `templates/jobs/code/nodes/decompose/variants/default/base.md` via the
 * `{{{priorityBandGuide}}}` variable. There is exactly ONE canonical band model
 * for every code intent — the former `gen-code-spec` free-priority mode
 * (`isPriorityFromSpec`) has been removed.
 *
 * This locks:
 *   1. The rendered guide carries every (type, band) window, sourced from the
 *      map (so a hand-copied table cannot drift).
 *   2. base.md actually interpolates the guide (wiring intact).
 *   3. No free-priority / isPriorityFromSpec residue remains in the template.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  FilePromptAdapter,
  initPartials,
} from '../../src/periphery/adapters/prompt/FilePromptAdapter';
import { renderPriorityBandGuide } from '../../src/agents/architect/graph/code/state.priorityGuide';
import { windowFor } from '../../src/agents/architect/graph/code/state';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');
const BASE_MD = join(
  TEMPLATES_DIR,
  'jobs/code/nodes/decompose/variants/default/base.md',
);

const BASE_VARS: Record<string, any> = {
  directive: 'Build a service',
  currentTask: undefined,
  resolvedAction: undefined,
  techTier: { language: 'typescript', stack: 'backend' },
  hasExistingCode: false,
  codebaseFilePaths: [],
  fileList: '',
  hasDocuments: false,
  documents: [],
  hasUi: false,
  uiSource: undefined,
  priorityBandGuide: renderPriorityBandGuide(),
};

describe('renderPriorityBandGuide — rendered from TASK_PRIORITY (single SSOT)', () => {
  it('carries every (type, band) window, numbers sourced from the map', () => {
    const guide = renderPriorityBandGuide();
    const { min: setupRoot } = windowFor('setup', 'root');
    expect(guide).toContain(`- ${setupRoot}: setup (root`);
    expect(guide).toMatch(/200–219: design-system/);
    expect(guide).toMatch(/220–259: feature \(foundation band/);
    expect(guide).toMatch(/260–299: feature \(platform band/);
    expect(guide).toMatch(/300–599: feature \(ordinary\)/);
    expect(guide).toMatch(/600–649: feature \(integration/);
    expect(guide).toMatch(/650–749: ui/);
    expect(guide).toMatch(/750–799: seam/);
    expect(guide).toMatch(/800–849: test-code/);
    expect(guide).toMatch(/850–899: doc/);
    expect(guide).toMatch(/900–999: error/);
    expect(guide).toMatch(/1000: verification/);
  });

  it('ranges agree with windowFor (no hand-copied numbers)', () => {
    const guide = renderPriorityBandGuide();
    const w = windowFor('feature', 'integration');
    expect(guide).toContain(`- ${w.min}–${w.max}: feature (integration`);
  });
});

describe('decompose base.md — priority band guide wiring', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('interpolates {{{priorityBandGuide}}} and renders the canonical bands', async () => {
    const out = await adapter.render(
      'jobs/code/nodes/decompose/variants/default/base',
      BASE_VARS,
    );
    expect(out).toMatch(/220–259: feature \(foundation band/);
    expect(out).toMatch(/1000: verification/);
  });

  it('no free-priority / isPriorityFromSpec residue in the template source', () => {
    const base = readFileSync(BASE_MD, 'utf8');
    const rules = readFileSync(
      join(
        TEMPLATES_DIR,
        'jobs/code/nodes/decompose/variants/default/rules.md',
      ),
      'utf8',
    );
    expect(base).toContain('{{{priorityBandGuide}}}');
    expect(base).not.toMatch(/isPriorityFromSpec/);
    expect(rules).not.toMatch(/isPriorityFromSpec/);
    expect(rules).not.toMatch(/Free integer in 1\.\.999/);
    // The hand-copied band table is gone from base.md (replaced by the var).
    expect(base).not.toMatch(/300=critical, 350=important/);
  });
});
