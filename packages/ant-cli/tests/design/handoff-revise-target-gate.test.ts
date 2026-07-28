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
import { validateHandoffReviseTargets, isGuideDoc } from '../../src/agents/architect/graph/design/nodes/decompose/handoffTargetGate';
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

function gate(tasks: Array<{ id: string; targetFile: string; newFile?: boolean; removeFiles?: string[] }>, mode = 'refactor') {
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

  it('normalizes full workspace-relative targetFiles by stripping the bundle prefix in place', () => {
    const tasks = [
      { id: 't1', targetFile: 'visual/game-art/handoff/project/design/tokens/DesignTokens.dc.html' },
      { id: 't2', targetFile: 'visual/game-art/handoff/README.md' },
    ];
    expect(gate(tasks)).not.toThrow();
    // In-place strip — the same task objects flow into the taskQueue, so
    // execute's `targetDir + targetFile` join must see bundle-relative paths.
    expect(tasks[0].targetFile).toBe('project/design/tokens/DesignTokens.dc.html');
    expect(tasks[1].targetFile).toBe('README.md');
  });

  it('still rejects a full-path targetFile whose bundle-relative form does not exist', () => {
    expect(
      gate([{ id: 't1', targetFile: 'visual/game-art/handoff/tokens/colors.css' }]),
    ).toThrow(/does not exist in the bundle/);
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

  it('accepts merge-then-delete: root README survives, design/README removed (the incident fix)', () => {
    const tasks = [
      { id: 't1', targetFile: 'README.md', removeFiles: ['project/design/README.md'] },
    ];
    expect(gate(tasks)).not.toThrow();
  });

  it('normalizes full workspace-relative removeFiles by stripping the bundle prefix in place', () => {
    const tasks = [
      { id: 't1', targetFile: 'README.md', removeFiles: ['visual/game-art/handoff/project/design/README.md'] },
    ];
    expect(gate(tasks)).not.toThrow();
    expect(tasks[0].removeFiles![0]).toBe('project/design/README.md');
  });

  it('rejects a removeFiles entry that does not exist in the bundle', () => {
    expect(
      gate([{ id: 't1', targetFile: 'README.md', removeFiles: ['project/design/GHOST.md'] }]),
    ).toThrow(/removeFiles entry .* does not exist in the bundle/);
  });

  it('rejects a task that lists its own targetFile in removeFiles', () => {
    expect(
      gate([{ id: 't1', targetFile: 'README.md', removeFiles: ['README.md'] }]),
    ).toThrow(/lists its own targetFile/);
  });

  it('rejects a newFile guide beside the existing entry doc(s)', () => {
    expect(
      gate([{ id: 't1', targetFile: 'project/design/INDEX.md', newFile: true }]),
    ).toThrow(/second guide/);
  });

  it('unconventional newFile names are NOT treated as guides (stem match is exact)', () => {
    expect(
      gate([{ id: 't1', targetFile: 'project/design/STYLE-NOTES.md', newFile: true }]),
    ).not.toThrow();
  });

  it('allows a newFile guide when the bundle has no recognizable guide (fail-open)', () => {
    expect(() =>
      validateHandoffReviseTargets({
        tasks: [{ id: 't1', targetFile: 'README.md', newFile: true }],
        artifacts: [{ path: 'visual/game-art/handoff/tokens/palette.css' }],
        bundlePrefix: ARTIFACT_PREFIX.GAME_ART_HANDOFF,
        mode: 'refactor',
        tag: '[GameArtDecompose]',
      }),
    ).not.toThrow();
  });

  it('rejects a decomposition that removes every guide doc without a surviving entry-doc task', () => {
    expect(
      gate([
        {
          id: 't1',
          targetFile: 'project/design/tokens/DesignTokens.dc.html',
          removeFiles: ['README.md', 'project/design/README.md'],
        },
      ]),
    ).toThrow(/exactly one structure guide must remain/);
  });

  it('accepts removing one of two guides while the other survives as a task target', () => {
    expect(
      gate([
        { id: 't1', targetFile: 'README.md', removeFiles: ['project/design/README.md'] },
        { id: 't2', targetFile: 'project/design/tokens/DesignTokens.dc.html' },
      ]),
    ).not.toThrow();
  });

  it('isGuideDoc matches .md guide stems only — dc.html specimens never count', () => {
    expect(isGuideDoc('README.md')).toBe(true);
    expect(isGuideDoc('project/design/README.md')).toBe(true);
    expect(isGuideDoc('DESIGN.md')).toBe(true);
    expect(isGuideDoc('project/design/tokens/DesignTokens.dc.html')).toBe(false);
    expect(isGuideDoc('screens/index.html')).toBe(false);
    expect(isGuideDoc('notes.md')).toBe(false);
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
      expect(rendered).toContain('prefix stripped — bundle-relative');
      expect(rendered).toContain('"newFile": true');
      // Structural-revision discipline (handoff-bundle-revision partial):
      // entry-doc singularity + merge-then-delete emission rule.
      expect(rendered).toContain('ONE structure-describing guide');
      expect(rendered).toContain('"removeFiles"');
      expect(rendered).not.toContain('There is no separate README');
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
      expect(rendered).not.toContain('prefix stripped — bundle-relative');
      expect(rendered).not.toContain('ONE structure-describing guide');
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

    it(`${tpl.includes('game-art') ? 'game-art' : 'ui'}: refactor render swaps package-format for the revision discipline`, async () => {
      const refactor = await adapter.render(tpl, { ...baseVars, targetExists: true });
      // The in-prompt contradiction from the incident: a README targetPath
      // alongside "There is no separate README" must be impossible.
      expect(refactor).not.toContain('There is no separate README');
      expect(refactor).toContain('ONE structure-describing guide');

      const generate = await adapter.render(tpl, { ...baseVars, detectedMode: 'generate', targetExists: false });
      expect(generate).toContain('There is no separate README');
      expect(generate).not.toContain('ONE structure-describing guide');
    });

    it(`${tpl.includes('game-art') ? 'game-art' : 'ui'}: removeFilePaths renders the Structural removals block (and only then)`, async () => {
      const withRemovals = await adapter.render(tpl, {
        ...baseVars,
        targetExists: true,
        removeFilePaths: ['visual/game-art/handoff/project/design/README.md'],
      });
      expect(withRemovals).toContain('Structural removals');
      expect(withRemovals).toContain('visual/game-art/handoff/project/design/README.md');
      expect(withRemovals).toContain('delete_file');

      const without = await adapter.render(tpl, { ...baseVars, targetExists: true });
      expect(without).not.toContain('Structural removals');
    });
  }
});
