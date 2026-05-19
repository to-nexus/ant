import { describe, expect, it } from 'vitest';
import { resolveSpecTargetFileForMode } from '../../src/agents/architect/graph/design/nodes/decompose/specDecompose.js';

type MinimalState = {
  resolvedAction?: { target?: string[] };
  context?: { featurePath?: string };
  deps?: { fileSystem?: { fileExists: (p: string) => Promise<boolean> } };
};

function makeState(opts: {
  target?: string[];
  fileExists?: (p: string) => Promise<boolean>;
  featurePath?: string;
} = {}): MinimalState {
  const s: MinimalState = {};
  if (opts.target) s.resolvedAction = { target: opts.target };
  if (opts.fileExists !== undefined) {
    s.context = { featurePath: opts.featurePath ?? '/feat' };
    s.deps = { fileSystem: { fileExists: opts.fileExists } };
  }
  return s;
}

describe('resolveSpecTargetFileForMode', () => {
  it('generate mode emits prefix-less {slug}.md when no disk collision', async () => {
    const result = await resolveSpecTargetFileForMode(
      makeState({ fileExists: async () => false }) as any,
      'generate',
      'new-spec',
    );
    expect(result).toBe('new-spec.md');
  });

  it('generate mode appends 2-word mnemonic when {slug}.md already exists', async () => {
    const result = await resolveSpecTargetFileForMode(
      makeState({ fileExists: async () => true }) as any,
      'generate',
      'new-spec',
    );
    expect(result).toMatch(/^new-spec-[a-z]+-[a-z]+\.md$/);
  });

  it('generate mode without deps skips disk check (returns plain {slug}.md)', async () => {
    const result = await resolveSpecTargetFileForMode(
      makeState() as any,
      'generate',
      'new-spec',
    );
    expect(result).toBe('new-spec.md');
  });

  it('refactor mode keeps legacy spec- prefixed target basename', async () => {
    const result = await resolveSpecTargetFileForMode(
      makeState({ target: ['architecture/spec/spec-console-app-prd-gap-analysis.md'] }) as any,
      'refactor',
      'ignored-slug',
    );
    expect(result).toBe('spec-console-app-prd-gap-analysis.md');
  });

  it('refactor mode accepts new prefix-less target basename', async () => {
    const result = await resolveSpecTargetFileForMode(
      makeState({ target: ['architecture/spec/wallet-login.md'] }) as any,
      'refactor',
      'ignored-slug',
    );
    expect(result).toBe('wallet-login.md');
  });

  it('refactor mode rejects missing target', async () => {
    await expect(
      resolveSpecTargetFileForMode(makeState() as any, 'refactor', 'ignored-slug'),
    ).rejects.toThrow(/exactly one target file/);
  });

  it('refactor mode rejects filename with invalid characters', async () => {
    await expect(
      resolveSpecTargetFileForMode(
        makeState({ target: ['architecture/spec/BadFile_Name.md'] }) as any,
        'refactor',
        'ignored-slug',
      ),
    ).rejects.toThrow(/must match a spec filename/);
  });
});
