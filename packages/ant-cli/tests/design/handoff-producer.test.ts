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
