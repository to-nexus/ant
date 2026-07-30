import { describe, expect, it } from 'vitest';
import {
  resolveSpecTargetFileForMode,
  buildSpecRevisionDecomposition,
  buildAttachedInputLines,
} from '../../src/agents/architect/graph/design/nodes/decompose/specDecompose.js';
import { ExecutionTierId } from '../../src/core/executionTier/index.js';

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

describe('buildSpecRevisionDecomposition (refactor mode — deterministic, no LLM)', () => {
  const EXISTING = `# Spec: Game Defect Refactor

## 1. Overview & Defect Catalog

body

## 2. Root Cause Analysis

body

\`\`\`bash
## not a heading
\`\`\`

## 3. Acceptance Criteria

body
`;

  function makeReadableState(files: Record<string, string>) {
    return {
      context: { featurePath: '/feat' },
      deps: {
        fileSystem: {
          fileExists: async (p: string) => files[p] !== undefined,
          readFile: async (p: string) => {
            const c = files[p];
            if (c === undefined) throw new Error('ENOENT');
            return c;
          },
        },
      },
    } as any;
  }

  it('emits exactly one revision task with the delta-preservation scope and baseline headings', async () => {
    const state = makeReadableState({
      '/feat/architecture/spec/game-defect-refactor.md': EXISTING,
    });
    const r = await buildSpecRevisionDecomposition(state, 'game-defect-refactor.md');

    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].id).toBe('spec-game-defect-refactor-rev-1');
    expect(r.tasks[0].name).toBe('Revision');
    expect(r.tasks[0].scope).toContain('REVISION of the existing document architecture/spec/game-defect-refactor.md');
    expect(r.tasks[0].scope).toContain('preserved verbatim');
    expect(r.tasks[0].scope).toContain('full revised document');
    expect(r.title).toBe('Game Defect Refactor');
    expect(r.executionTier).toBe(ExecutionTierId.Exploratory);
    expect(r.revisionBaselineHeadings).toEqual([
      '1. Overview & Defect Catalog',
      '2. Root Cause Analysis',
      '3. Acceptance Criteria',
    ]);
  });

  it('missing target doc → empty baseline, filename-derived title (gate no-ops)', async () => {
    const state = makeReadableState({});
    const r = await buildSpecRevisionDecomposition(state, 'wallet-login.md');
    expect(r.tasks).toHaveLength(1);
    expect(r.revisionBaselineHeadings).toEqual([]);
    expect(r.title).toBe('wallet-login');
  });
});

describe('buildAttachedInputLines — RAC attachment visibility at spec decompose', () => {
  it('renders paths with role, flagging asset-pool entries (fierce-gaining-gully)', () => {
    const lines = buildAttachedInputLines([
      { path: 'plan/prd.md', role: 'ref' },
      { path: 'assets/game/models/Duck.glb', role: 'context' },
    ]);
    expect(lines[1]).toContain('Attached input files');
    expect(lines).toContain('- plan/prd.md [ref]');
    expect(lines).toContain('- assets/game/models/Duck.glb [context] (asset — reference by path)');
  });

  it('empty pool → empty block (prompt unchanged)', () => {
    expect(buildAttachedInputLines([])).toEqual([]);
  });
});
