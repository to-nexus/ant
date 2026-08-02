import { describe, it, expect } from 'vitest';
import {
  buildTurnInfoMap,
  getPendingCardFilePath,
  isPreviewSurfaceArtifactPath,
  resolveVirtualTabSource,
  shouldRenderVirtualPreviewCard,
} from '../../src/domain/store/editor/virtualTabModel';

describe('virtualTabModel', () => {
  it('accepts only file streaming card with filePath', () => {
    expect(
      shouldRenderVirtualPreviewCard({
        cardId: 'c1',
        statusType: 'file_creating',
        metadata: { filePath: 'architecture/spec/spec-main.md' },
      } as any),
    ).toBe(true);
    expect(
      shouldRenderVirtualPreviewCard({
        cardId: 'c1',
        statusType: 'plan_generating',
        metadata: {},
      } as any),
    ).toBe(false);
    expect(
      shouldRenderVirtualPreviewCard({
        cardId: 'c1',
        statusType: 'file_creating',
        metadata: {},
      } as any),
    ).toBe(false);
  });

  // The preview surface only renders documents; machine-readable artifacts
  // fall back to the chat file card (code-job behaviour).
  it.each([
    ['visual/ui/ant/ui-tokens.json', false],
    ['visual/game-art/ant/game-art-spec.json', false],
    ['visual/ui/handoff/tokens/colors.css', false],
    ['visual/ui/handoff/logo.svg', false],
    ['architecture/spec/spec-main.md', true],
    ['plan/prd.md', true],
    ['visual/ui/handoff/screens/home.html', true],
    ['visual/ui/handoff/components/button.HTM', true],
    ['docs/README.MARKDOWN', true],
  ])('isPreviewSurfaceArtifactPath(%s) === %s', (path, expected) => {
    expect(isPreviewSurfaceArtifactPath(path as string)).toBe(expected);
  });

  it('treats a missing / blank path as not preview-worthy', () => {
    expect(isPreviewSurfaceArtifactPath(undefined)).toBe(false);
    expect(isPreviewSurfaceArtifactPath('')).toBe(false);
    expect(isPreviewSurfaceArtifactPath('   ')).toBe(false);
    expect(isPreviewSurfaceArtifactPath('README')).toBe(false);
  });

  it('mints no virtual tab for a non-document artifact', () => {
    expect(
      shouldRenderVirtualPreviewCard({
        cardId: 'c1',
        statusType: 'file_creating',
        metadata: { filePath: 'visual/ui/ant/ui-tokens.json' },
      } as any),
    ).toBe(false);
  });

  it('extracts filePath from metadata safely', () => {
    expect(
      getPendingCardFilePath({
        cardId: 'c1',
        statusType: 'file_creating',
        metadata: { filePath: 'docs/a.md' },
      } as any),
    ).toBe('docs/a.md');
    expect(
      getPendingCardFilePath({
        cardId: 'c1',
        statusType: 'file_creating',
        metadata: { filePath: '   ' },
      } as any),
    ).toBeUndefined();
  });

  it('resolves source from turn info with selectedJobType fallback', () => {
    const turnInfo = buildTurnInfoMap([{ turnId: 'turn-1', jobType: 'design', jobId: 'job-1' }] as any);
    expect(
      resolveVirtualTabSource({
        turnInfo,
        turnId: 'turn-1',
        selectedJobType: 'plan',
      }),
    ).toBe('design');
    expect(
      resolveVirtualTabSource({
        turnInfo: new Map(),
        turnId: 'turn-2',
        selectedJobType: 'plan',
      }),
    ).toBe('plan');
    expect(
      resolveVirtualTabSource({
        turnInfo: new Map(),
        turnId: 'turn-3',
        selectedJobType: 'code',
      }),
    ).toBeUndefined();
  });
});
