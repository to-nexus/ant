/**
 * Handoff revise target gate + mode-aware decompose templates.
 *
 * outer-blending-prism RCA: rev-game-art on a user-dropped handoff bundle
 * decomposed into the CANONICAL producer layout (DESIGN.md / tokens/ /
 * components/ / screens/) beside the existing `project/design/**` structure —
 * a blind duplicate. Two locks:
 *
 *  1. `validateHandoffReviseTargets` — refactor-mode targetFiles must match
 *     existing bundle paths verbatim (or opt in via `newFile: true` inside the
 *     existing directory family). The throw funnels into decompose's
 *     parseAndValidate → repairCall corrective retry.
 *  2. Template render gates — the canonical directory-family partial
 *     (`handoff-package-format`) renders ONLY in generate mode; refactor mode
 *     renders the verbatim-targetFile contract instead. Both surfaces.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'path';
import { ARTIFACT_PREFIX } from '@ant/shared';
import { validateHandoffReviseTargets } from '../../src/agents/architect/graph/design/nodes/decompose/handoffTargetGate';
import { FilePromptAdapter, initPartials } from '../../src/periphery/adapters/prompt/FilePromptAdapter';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

const bundleArtifacts = [
  'visual/game-art/handoff/README.md',
  'visual/game-art/handoff/project/design/README.md',
  'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html',
  'visual/game-art/handoff/project/design/screens/GameScreen.dc.html',
  'visual/game-art/handoff/project/uploads/prd.md',
  'plan/prd-main.md', // non-bundle pool entry — must be ignored
].map((path) => ({ path }));

function gate(tasks: Array<{ id: string; targetFile: string; newFile?: boolean }>, mode = 'refactor') {
  return () =>
    validateHandoffReviseTargets({
      tasks,
      artifacts: bundleArtifacts,
      bundlePrefix: ARTIFACT_PREFIX.GAME_ART_HANDOFF,
      mode,
      tag: '[GameArtDecompose]',
    });
}

describe('validateHandoffReviseTargets', () => {
  it('accepts targetFiles that exist in the bundle verbatim', () => {
    expect(
      gate([
        { id: 't1', targetFile: 'project/design/tokens/DesignTokens.dc.html' },
        { id: 't2', targetFile: 'README.md' },
      ]),
    ).not.toThrow();
  });

  it('rejects a canonical-layout path the bundle does not have (the observed defect)', () => {
    expect(gate([{ id: 't1', targetFile: 'tokens/colors.css' }])).toThrow(/does not exist in the bundle/);
    expect(gate([{ id: 't2', targetFile: 'DESIGN.md' }])).toThrow(/VERBATIM/);
  });

  it('accepts newFile:true inside an existing directory family (and at bundle root)', () => {
    expect(
      gate([{ id: 't1', targetFile: 'project/new-screen.html', newFile: true }]),
    ).not.toThrow();
    expect(gate([{ id: 't2', targetFile: 'CHANGELOG.md', newFile: true }])).not.toThrow();
  });

  it('rejects newFile:true in an alien directory', () => {
    expect(gate([{ id: 't1', targetFile: 'tokens/colors.css', newFile: true }])).toThrow(
      /not part of the existing bundle layout/,
    );
  });

  it('is a no-op in generate mode', () => {
    expect(gate([{ id: 't1', targetFile: 'tokens/colors.css' }], 'generate')).not.toThrow();
  });

  it('is a no-op when the pool has no view of the bundle', () => {
    expect(() =>
      validateHandoffReviseTargets({
        tasks: [{ id: 't1', targetFile: 'tokens/colors.css' }],
        artifacts: [{ path: 'plan/prd-main.md' }],
        bundlePrefix: ARTIFACT_PREFIX.GAME_ART_HANDOFF,
        mode: 'refactor',
        tag: '[GameArtDecompose]',
      }),
    ).not.toThrow();
  });

  it('works symmetrically for the UI bundle prefix', () => {
    const uiArtifacts = [{ path: 'visual/ui/handoff/site/index.html' }];
    expect(() =>
      validateHandoffReviseTargets({
        tasks: [{ id: 'u1', targetFile: 'site/index.html' }],
        artifacts: uiArtifacts,
        bundlePrefix: ARTIFACT_PREFIX.UI_HANDOFF,
        mode: 'refactor',
        tag: '[UIDecompose]',
      }),
    ).not.toThrow();
    expect(() =>
      validateHandoffReviseTargets({
        tasks: [{ id: 'u2', targetFile: 'screens/home.html' }],
        artifacts: uiArtifacts,
        bundlePrefix: ARTIFACT_PREFIX.UI_HANDOFF,
        mode: 'refactor',
        tag: '[UIDecompose]',
      }),
    ).toThrow(/does not exist in the bundle/);
  });
});

describe('decompose template mode gates (canonical family = generate-only)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  const VARIANTS = [
    'jobs/design/nodes/decompose/variants/game-art-design-by-handoff/base',
    'jobs/design/nodes/decompose/variants/ui-design-by-handoff/base',
  ];

  for (const tpl of VARIANTS) {
    it(`${tpl.includes('game-art') ? 'game-art' : 'ui'}: refactor render has NO canonical family, HAS verbatim contract`, async () => {
      const rendered = await adapter.render(tpl, {
        detectedMode: 'refactor',
        documentName: 'PRD',
        refs: [],
        context: [],
        directive: 'change colors',
        assetCount: 0,
      });
      // canonical directory-family table lives in handoff-package-format
      expect(rendered).not.toContain('Directory family');
      expect(rendered).toContain('copied VERBATIM from a manifest path');
      expect(rendered).toContain('"newFile": true');
    });

    it(`${tpl.includes('game-art') ? 'game-art' : 'ui'}: generate render HAS the canonical family`, async () => {
      const rendered = await adapter.render(tpl, {
        detectedMode: 'generate',
        documentName: 'PRD',
        refs: [],
        context: [],
        directive: 'design the game',
        assetCount: 0,
      });
      expect(rendered).toContain('Directory family');
      expect(rendered).not.toContain('copied VERBATIM from a manifest path');
    });
  }
});

describe('execute template write-strategy gate (targetExists, not job mode)', () => {
  let adapter: FilePromptAdapter;

  beforeAll(async () => {
    await initPartials(TEMPLATES_DIR);
    adapter = new FilePromptAdapter(TEMPLATES_DIR);
  });

  const VARIANTS = [
    'jobs/design/nodes/execute/variants/game-art-by-handoff/base',
    'jobs/design/nodes/execute/variants/ui-design-by-handoff/base',
  ];

  const baseVars = {
    taskName: 'Tokens',
    taskId: 't1',
    targetPath: 'visual/game-art/handoff/project/design/tokens/t.css',
    taskDescription: 'update tokens',
    detectedMode: 'refactor',
    resolvedAction: { intentDescription: 'Revise', hasExplicitFields: true, target: ['a.md'], refs: ['a.md'] },
  };

  for (const tpl of VARIANTS) {
    it(`${tpl.includes('game-art') ? 'game-art' : 'ui'}: existing file → REVISE, missing file → GENERATE (even in refactor mode)`, async () => {
      const existing = await adapter.render(tpl, { ...baseVars, targetExists: true });
      expect(existing).toContain('REVISE');
      expect(existing).not.toContain('does not exist yet. Author it in full');

      const missing = await adapter.render(tpl, { ...baseVars, targetExists: false });
      expect(missing).toContain('GENERATE');
      expect(missing).not.toContain('apply the requested change surgically');
    });
  }
});
