import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadResolvedArtifacts } from '../../src/agents/common/graph/loadDocumentsForRAC';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';
import { pickUiSourceSubgroupDir, isUiTreeParentPath } from '@ant/shared';
import type { ResolvedActionContext, UiSource } from '@ant/shared';

/**
 * Regression guard for the `full-leaving-guild` defect: a directive-triggered
 * infer code job aborted with "mixed UI sources (figma, handoff)" on a
 * handoff-only workspace. Root cause — the `ui-source` slot declares the PARENT
 * dir `visual/ui`; the BE infer path used it verbatim, and since
 * `init.ts ensureCanonicalStructure` always scaffolds an empty
 * `visual/ui/figma/figma.json`, directory-walking the parent swept the figma
 * stub in alongside the real handoff files.
 */

function rac(refs: string[]): ResolvedActionContext {
  return {
    intent: 'gen-code-directive',
    intentGroup: 'gen-code',
    mode: 'creation',
    refs,
    context: [],
  } as unknown as ResolvedActionContext;
}

describe('pickUiSourceSubgroupDir — BE infer-path narrowing (priority × validity)', () => {
  type SG = { id: UiSource; dir: string; hasValidFiles: boolean };
  const sg = (id: UiSource, dir: string, hasValidFiles: boolean): SG => ({ id, dir, hasValidFiles });

  it('stub-figma loses to populated handoff (the defect scenario)', () => {
    // Scaffolded empty figma.json → figma.hasValidFiles=false → must NOT win.
    expect(
      pickUiSourceSubgroupDir([
        sg('ant', 'visual/ui/ant', false),
        sg('figma', 'visual/ui/figma', false),
        sg('handoff', 'visual/ui/handoff', true),
      ]),
    ).toBe('visual/ui/handoff');
  });

  it('prefers ant over everything when valid (priority)', () => {
    expect(
      pickUiSourceSubgroupDir([
        sg('ant', 'visual/ui/ant', true),
        sg('figma', 'visual/ui/figma', true),
        sg('handoff', 'visual/ui/handoff', true),
      ]),
    ).toBe('visual/ui/ant');
  });

  it('prefers a valid figma over handoff', () => {
    expect(
      pickUiSourceSubgroupDir([
        sg('ant', 'visual/ui/ant', false),
        sg('figma', 'visual/ui/figma', true),
        sg('handoff', 'visual/ui/handoff', true),
      ]),
    ).toBe('visual/ui/figma');
  });

  it('returns null when no subgroup is valid (caller drops the slot)', () => {
    expect(
      pickUiSourceSubgroupDir([
        sg('ant', 'visual/ui/ant', false),
        sg('figma', 'visual/ui/figma', false),
        sg('handoff', 'visual/ui/handoff', false),
      ]),
    ).toBeNull();
    expect(pickUiSourceSubgroupDir(undefined)).toBeNull();
    expect(pickUiSourceSubgroupDir([])).toBeNull();
  });
});

describe('isUiTreeParentPath — detects the un-narrowed parent', () => {
  it('matches the parent dir (with/without trailing slash)', () => {
    expect(isUiTreeParentPath('visual/ui')).toBe(true);
    expect(isUiTreeParentPath('visual/ui/')).toBe(true);
  });

  it('does NOT match a classified subgroup path', () => {
    expect(isUiTreeParentPath('visual/ui/handoff/page.html')).toBe(false);
    expect(isUiTreeParentPath('visual/ui/figma/figma.json')).toBe(false);
    expect(isUiTreeParentPath('visual/ui/ant/ui-tokens.json')).toBe(false);
  });

  it('does NOT match non-UI paths', () => {
    expect(isUiTreeParentPath('plan/prd.md')).toBe(false);
    expect(isUiTreeParentPath('visual/game-art/ant/game-art-spec.json')).toBe(false);
  });
});

describe('loadResolvedArtifacts — parent vs narrowed UI ref (disk reproduction)', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-source-narrow-'));
    // Scaffolded empty figma stub (the canonical structure that init always creates).
    fs.mkdirSync(path.join(dir, 'visual/ui/figma'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'visual/ui/figma/figma.json'), '{"file": null}');
    // Real, populated handoff bundle.
    fs.mkdirSync(path.join(dir, 'visual/ui/handoff'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'visual/ui/handoff/page.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'visual/ui/handoff/styles.css'), 'body{}');
    // No ant artifacts.
    fs.mkdirSync(path.join(dir, 'visual/ui/ant'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('NARROWED ref (visual/ui/handoff) → pool resolves to handoff, no throw', () => {
    const pool = loadResolvedArtifacts(rac(['visual/ui/handoff']), dir);
    expect(new ArtifactPoolView(pool).uiSource()).toBe('handoff');
  });

  it('PARENT ref (visual/ui) → guard throws (negative control: proves the bug is caught)', () => {
    expect(() => loadResolvedArtifacts(rac(['visual/ui']), dir)).toThrow(
      /spans multiple UI sources/,
    );
  });
});
