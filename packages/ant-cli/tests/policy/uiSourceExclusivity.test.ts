import { describe, it, expect } from 'vitest';
import { validateUiSourceExclusivity } from '../../src/agents/common/graph/loadDocumentsForRAC';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';
import {
  normalizeUiSourceRefs,
  pickUiSource,
  pickDefaultUiSourceRefs,
  resolveToRAC,
  mergeWithMetadata,
  UI_SOURCE_PRIORITY,
} from '@ant/shared';
import type { ResolvedActionContext, ResolvedArtifact, InferredAction, UiSource } from '@ant/shared';

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

  describe('UI_SOURCE_PRIORITY', () => {
    it('encodes ant > figma > handoff order', () => {
      expect(UI_SOURCE_PRIORITY).toEqual(['ant', 'figma', 'handoff']);
    });

    it('matches the registration order of UI_SOURCE_SUBGROUPS in action-config-matrix', async () => {
      // Indirect access: UI_SOURCE_SUBGROUPS is module-private, but every
      // intent that uses `uiSourceRef()` re-exposes the subgroup list via
      // its slot definition. `gen-code-sys` is the canonical witness — if
      // its `uiSources` registration drifts from UI_SOURCE_PRIORITY, the
      // SSOT picker would silently disagree with the BE invariant.
      const { getConfigSlots } = await import('@ant/shared');
      const slots = getConfigSlots('gen-code-sys');
      const uiSourceSlot = slots?.refs.find(r => r.type === 'ui-source');
      expect(uiSourceSlot?.uiSources?.map(s => s.id)).toEqual(UI_SOURCE_PRIORITY);
    });
  });

  describe('pickUiSource — highest-priority winner', () => {
    it('returns null for empty / undefined input', () => {
      expect(pickUiSource(undefined)).toBeNull();
      expect(pickUiSource([])).toBeNull();
    });

    it('returns null when no UI paths are present', () => {
      expect(pickUiSource(['plan/prd.md', 'architecture/system/fe-system-main.md'])).toBeNull();
    });

    it('picks ant when only ant is present', () => {
      expect(pickUiSource(['visual/ui/ant/ui-tokens.json'])).toBe('ant');
    });

    it('picks ant over figma when both present (priority order)', () => {
      expect(pickUiSource([
        'visual/ui/figma/figma.json',
        'visual/ui/ant/ui-tokens.json',
      ])).toBe('ant');
    });

    it('picks figma over handoff', () => {
      expect(pickUiSource([
        'visual/ui/handoff/page.html',
        'visual/ui/figma/figma.json',
      ])).toBe('figma');
    });

    it('picks ant over figma over handoff (all three)', () => {
      expect(pickUiSource([
        'visual/ui/handoff/notes.md',
        'visual/ui/figma/figma.json',
        'visual/ui/ant/ui-spec.json',
      ])).toBe('ant');
    });
  });

  describe('normalizeUiSourceRefs — SSOT funnel', () => {
    it('passes non-UI paths through unchanged', () => {
      const input = ['plan/prd.md', 'architecture/spec/spec-foo.md'];
      expect(normalizeUiSourceRefs(input)).toEqual(input);
    });

    it('keeps single-source UI paths unchanged', () => {
      const input = ['visual/ui/ant/ui-tokens.json', 'visual/ui/ant/ui-spec.json'];
      expect(normalizeUiSourceRefs(input)).toEqual(input);
    });

    it('drops figma when ant is also present (ant wins)', () => {
      expect(normalizeUiSourceRefs([
        'visual/ui/ant/ui-tokens.json',
        'visual/ui/figma/figma.json',
      ])).toEqual(['visual/ui/ant/ui-tokens.json']);
    });

    it('drops handoff when figma is also present (figma wins)', () => {
      expect(normalizeUiSourceRefs([
        'visual/ui/handoff/page.html',
        'visual/ui/figma/figma.json',
      ])).toEqual(['visual/ui/figma/figma.json']);
    });

    it('keeps non-UI paths alongside the chosen UI source', () => {
      expect(normalizeUiSourceRefs([
        'architecture/system/fe-system-main.md',
        'visual/ui/ant/ui-tokens.json',
        'visual/ui/figma/figma.json',
        'plan/prd.md',
      ])).toEqual([
        'architecture/system/fe-system-main.md',
        'visual/ui/ant/ui-tokens.json',
        'plan/prd.md',
      ]);
    });

    it('returns empty array for undefined / empty input (does not throw)', () => {
      expect(normalizeUiSourceRefs(undefined)).toEqual([]);
      expect(normalizeUiSourceRefs([])).toEqual([]);
    });
  });

  describe('pickDefaultUiSourceRefs — auto-fill picker', () => {
    type SG = { id: UiSource; hasValidFiles: boolean; files: string[] };
    const sg = (id: UiSource, hasValidFiles: boolean, files: string[]): SG =>
      ({ id, hasValidFiles, files });

    it('returns empty when no subgroups are valid', () => {
      const subgroups: SG[] = [
        sg('ant', false, ['visual/ui/ant/ui-tokens.json']),
        sg('figma', false, ['visual/ui/figma/figma.json']),
        sg('handoff', false, ['visual/ui/handoff/page.html']),
      ];
      expect(pickDefaultUiSourceRefs(subgroups)).toEqual([]);
    });

    it('returns ant files when only ant is valid', () => {
      const subgroups: SG[] = [
        sg('ant', true, ['visual/ui/ant/ui-tokens.json']),
        sg('figma', false, []),
        sg('handoff', false, []),
      ];
      expect(pickDefaultUiSourceRefs(subgroups)).toEqual(['visual/ui/ant/ui-tokens.json']);
    });

    it('prefers ant over figma when both are valid', () => {
      const subgroups: SG[] = [
        sg('ant', true, ['visual/ui/ant/ui-tokens.json', 'visual/ui/ant/ui-spec.json']),
        sg('figma', true, ['visual/ui/figma/figma.json']),
        sg('handoff', false, []),
      ];
      expect(pickDefaultUiSourceRefs(subgroups)).toEqual([
        'visual/ui/ant/ui-tokens.json',
        'visual/ui/ant/ui-spec.json',
      ]);
    });

    it('falls back to figma when ant has no valid files', () => {
      const subgroups: SG[] = [
        sg('ant', false, []),
        sg('figma', true, ['visual/ui/figma/figma.json']),
        sg('handoff', true, ['visual/ui/handoff/page.html']),
      ];
      expect(pickDefaultUiSourceRefs(subgroups)).toEqual(['visual/ui/figma/figma.json']);
    });

    it('falls back to handoff as last resort', () => {
      const subgroups: SG[] = [
        sg('ant', false, []),
        sg('figma', false, []),
        sg('handoff', true, ['visual/ui/handoff/page.html']),
      ];
      expect(pickDefaultUiSourceRefs(subgroups)).toEqual(['visual/ui/handoff/page.html']);
    });

    it('handles undefined / empty subgroups list', () => {
      expect(pickDefaultUiSourceRefs(undefined)).toEqual([]);
      expect(pickDefaultUiSourceRefs([])).toEqual([]);
    });
  });

  describe('resolveToRAC funnel — never produces mixed UiSource', () => {
    it('drops figma when ant + figma are both supplied (explicit path)', () => {
      const rac = resolveToRAC(
        'gen-code-sys',
        {
          refs: ['visual/ui/ant/ui-tokens.json', 'visual/ui/figma/figma.json'],
          context: ['plan/prd.md'],
        },
        'explicit',
      );
      expect(rac.refs).toEqual(['visual/ui/ant/ui-tokens.json']);
      expect(rac.context).toEqual(['plan/prd.md']);
      // Safety net must not throw on this normalized RAC.
      expect(() => validateUiSourceExclusivity(rac)).not.toThrow();
    });

    it('also normalizes context (cross-slot exclusivity)', () => {
      const rac = resolveToRAC(
        'gen-code-spec',
        {
          refs: ['architecture/spec/spec-foo.md'],
          context: ['visual/ui/figma/figma.json', 'visual/ui/handoff/page.html'],
        },
        'explicit',
      );
      expect(rac.context).toEqual(['visual/ui/figma/figma.json']);
      expect(() => validateUiSourceExclusivity(rac)).not.toThrow();
    });
  });

  describe('mergeWithMetadata funnel — never produces mixed UiSource', () => {
    it('inferred ant + metadata figma → ant wins after merge', () => {
      const inferred: InferredAction = {
        intentId: 'gen-code-sys',
        refs: ['visual/ui/ant/ui-tokens.json'],
        context: [],
      } as unknown as InferredAction;
      const merged = mergeWithMetadata(inferred, {
        refs: ['visual/ui/figma/figma.json'],
      } as any);
      expect(merged.refs).toEqual(['visual/ui/ant/ui-tokens.json']);
    });

    it('non-UI paths alongside UI paths survive normalization', () => {
      const inferred: InferredAction = {
        intentId: 'gen-code-sys',
        refs: ['architecture/system/fe-system-main.md', 'visual/ui/figma/figma.json'],
        context: [],
      } as unknown as InferredAction;
      const merged = mergeWithMetadata(inferred, {
        refs: ['visual/ui/ant/ui-tokens.json', 'plan/prd.md'],
      } as any);
      expect(merged.refs).toEqual([
        'architecture/system/fe-system-main.md',
        'visual/ui/ant/ui-tokens.json',
        'plan/prd.md',
      ]);
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
