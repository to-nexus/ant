/**
 * One output contract per execute prompt (suppressJobTarget).
 *
 * outer-blending-prism RCA: the shared `action-context` partial rendered the
 * job-level `resolvedAction.target` (== the selected refs under the revise
 * contract) as a per-turn "Write ONLY to the following path(s)" whitelist,
 * directly contradicting the design execute variant's per-task
 * `targetPath` — the worker visibly stalled reasoning about the conflict.
 *
 * Locks:
 *  1. Design ui/game-art execute variants suppress the job-level Output
 *     Target block (their Target-file line is the sole write contract).
 *  2. The partial WITHOUT the flag renders byte-compatible output — the
 *     Output Target block stays for code/plan/design-plan/spec consumers.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

let adapter: FilePromptAdapter;
beforeAll(async () => {
  await initPartials(TEMPLATES_DIR);
  adapter = new FilePromptAdapter(TEMPLATES_DIR);
});

const explicitRA = {
  intentDescription: 'Revise existing game-art design documents',
  hasExplicitFields: true,
  target: ['visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html'],
  refs: ['visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html'],
};

describe('unflagged consumers keep the job-level Output Target (regression guard)', () => {
  it('bare action-context renders the Output Target for explicit RACs', async () => {
    const rendered = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: explicitRA,
    });
    expect(rendered).toContain('## Output Target');
    expect(rendered).toContain('Write ONLY to the following path(s) this turn');
    expect(rendered).toContain('DesignTokens.dc.html');
  });

  it('suppressJobTarget=true removes ONLY the Output Target block', async () => {
    const rendered = await adapter.render('jobs/shared/injections/action-context', {
      resolvedAction: explicitRA,
      suppressJobTarget: true,
    });
    expect(rendered).not.toContain('## Output Target');
    // the rest of the partial still renders
    expect(rendered).toContain('User Action Specification');
    expect(rendered).toContain('explicitly selected as `ref` inputs');
  });
});

describe('every design ui/game-art execute variant opts out of the job-level target', () => {
  const variantsDir = join(TEMPLATES_DIR, 'jobs/design/nodes/execute/variants');
  const SURFACE_VARIANTS = [
    'ui-design-by-desc',
    'ui-design-by-figma',
    'ui-design-by-handoff',
    'game-art-by-desc',
    'game-art-by-figma',
    'game-art-by-handoff',
  ];

  for (const name of SURFACE_VARIANTS) {
    it(`${name}/base.md passes suppressJobTarget=true`, () => {
      const base = fs.readFileSync(join(variantsDir, name, 'base.md'), 'utf-8');
      expect(base).toContain('{{> jobs/shared/injections/action-context suppressJobTarget=true}}');
    });
  }

  it('handoff variants render no job-level Output Target end-to-end', async () => {
    for (const tpl of [
      'jobs/design/nodes/execute/variants/game-art-by-handoff/base',
      'jobs/design/nodes/execute/variants/ui-design-by-handoff/base',
    ]) {
      const rendered = await adapter.render(tpl, {
        taskName: 'Tokens',
        taskId: 't1',
        targetPath: 'visual/game-art/handoff/project/design/tokens/t.css',
        taskDescription: 'update tokens',
        targetExists: true,
        resolvedAction: explicitRA,
      });
      expect(rendered).not.toContain('## Output Target');
      // per-task contract is present and exclusive
      expect(rendered).toContain('write ONLY to this path this task');
    }
  });
});
