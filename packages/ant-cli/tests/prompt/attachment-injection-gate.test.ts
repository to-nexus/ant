/**
 * Attachment injection gate — truth table for the two template blocks that
 * carry user-attached files into a prompt.
 *
 * Renders the real templates (the detect/plan node tests mock the builder, so a
 * broken `{{#if}}` or a renamed var would pass there). Asserts the GATE — block
 * present when the var is populated, absent when it is not — plus the
 * interpolated paths, never the surrounding prose.
 *
 * See docs/internals/47-attachment-awareness.md.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = path.join(__dirname, '../../src/core/prompt/templates');
const DETECT_BASE = 'jobs/shared/nodes/detect/variants/default/base';
const PLAN_BASE = 'jobs/code/nodes/plan/base';

const DETECT_VARS = {
  intentId: 'gen-code-directive',
  domain: 'service',
  slotSummaries: [],
  whitelistPaths: ['codebase'],
  chatRequiresRefs: false,
};

const PLAN_VARS = {
  taskName: 'T', taskDescription: 'D', directive: 'x',
  taskType: 'feature', userLanguage: 'en',
};

describe('detect base — user attachments block', () => {
  let adapter: FilePromptAdapter;
  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('renders both roles with their paths when attachments are present', async () => {
    const out = await adapter.render(DETECT_BASE, {
      ...DETECT_VARS,
      attachedRefs: ['architecture/spec/report.md'],
      attachedContext: ['visual/ui/handoff/shot.png'],
    });
    expect(out).toContain('USER ATTACHMENTS — refs');
    expect(out).toContain('architecture/spec/report.md');
    expect(out).toContain('USER ATTACHMENTS — context');
    expect(out).toContain('visual/ui/handoff/shot.png');
  });

  it('renders only the populated role', async () => {
    const out = await adapter.render(DETECT_BASE, {
      ...DETECT_VARS,
      attachedRefs: [],
      attachedContext: ['visual/ui/handoff/shot.png'],
    });
    expect(out).not.toContain('USER ATTACHMENTS — refs');
    expect(out).toContain('USER ATTACHMENTS — context');
  });

  it('is absent when nothing was attached', async () => {
    const out = await adapter.render(DETECT_BASE, {
      ...DETECT_VARS,
      attachedRefs: [],
      attachedContext: [],
    });
    expect(out).not.toContain('USER ATTACHMENTS');
  });
});

describe('plan base — placeable-file inventory block', () => {
  let adapter: FilePromptAdapter;
  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  it('renders the inventory and the implementation.assets contract', async () => {
    const out = await adapter.render(PLAN_BASE, {
      ...PLAN_VARS,
      assetInventoryBlock:
        '## Asset Files (real files on disk)\n- visual: visual/ui/handoff/shot.png (4.0 KB)',
    });
    expect(out).toContain('visual/ui/handoff/shot.png');
    // `plan/rules.md` requires sourcing `implementation.assets[].source` from an
    // inventory the plan node never used to receive.
    expect(out).toContain('implementation.assets');
  });

  it('is absent when there are no placeable files', async () => {
    const out = await adapter.render(PLAN_BASE, PLAN_VARS);
    expect(out).not.toContain('implementation.assets');
  });
});
