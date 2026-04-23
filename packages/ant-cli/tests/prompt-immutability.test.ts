/**
 * Task 4: Prompt System Immutability Tests
 *
 * Validates that prompt-pipeline functions do NOT mutate their input parameters.
 * Mutation of shared state is the most dangerous bug class in parallel task execution.
 */
import { describe, it, expect } from 'vitest';
import { prepareDesignDocument } from '../src/agents/architect/graph/code/nodes/decompose/designSelector';
import { compactContent } from '../src/core/utils/contentCompactor';
import { resolveToRAC } from '@ant/shared';
import type { ResolvedActionContext } from '@ant/shared';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
// 1. AutoInjectionResolver.resolve does NOT mutate input
// ---------------------------------------------------------------------------

import { AutoInjectionResolver } from '../src/core/prompt/builder/AutoInjectionResolver';

describe('AutoInjectionResolver.resolve immutability', () => {
  const autoResolver = new AutoInjectionResolver();

  it('does not mutate input parameter', () => {
    const input = {
      job: 'code' as const,
      phase: 'execute' as const,
      taskType: 'feature',
      mode: 'generate' as const,
      techTier: { language: 'typescript' as const, stack: 'frontend' as const },
      data: { hasDirective: true, hasMemory: true },
    };
    const before = deepClone(input);

    autoResolver.resolve(input);

    expect(input).toEqual(before);
  });

  it('does not mutate resolvedAction within input', () => {
    const rac = makeResolvedAction();
    const before = deepClone(rac);
    const input = {
      job: 'code' as const,
      phase: 'execute' as const,
      resolvedAction: rac,
      data: { hasDirective: true },
    };

    autoResolver.resolve(input);

    expect(rac).toEqual(before);
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
// 4. compactContent does NOT mutate input string (strings are immutable in JS,
//    but we verify the options object is not mutated)
// ---------------------------------------------------------------------------

describe('compactContent immutability', () => {
  it('does not mutate options parameter', () => {
    const options = {
      threshold: 100,
      label: 'Test',
      filePath: 'test.md',
      contentType: 'markdown' as const,
      toolHint: 'read_file',
    };
    const before = deepClone(options);

    compactContent('x'.repeat(200), options);

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
