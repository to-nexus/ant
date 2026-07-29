/**
 * Completion-signal convergence for tool-write (REVISE) design tasks.
 *
 * outer-blending-prism RCA: handoff REVISE tasks write via edit_file /
 * create_file, but the execute node counted ONLY XML `<file>` registry writes
 * — `_taskFilesWritten` stayed 0, `hasNewFileOutput` never went true, the
 * no-output streak never reset, and the task looped re-reading its own output
 * until the user stopped it. Locks:
 *
 *  1. `countArtifactToolWrites` — successful artifact write sideEffects count;
 *     `fileNotChanged`, codebase paths, and plan-phase batches do not.
 *  2. `computeNextNoOutputCount` — a tool-write turn (hasNewFileOutput via the
 *     tool channel) resets the streak.
 *  3. Every design execute variant's rules.md carries the `<done>true</done>`
 *     completion contract (the two handoff variants were the only ones
 *     without one — the class of bug this sweep locks shut).
 *  4. `buildGameArtFreshPrompt` / `buildUiDesignFreshPrompt` select by the
 *     task's `include` set — continuation rounds keep the handoff bundle
 *     stubs (the old hard-coded `[SOURCES]` yielded `sourceDocs: 0`).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { countArtifactToolWrites } from '../../src/agents/architect/graph/design/nodes/tool/index';
import { computeNextNoOutputCount } from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';
import { applyDrainFinalization } from '../../src/agents/architect/graph/design/nodes/execute/drainFinalize';
import { buildGameArtFreshPrompt } from '../../src/agents/architect/graph/design/nodes/execute/intent/game-art';
import { buildUiDesignFreshPrompt } from '../../src/agents/architect/graph/design/nodes/execute/intent/ui';

const TEMPLATES_DIR = join(__dirname, '../../src/core/prompt/templates');

describe('countArtifactToolWrites', () => {
  const ev = (sideEffects: any[]) => ({ result: { sideEffects } });

  it('counts successful artifact writes only', () => {
    const events = [
      ev([{ type: 'fileModified', path: 'visual/ui/handoff/screens/home.html' }]),
      ev([{ type: 'fileNotChanged', path: 'visual/ui/handoff/screens/home.html' }]),
      ev([{ type: 'fileCreated', path: 'codebase/src/x.ts' }]),
      ev([]),
    ];
    expect(countArtifactToolWrites('execute', events)).toBe(1);
  });

  it('never counts plan-phase batches', () => {
    const events = [ev([{ type: 'fileModified', path: 'visual/ui/handoff/a.css' }])];
    expect(countArtifactToolWrites('plan', events)).toBe(0);
  });

  it('counts deletes and multiple writes across events', () => {
    const events = [
      ev([{ type: 'fileCreated', path: 'visual/game-art/handoff/tokens/colors.css' }]),
      ev([{ type: 'fileDeleted', path: 'visual/game-art/handoff/old.css' }]),
    ];
    expect(countArtifactToolWrites(undefined, events)).toBe(2);
  });
});

describe('computeNextNoOutputCount with the tool-write channel', () => {
  it('a tool-write turn resets the streak (hasNewFileOutput true, even with tool calls)', () => {
    expect(
      computeNextNoOutputCount(7, { hasNewFileOutput: true, hasToolCallsOnly: false, drainFinalizing: false }),
    ).toBe(0);
  });

  it('a read-only tool turn still increments', () => {
    expect(
      computeNextNoOutputCount(7, { hasNewFileOutput: false, hasToolCallsOnly: true, drainFinalizing: false }),
    ).toBe(8);
  });
});

describe('drain finalization keeps write tools (REVISE exit path)', () => {
  it('strips exploration tools but keeps edit_file/create_file', () => {
    const tools = [
      { name: 'read_file' },
      { name: 'search_code' },
      { name: 'edit_file' },
      { name: 'create_file' },
      { name: 'list_files' },
    ];
    const messages = [{ role: 'user', content: 'Continue.' }];
    const { tools: drained, drainFinalizing } = applyDrainFinalization(
      { recursionCount: 0, recursionLimit: 0, _noOutputCallCount: 999 } as any,
      messages as any,
      tools as any,
    );
    expect(drainFinalizing).toBe(true);
    expect(drained.map((t: any) => t.name).sort()).toEqual(['create_file', 'edit_file']);
    // note mentions the edit_file path, not just <file> regeneration
    const appended = JSON.stringify(messages);
    expect(appended).toContain('edit_file');
  });

  it('does NOT keep mkdir — a sideEffect-less tool can never satisfy the drain exit (oat-judging-mound RCA)', () => {
    const tools = [
      { name: 'read_file' },
      { name: 'edit_file' },
      { name: 'delete_file' },
      { name: 'mkdir' },
    ];
    const messages = [{ role: 'user', content: 'Continue.' }];
    const { tools: drained, drainFinalizing } = applyDrainFinalization(
      { recursionCount: 0, recursionLimit: 0, _noOutputCallCount: 999 } as any,
      messages as any,
      tools as any,
    );
    expect(drainFinalizing).toBe(true);
    expect(drained.map((t: any) => t.name).sort()).toEqual(['delete_file', 'edit_file']);
  });

  it('forbids ALL calls when the target does not exist yet — toolChoice=none, declarations kept (sharp-baking-bride + sage-causing-rover RCAs)', () => {
    const tools = [
      { name: 'read_file' },
      { name: 'edit_file' },
      { name: 'create_file' },
    ];
    const messages = [{ role: 'user', content: 'Continue.' }];
    const { tools: drained, toolChoice } = applyDrainFinalization(
      { recursionCount: 0, recursionLimit: 0, _noOutputCallCount: 999 } as any,
      messages as any,
      tools as any,
      { targetExists: false },
    );
    // sharp-baking-bride's requirement was "no tool CALL can happen" (a
    // surviving edit_file out-competes the <file> tag and can never succeed
    // against a missing file). That is now enforced by the provider-level
    // constraint; the DECLARATIONS stay so the tool_calls-laden history stays
    // self-consistent (deleting them is the GLM degeneration trigger).
    expect(drained).toBe(tools);
    expect(toolChoice).toBe('none');
  });
});

describe('design tool registry — create_file is handled (unadvertised)', () => {
  it('createDesignToolHandlers maps create_file so the shared edit_file missing-file guidance is actionable', async () => {
    const { createDesignToolHandlers } = await import(
      '../../src/agents/architect/graph/design/nodes/tool/designToolAdapters'
    );
    const handlers = createDesignToolHandlers();
    expect(handlers.has('create_file')).toBe(true);
    expect(handlers.has('write_file')).toBe(true); // existing shadow-alias stays
  });
});

describe('done-contract presence sweep (all design execute variants)', () => {
  const variantsDir = join(TEMPLATES_DIR, 'jobs/design/nodes/execute/variants');
  // explain-only is chat-only by contract (no file artifact, the reply IS the
  // completion) — the <done> tag has no meaning there.
  const EXEMPT = new Set(['explain-only']);
  const variants = fs
    .readdirSync(variantsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !EXEMPT.has(name) && fs.existsSync(join(variantsDir, name, 'rules.md')));

  it('finds the expected variants', () => {
    expect(variants).toContain('game-art-by-handoff');
    expect(variants).toContain('ui-design-by-handoff');
  });

  for (const name of variants) {
    it(`${name}/rules.md declares <done>true</done>`, () => {
      const rules = fs.readFileSync(join(variantsDir, name, 'rules.md'), 'utf-8');
      expect(rules).toContain('<done>true</done>');
    });
  }
});

describe('freshPrompt keeps the task include set (handoff bundle stubs survive continuation)', () => {
  const pool = [
    { path: 'plan/prd-main.md', content: 'PRD BODY', role: 'ref' },
    { path: 'visual/game-art/handoff/project/design/README.md', content: '[reference file] stub', role: 'ref' },
    { path: 'visual/ui/handoff/site/index.html', content: '[reference file] ui stub', role: 'ref' },
  ];

  const mkState = (task: any): any => ({
    currentTask: task,
    artifacts: pool,
    conversations: {},
    context: { featurePath: undefined, userLanguage: 'en' },
    resolvedAction: { intent: task.id.startsWith('ui-') ? 'rev-ui' : 'rev-game-art', mode: 'refactor' },
    deps: {
      promptBuilder: {
        render: async () => 'SYSTEM PROMPT',
        buildGameArtTierBasis: async () => '',
        buildVisualTierBasis: async () => '',
      },
    },
  });

  const textOf = (blocks: Array<{ text?: string }>) =>
    blocks.map((b) => b.text || '').join('\n');

  it('game-art: include-selected handoff stub appears in continuation blocks', async () => {
    const state = mkState({
      id: 'game-art-handoff-tokens',
      targetFile: 'project/design/tokens/t.css',
      docFormat: 'handoff',
      targetDir: 'visual/game-art/handoff',
      include: ['plan/', 'visual/game-art/handoff/'],
    });
    const blocks = await buildGameArtFreshPrompt(state);
    const text = textOf(blocks as any);
    expect(text).toContain('visual/game-art/handoff/project/design/README.md');
    expect(text).toContain('plan/prd-main.md');
    expect(text).not.toContain('visual/ui/handoff/site/index.html');
  });

  it('ui: include-selected handoff stub appears in continuation blocks', async () => {
    const state = mkState({
      id: 'ui-handoff-screen-home',
      targetFile: 'site/index.html',
      docFormat: 'handoff',
      targetDir: 'visual/ui/handoff',
      include: ['plan/', 'visual/ui/handoff/'],
    });
    const blocks = await buildUiDesignFreshPrompt(state);
    const text = textOf(blocks as any);
    expect(text).toContain('visual/ui/handoff/site/index.html');
    expect(text).not.toContain('visual/game-art/handoff/project/design/README.md');
  });

  it('falls back to SOURCES when the task has no include set', async () => {
    const state = mkState({
      id: 'game-art-tokens',
      targetFile: 'game-art-tokens.json',
    });
    const blocks = await buildGameArtFreshPrompt(state);
    const text = textOf(blocks as any);
    expect(text).toContain('plan/prd-main.md');
    expect(text).not.toContain('visual/game-art/handoff/project/design/README.md');
  });
});
