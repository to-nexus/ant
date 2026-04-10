/**
 * Task 4: Prompt System Immutability Tests
 *
 * Validates that prompt-pipeline functions do NOT mutate their input parameters.
 * Mutation of shared state is the most dangerous bug class in parallel task execution.
 */
import { describe, it, expect } from 'vitest';
import { ModeController } from '../src/core/prompt/engine/ModeController';
import { ContextAssembler, AssembledContext } from '../src/core/prompt/engine/ContextAssembler';
import { prepareDesignDocument } from '../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { condenseContent } from '../src/core/utils/contentCondenser';
import { resolveFromExplicit, resolveFromInfer } from '@ant/shared';
import type { ResolvedActionContext, ActionMetadata, DetectionReport, ResolvedDocument } from '@ant/shared';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeAssembledContext(overrides?: Partial<AssembledContext>): AssembledContext {
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
  } as AssembledContext;
}

function makeResolvedAction(overrides?: Partial<ResolvedActionContext>): ResolvedActionContext {
  return {
    source: 'infer' as const,
    jobMode: 'generate' as const,
    tech: { language: 'typescript' as const, environment: 'frontend' as const },
    hasExplicitFields: false,
    documents: [
      { path: 'design.md', content: 'Design content', role: 'ref' as const, label: 'Design' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. ModeController.determineMode does NOT mutate context
// ---------------------------------------------------------------------------

describe('ModeController.determineMode immutability', () => {
  const controller = new ModeController();

  it('does not mutate AssembledContext parameter', () => {
    const context = makeAssembledContext({
      directive: 'Build a login page',
      codebaseProfile: { language: 'TypeScript', framework: 'Next.js' },
      documents: [{ path: 'spec.md', content: 'some spec', role: 'context' }],
    });
    const before = deepClone(context);

    controller.determineMode('code', 'execute', context, 'generate', 'feature');

    expect(context).toEqual(before);
  });

  it('does not mutate resolvedAction parameter', () => {
    const rac = makeResolvedAction();
    const before = deepClone(rac);
    const context = makeAssembledContext();

    controller.determineMode('code', 'execute', context, 'generate', 'feature', rac);

    expect(rac).toEqual(before);
  });

  it('does not mutate context when using refactor mode with documents', () => {
    const rac = makeResolvedAction({
      source: 'explicit',
      jobMode: 'refactor',
      basis: 'prd',
      documents: [
        { path: 'ui-spec.md', content: 'UI spec', role: 'ref' },
        { path: 'design.md', content: 'Design', role: 'context' },
      ],
    });
    const context = makeAssembledContext({
      projectCodeContext: { files: [{ path: 'a.ts', content: 'code' }] } as any,
    });
    const racBefore = deepClone(rac);
    const ctxBefore = deepClone(context);

    controller.determineMode('code', 'execute', context, 'refactor', 'feature', rac);

    expect(rac).toEqual(racBefore);
    expect(context).toEqual(ctxBefore);
  });
});

// ---------------------------------------------------------------------------
// 2. ContextAssembler.assemble does NOT mutate artifacts
// ---------------------------------------------------------------------------

describe('ContextAssembler.assemble immutability', () => {
  const assembler = new ContextAssembler();

  it('does not mutate artifacts parameter', async () => {
    const rac = makeResolvedAction();
    const docs: ResolvedDocument[] = [
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
// 5. resolveFromExplicit / resolveFromInfer do NOT mutate inputs
// ---------------------------------------------------------------------------

describe('RAC factory immutability', () => {
  it('resolveFromExplicit does not mutate actionMetadata', () => {
    const metadata: ActionMetadata = {
      intent: 'create-frontend',
      basis: 'prd',
      target: ['src/App.tsx'],
      refs: ['docs/spec.md'],
      context: ['Use React'],
    };
    const before = deepClone(metadata);

    resolveFromExplicit(metadata);

    expect(metadata).toEqual(before);
  });

  it('resolveFromExplicit does not mutate codebaseProfile', () => {
    const metadata: ActionMetadata = { intent: 'create-frontend' };
    const profile = { language: 'TypeScript', framework: 'React' };
    const before = deepClone(profile);

    resolveFromExplicit(metadata, profile);

    expect(profile).toEqual(before);
  });

  it('resolveFromInfer does not mutate DetectionReport', () => {
    const report: DetectionReport = {
      environment: 'frontend',
      jobMode: 'generate',
      profile: { language: 'TypeScript', framework: 'React' },
    } as DetectionReport;
    const before = deepClone(report);

    resolveFromInfer(report);

    expect(report).toEqual(before);
  });

  it('resolveFromInfer does not mutate actionMetadata', () => {
    const report: DetectionReport = {
      environment: 'backend',
      jobMode: 'refactor',
      profile: { language: 'Go' },
    } as DetectionReport;
    const metadata: ActionMetadata = {
      basis: 'prd',
      target: ['main.go'],
      refs: ['api.md'],
      context: ['REST API'],
    };
    const metaBefore = deepClone(metadata);

    resolveFromInfer(report, metadata);

    expect(metadata).toEqual(metaBefore);
  });
});
