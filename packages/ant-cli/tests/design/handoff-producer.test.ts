/**
 * Handoff producer regression guards.
 *
 * Locks the Claude-Design-style handoff bundle pipeline:
 *  1. Output-format resolver truth table (single owner —
 *     design/_shared/outputFormat.ts).
 *  2. Matrix repoint: gen-ui-desc / gen-game-art-desc emit the handoff bundle;
 *     the figma pipeline still emits the ant-canonical JSON trio.
 *  3. isAssetTask must NOT fire on handoff task ids (`ui-handoff-*`).
 *  4. produce ↔ consume format SSOT: producer templates and the code-job
 *     handoff readers both reference the shared package-format partial /
 *     its DESIGN.md manifest convention.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { resolveDesignOutputFormat } from '../../src/agents/architect/graph/design/_shared/outputFormat';
import { isAssetTask } from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/assetValidation';
import {
  bundleStageOf,
  coherenceChecksForStage,
  isHandoffBundleTask,
} from '../../src/agents/architect/graph/design/nodes/checkTaskStatus/bundleCoherence';
import { getConfigSlots, formatOutputSpec } from '@ant/shared';

const TEMPLATES = path.resolve(__dirname, '../../src/core/prompt/templates');

function ra(intent: string) {
  return { intent } as any;
}
const HANDOFF_UI_POOL = [{ path: 'visual/ui/handoff/DESIGN.md', content: '', role: 'ref' }] as any;
const ANT_UI_POOL = [{ path: 'visual/ui/ant/ui-spec.json', content: '{}', role: 'ref' }] as any;
const HANDOFF_GA_POOL = [{ path: 'visual/game-art/handoff/DESIGN.md', content: '', role: 'ref' }] as any;
const ANT_GA_POOL = [{ path: 'visual/game-art/ant/game-art-spec.json', content: '{}', role: 'ref' }] as any;

describe('resolveDesignOutputFormat (single owner)', () => {
  it('gen-*-desc generates the handoff bundle', () => {
    expect(resolveDesignOutputFormat({ resolvedAction: ra('gen-ui-desc'), artifacts: [] }, 'ui')).toBe('handoff');
    expect(resolveDesignOutputFormat({ resolvedAction: ra('gen-game-art-desc'), artifacts: [] }, 'game-art')).toBe('handoff');
  });

  it('figma pipeline stays on the ant JSON trio', () => {
    expect(resolveDesignOutputFormat({ resolvedAction: ra('gen-ui-figma'), artifacts: [] }, 'ui')).toBe('json');
    expect(resolveDesignOutputFormat({ resolvedAction: ra('gen-game-art-figma'), artifacts: [] }, 'game-art')).toBe('json');
  });

  it('rev-* follows the selected source', () => {
    expect(resolveDesignOutputFormat({ resolvedAction: ra('rev-ui'), artifacts: HANDOFF_UI_POOL }, 'ui')).toBe('handoff');
    expect(resolveDesignOutputFormat({ resolvedAction: ra('rev-ui'), artifacts: ANT_UI_POOL }, 'ui')).toBe('json');
    expect(resolveDesignOutputFormat({ resolvedAction: ra('rev-game-art'), artifacts: HANDOFF_GA_POOL }, 'game-art')).toBe('handoff');
    expect(resolveDesignOutputFormat({ resolvedAction: ra('rev-game-art'), artifacts: ANT_GA_POOL }, 'game-art')).toBe('json');
  });
});

describe('matrix repoint (gen-*-desc → handoff producer)', () => {
  it('gen-ui-desc targets visual/ui/handoff with a DESIGN.md-anchored output set', () => {
    const target = getConfigSlots('gen-ui-desc')!.target;
    expect(target.kind).toBe('generate');
    if (target.kind !== 'generate') return;
    expect(target.dir).toBe('visual/ui/handoff');
    const formatted = target.outputs.map(formatOutputSpec);
    expect(formatted).toContain('DESIGN.md');
    expect(formatted).toContain('screens/*.html');
    expect(formatted).not.toContain('ui-tokens.json');
  });

  it('gen-game-art-desc targets visual/game-art/handoff with the entities ring', () => {
    const target = getConfigSlots('gen-game-art-desc')!.target;
    expect(target.kind).toBe('generate');
    if (target.kind !== 'generate') return;
    expect(target.dir).toBe('visual/game-art/handoff');
    const formatted = target.outputs.map(formatOutputSpec);
    expect(formatted).toContain('DESIGN.md');
    expect(formatted).toContain('entities/*.html');
  });

  it('gen-*-figma keeps the ant-canonical JSON trio (regression)', () => {
    const ui = getConfigSlots('gen-ui-figma')!.target;
    expect(ui.kind).toBe('generate');
    if (ui.kind !== 'generate') return;
    expect(ui.dir).toBe('visual/ui/ant');
    expect(ui.outputs.map(formatOutputSpec)).toEqual(['ui-tokens.json', 'ui-assets.json', 'ui-spec.json']);
  });
});

describe('isAssetTask handoff exclusion', () => {
  it('does not fire on handoff task ids', () => {
    expect(isAssetTask('ui-handoff-assets')).toBe(false);
    expect(isAssetTask('ui-handoff-design-md')).toBe(false);
    expect(isAssetTask('game-art-handoff-assets')).toBe(false);
    // Legacy behavior preserved
    expect(isAssetTask('ui-assets-ch1')).toBe(true);
    expect(isAssetTask('game-art-assets-ch1')).toBe(true);
  });
});

describe('produce ↔ consume format SSOT', () => {
  const read = (rel: string) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf8');

  it('shared package-format partial exists and defines the family', () => {
    const ssot = read('jobs/shared/injections/handoff-package-format.md');
    for (const anchor of ['DESIGN.md', 'styles.css', 'tokens/', 'components/', 'screens/', 'entities/', 'Artifacts']) {
      expect(ssot).toContain(anchor);
    }
  });

  it('producer templates reference the shared partial', () => {
    for (const rel of [
      'jobs/design/nodes/decompose/variants/ui-design-by-handoff/base.md',
      'jobs/design/nodes/decompose/variants/game-art-design-by-handoff/base.md',
      'jobs/design/nodes/execute/variants/ui-design-by-handoff/rules.md',
      'jobs/design/nodes/execute/variants/game-art-by-handoff/rules.md',
    ]) {
      expect(read(rel)).toContain('jobs/shared/injections/handoff-package-format');
    }
  });

  it('handoff readers pick up DESIGN.md (design stem + manifest fast path)', () => {
    for (const rel of [
      'jobs/code/base/injections/ui-source-handoff.md',
      'jobs/code/base/injections/game-art-source-handoff.md',
    ]) {
      const reader = read(rel);
      expect(reader).toContain('`design`');
      expect(reader).toContain('Artifacts');
    }
  });

  it('producer task-id prefixes avoid the asset-validation prefixes', () => {
    const uiRules = read('jobs/design/nodes/decompose/variants/ui-design-by-handoff/rules.md');
    const gaRules = read('jobs/design/nodes/decompose/variants/game-art-design-by-handoff/rules.md');
    expect(uiRules).toContain('ui-handoff-');
    expect(gaRules).toContain('game-art-handoff-');
    expect(uiRules).toContain('NEVER use ids starting with `ui-assets-`');
  });
});

/**
 * Name binding — a handoff bundle's shared layers own two cross-file NAME apis
 * (token identifiers, component class names), and a missed binding produces an
 * unstyled shell with no error signal. These lock the contract's wiring, not its
 * wording: which partial is included where, and which stage owns which file kind.
 */
describe('name-binding contract wiring', () => {
  const read = (rel: string) => fs.readFileSync(path.join(TEMPLATES, rel), 'utf8');

  const EXECUTE_RULES = [
    'jobs/design/nodes/execute/variants/ui-design-by-handoff/rules.md',
    'jobs/design/nodes/execute/variants/game-art-by-handoff/rules.md',
  ];
  const DECOMPOSE_RULES = [
    'jobs/design/nodes/decompose/variants/ui-design-by-handoff/rules.md',
    'jobs/design/nodes/decompose/variants/game-art-design-by-handoff/rules.md',
  ];

  it('the acquisition partial exists and names its three mechanisms', () => {
    const partial = read('jobs/shared/injections/handoff-name-binding.md');
    for (const anchor of ['read_file', 'list_files', 'var(']) {
      expect(partial).toContain(anchor);
    }
  });

  it.each(EXECUTE_RULES)('%s includes the partial OUTSIDE the mode gate', rel => {
    const body = read(rel);
    const include = body.indexOf('jobs/shared/injections/handoff-name-binding');
    expect(include).toBeGreaterThan(-1);
    // Placement is load-bearing: a refactor task editing a screen needs token
    // names too, so the include must follow the mode block's closing {{/if}}.
    expect(include).toBeGreaterThan(body.indexOf('{{/if}}'));
  });

  it.each(EXECUTE_RULES)('%s no longer makes the guide a token-naming authority', rel => {
    expect(read(rel)).not.toContain('State token names');
  });

  it.each(DECOMPOSE_RULES)('%s puts specimen pages in the consumer stage', rel => {
    const body = read(rel);
    const consumerRow = body.split('\n').find(l => l.includes('300–349'));
    expect(consumerRow).toBeDefined();
    expect(consumerRow!).toContain('specimen');
  });

  it('game-art additionally routes entity specimens to the consumer stage', () => {
    const row = read(DECOMPOSE_RULES[1]).split('\n').find(l => l.includes('300–349'))!;
    expect(row).toContain('entity');
  });

  it.each(DECOMPOSE_RULES)('%s carries the ownership-closure rule', rel => {
    expect(read(rel)).toContain('Class-ownership closure');
  });

  it('the shape SSOT single-owns both invariants and the 4-level chain', () => {
    const ssot = read('jobs/shared/injections/handoff-package-format.md');
    expect(ssot).toContain('Name ownership');
    expect(ssot).toContain('Ownership closure');
    // The specimen is a consumer, so it appears on the RIGHT of the chain.
    const chain = ssot.split('\n').find(l => l.includes('→') && l.includes('screens/'))!;
    expect(chain).toContain('components/<name>.html');
  });

  it('the bundle file map replaced the dead sibling block in both base templates', () => {
    for (const rel of [
      'jobs/design/nodes/execute/variants/ui-design-by-handoff/base.md',
      'jobs/design/nodes/execute/variants/game-art-by-handoff/base.md',
    ]) {
      const body = read(rel);
      expect(body).toContain('{{#if bundleFileMap}}');
      // `siblingTasks` filters on `targetFile === own targetFile`, and handoff
      // guarantees one writer per file — the block could never render.
      expect(body).not.toContain('{{#if siblingTasks}}');
    }
  });

  it('the non-handoff variants keep siblingTasks (multiple chapter tasks per file)', () => {
    for (const rel of [
      'jobs/design/nodes/execute/variants/ui-design-by-desc/base.md',
      'jobs/design/nodes/execute/variants/ui-design-by-figma/base.md',
    ]) {
      expect(read(rel)).toContain('siblingTasks');
    }
  });
});

describe('coherence gate scoping', () => {
  it.each([
    ['DESIGN.md', 1],
    ['styles.css', 1],
    ['tokens/colors.css', 1],
    ['components/card.css', 2],
    ['entities/player.css', 2],
    ['assets/logo.svg', 2],
    ['ext/extra.css', 2],
    ['components/card.html', 3],
    ['entities/player.html', 3],
    ['screens/home.html', 3],
  ])('%s is stage %i', (file, stage) => {
    expect(bundleStageOf(file)).toBe(stage);
  });

  it.each([
    [1, 'tokens/colors.css', []],
    [2, 'components/card.css', ['undefined-css-var']],
    // A stage-2 specimen (pre-fix decomposition) cannot see its own css yet.
    [2, 'components/card.html', []],
    [3, 'screens/home.html', ['undefined-css-var', 'unstyled-class']],
  ] as const)('stage %i / %s runs %j', (stage, file, checks) => {
    expect(coherenceChecksForStage(stage as 1 | 2 | 3, file)).toEqual(checks);
  });

  it.each([
    [{ docFormat: 'handoff', targetFile: 'screens/home.html' }, true],
    [{ docFormat: 'handoff' }, false],
    [{ docFormat: 'json', targetFile: 'ui-tokens.json' }, false],
    [{ targetFile: 'plan/prd.md' }, false],
  ])('isHandoffBundleTask(%j) === %s', (task, expected) => {
    expect(isHandoffBundleTask(task as any)).toBe(expected);
  });
});
