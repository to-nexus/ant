import { describe, expect, it } from 'vitest';
import { resolveSpecTargetFileForMode } from '../../src/agents/architect/graph/design/nodes/decompose/specDecompose.js';

type MinimalState = {
  resolvedAction?: {
    target?: string[];
  };
};

function makeState(target?: string[]): MinimalState {
  if (!target) return {};
  return { resolvedAction: { target } };
}

describe('resolveSpecTargetFileForMode', () => {
  it('generate mode ignores target and uses slug output', () => {
    const result = resolveSpecTargetFileForMode(makeState(['architecture/spec/spec-existing.md']) as any, 'generate', 'new-spec');
    expect(result).toBe('spec-new-spec.md');
  });

  it('refactor mode uses resolvedAction target basename', () => {
    const result = resolveSpecTargetFileForMode(
      makeState(['architecture/spec/spec-console-app-prd-gap-analysis.md']) as any,
      'refactor',
      'ignored-slug',
    );
    expect(result).toBe('spec-console-app-prd-gap-analysis.md');
  });

  it('refactor mode rejects missing target', () => {
    expect(() =>
      resolveSpecTargetFileForMode(makeState() as any, 'refactor', 'ignored-slug'),
    ).toThrow(/exactly one target file/);
  });

  it('refactor mode rejects non spec filename', () => {
    expect(() =>
      resolveSpecTargetFileForMode(
        makeState(['architecture/spec/console-app-prd-gap-analysis.md']) as any,
        'refactor',
        'ignored-slug',
      ),
    ).toThrow(/spec-\*\.md/);
  });
});
