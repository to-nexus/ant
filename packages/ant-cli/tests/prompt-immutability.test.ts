/**
 * Task 4: Prompt System Immutability Tests
 *
 * Validates that prompt-pipeline functions do NOT mutate their input parameters.
 * Mutation of shared state is the most dangerous bug class in parallel task execution.
 */
import { describe, it, expect } from 'vitest';
import { prepareDesignDocument } from '../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { condenseContent } from '../src/core/utils/contentCondenser';
import { resolveToRAC } from '@ant/shared';
import type { ResolvedActionContext, ActionMetadata, ResolvedArtifact } from '@ant/shared';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAssembledContext(overrides?: Partial<any>): any {
  return {
    referenceCodeContexts: [],
    stats: {
      hasProjectCode: false,
      hasDesignDoc: false,
      hasDirective: false,
      hasMemory: false,
      hasMissingDependency: false,
    },
    ...overrides,
  } as any;
}

function makeResolvedAction(overrides?: Partial<ResolvedActionContext>): ResolvedActionContext {
  return {
    source: 'infer' as const,
    mode: 'generate' as const,
    hasExplicitFields: false,
    documents: [
      { path: 'design.md', content: 'Design content', role: 'ref' as const, label: 'Design' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. PromptResolver.resolve does NOT mutate context
// ---------------------------------------------------------------------------

// TODO: Rewrite this test for AutoInjectionResolver (replaces PromptResolver)
describe.skip('PromptResolver.resolve immutability', () => {
  const resolver = null as any;

  it('does not mutate AssembledContext parameter', () => {
    const context = makeAssembledContext({
      directive: 'Build a login page',
      techTier: { language: 'typescript', framework: 'Next.js' },
      documents: [{ path: 'spec.md', content: 'some spec', role: 'context' }],
    });
    const before = deepClone(context);

    resolver.resolve('code', 'execute', context, 'feature');

    expect(context).toEqual(before);
  });

  it('does not mutate resolvedAction within context', () => {
    const rac = makeResolvedAction();
    const before = deepClone(rac);
    const context = makeAssembledContext({ resolvedAction: rac });

    resolver.resolve('code', 'execute', context, 'feature');

    expect(rac).toEqual(before);
  });

  it('does not mutate context when using refactor mode with documents', () => {
    const rac = makeResolvedAction({
      source: 'explicit',
      mode: 'refactor',
      documents: [
        { path: 'ui-spec.md', content: 'UI spec', role: 'ref' },
        { path: 'design.md', content: 'Design', role: 'context' },
      ],
    });
    const context = makeAssembledContext({
      resolvedAction: rac,
      projectCodeContext: { files: [{ path: 'a.ts', content: 'code' }] } as any,
    });
    const racBefore = deepClone(rac);
    const ctxBefore = deepClone(context);

    resolver.resolve('code', 'execute', context, 'feature');

    expect(rac).toEqual(racBefore);
    expect(context).toEqual(ctxBefore);
  });
});

// ---------------------------------------------------------------------------
// 2. ContextAssembler.assemble does NOT mutate artifacts
// ---------------------------------------------------------------------------

// TODO: Rewrite this test for PromptBuilder pipeline (ContextAssembler removed)
describe.skip('ContextAssembler.assemble immutability', () => {
  const assembler = null as any;

  it('does not mutate artifacts parameter', async () => {
    const rac = makeResolvedAction();
    const docs: ResolvedArtifact[] = [
      { path: 'a.md', content: 'content', role: 'ref' },
    ];
    const artifacts = {
      directive: 'Build feature',
      resolvedAction: rac,
      documents: docs,
      designDocs: {
        apiContracts: { main: 'contract' },
        feDesigns: { main: 'fe design' },
        beDesigns: {},
      },
    };
    const before = deepClone(artifacts);

    await assembler.assemble('code', {} as any, undefined, undefined, artifacts);

    expect(artifacts).toEqual(before);
  });

  it('does not mutate resolvedAction within artifacts', async () => {
    const rac = makeResolvedAction({
      documents: [
        { path: 'spec.md', content: 'spec content', role: 'context' },
      ],
    });
    const artifacts = { resolvedAction: rac };
    const racBefore = deepClone(rac);

    await assembler.assemble('code', {} as any, undefined, undefined, artifacts);

    expect(rac).toEqual(racBefore);
  });
});

// ---------------------------------------------------------------------------
// 3. prepareDesignDocument does NOT mutate state.designDocs
// ---------------------------------------------------------------------------

describe('prepareDesignDocument immutability', () => {
  it('does not mutate state.designDocs (inline mode)', () => {
    const state = {
      designDocs: {
        apiContracts: { main: 'API contract content' },
        feDesigns: { main: 'FE design content' },
        beDesigns: { main: 'BE design content' },
      },
      design: '',
    } as any;
    const before = deepClone(state.designDocs);

    prepareDesignDocument(state);

    expect(state.designDocs).toEqual(before);
  });

  it('does not mutate state.designDocs (tool mode)', () => {
    const state = {
      designDocs: {
        apiContracts: { main: 'x'.repeat(100_000) },
        feDesigns: { main: 'y'.repeat(100_001) },
        beDesigns: {},
      },
      design: '',
    } as any;
    const before = deepClone(state.designDocs);

    prepareDesignDocument(state);

    expect(state.designDocs).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 4. condenseContent does NOT mutate input string (strings are immutable in JS,
//    but we verify the options object is not mutated)
// ---------------------------------------------------------------------------

describe('condenseContent immutability', () => {
  it('does not mutate options parameter', () => {
    const options = {
      threshold: 100,
      label: 'Test',
      filePath: 'test.md',
      contentType: 'markdown' as const,
      toolHint: 'read_file',
    };
    const before = deepClone(options);

    condenseContent('x'.repeat(200), options);

    expect(options).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 5. resolveToRAC does NOT mutate inputs
// ---------------------------------------------------------------------------

describe('RAC factory immutability', () => {
  it('resolveToRAC does not mutate slots parameter', () => {
    const slots = {
      target: ['src/App.tsx'],
      refs: ['docs/spec.md'],
      context: ['Use React'],
    };
    const before = deepClone(slots);

    resolveToRAC('gen-sys-fe', slots, 'explicit');

    expect(slots).toEqual(before);
  });

  it('resolveToRAC does not mutate slots with domain', () => {
    const slots = {
      target: ['main.go'],
      refs: ['api.md'],
      context: ['REST API'],
      domain: 'service' as const,
    };
    const before = deepClone(slots);

    resolveToRAC('gen-sys-be', slots, 'infer');

    expect(slots).toEqual(before);
  });
});
