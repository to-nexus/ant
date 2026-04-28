import { describe, it, expect } from 'vitest';
import { validateUiSourceExclusivity } from '../src/agents/common/graph/loadDocumentsForRAC';
import { ArtifactPoolView } from '../src/core/artifact/ArtifactPipeline';
import type { ResolvedActionContext, ResolvedArtifact } from '@ant/shared';

function rac(refs: string[] = [], context: string[] = []): ResolvedActionContext {
  return {
    intent: 'gen-code-sys',
    intentGroup: 'gen-code',
    mode: 'creation',
    refs,
    context,
  } as unknown as ResolvedActionContext;
}

function artifact(path: string, role: 'ref' | 'context' = 'context'): ResolvedArtifact {
  return { path, role, content: '{}' };
}

describe('UiSource hard-exclusive invariant', () => {
  describe('validateUiSourceExclusivity (RAC path)', () => {
    it('only ant source → passes', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          ['visual/ui/ant/ui-tokens.json'],
          ['visual/ui/ant/ui-spec.json'],
        )),
      ).not.toThrow();
    });

    it('only figma source → passes', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          [],
          ['visual/ui/figma/figma.json'],
        )),
      ).not.toThrow();
    });

    it('only handoff source → passes', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          [],
          ['visual/ui/handoff/page.html', 'visual/ui/handoff/styles.css'],
        )),
      ).not.toThrow();
    });

    it('no UI source at all → passes (non-UI intents)', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          ['architecture/system/fe-system-main.md'],
          ['plan/prd.md'],
        )),
      ).not.toThrow();
    });

    it('ant + figma mixed across refs/context → throws', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          ['visual/ui/ant/ui-tokens.json'],
          ['visual/ui/figma/figma.json'],
        )),
      ).toThrow(/mixed UiSource/);
    });

    it('ant + handoff within the same list → throws', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          [],
          [
            'visual/ui/ant/ui-tokens.json',
            'visual/ui/handoff/notes.md',
          ],
        )),
      ).toThrow(/mixed UiSource/);
    });

    it('figma + handoff → throws', () => {
      expect(() =>
        validateUiSourceExclusivity(rac(
          [],
          [
            'visual/ui/figma/figma.json',
            'visual/ui/handoff/page.html',
          ],
        )),
      ).toThrow(/mixed UiSource/);
    });
  });

  describe('ArtifactPoolView.uiSource()', () => {
    it('ant-only pool returns "ant"', () => {
      const view = new ArtifactPoolView([
        artifact('visual/ui/ant/ui-tokens.json'),
        artifact('visual/ui/ant/spec/header'),
      ]);
      expect(view.uiSource()).toBe('ant');
    });

    it('figma-only pool returns "figma"', () => {
      const view = new ArtifactPoolView([
        artifact('visual/ui/figma/figma.json'),
      ]);
      expect(view.uiSource()).toBe('figma');
    });

    it('handoff-only pool returns "handoff"', () => {
      const view = new ArtifactPoolView([
        artifact('visual/ui/handoff/page.html'),
      ]);
      expect(view.uiSource()).toBe('handoff');
    });

    it('pool without any UI artifact returns null', () => {
      const view = new ArtifactPoolView([
        artifact('architecture/system/fe-system-main.md'),
        artifact('plan'),
      ]);
      expect(view.uiSource()).toBeNull();
    });

    it('mixed pool throws', () => {
      const view = new ArtifactPoolView([
        artifact('visual/ui/ant/ui-tokens.json'),
        artifact('visual/ui/figma/figma.json'),
      ]);
      expect(() => view.uiSource()).toThrow(/mixed UI sources/);
    });
  });
});
