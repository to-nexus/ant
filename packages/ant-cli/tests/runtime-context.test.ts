import { describe, it, expect } from 'vitest';
import {
  buildRuntimeContext,
} from '../src/agents/architect/graph/code/nodes/execute/buildMessages';
import {
  buildRuntimeContext as buildDesignRuntimeContext,
} from '../src/agents/architect/graph/design/nodes/docGen/intent/system';

function makeCodeState(overrides: Record<string, any> = {}): any {
  return {
    currentTask: { id: 'task-1', name: 'Build API', description: 'Create REST endpoints' },
    planText: null,
    runtimeAssetsIndex: null,
    otherWorkerFileSummary: null,
    context: {},
    ...overrides,
  };
}

function makeDesignState(overrides: Record<string, any> = {}): any {
  return {
    context: { featurePath: '/tmp/test' },
    currentTask: { id: 'design-1', name: 'System Design', targetFile: 'be-system-main.md', description: 'Design a REST API system' },
    directive: 'Design a REST API',
    existingDocument: null,
    resolvedAction: undefined,
    existingDesignDocs: {},
    artifacts: [],
    ...overrides,
  };
}

describe('buildRuntimeContext (code)', () => {
  it('includes Current Task section when currentTask is present', async () => {
    const result = await buildRuntimeContext(makeCodeState());
    expect(result).toContain('Current Task');
    expect(result).toContain('Build API');
  });

  it('includes IMPLEMENTATION PLAN when planText is present', async () => {
    const result = await buildRuntimeContext(makeCodeState({
      planText: '{"create":[],"modify":[],"assets":[]}',
    }));
    expect(result).toContain('IMPLEMENTATION PLAN');
    expect(result).toContain('create');
  });

  it('includes assets section when runtimeAssetsIndex has files', async () => {
    const result = await buildRuntimeContext(makeCodeState({
      runtimeAssetsIndex: {
        count: 1,
        files: ['logo.png'],
      },
    }));
    expect(result).toContain('Available Assets');
    expect(result).toContain('logo.png');
  });

  it('returns string even with minimal state', async () => {
    const result = await buildRuntimeContext(makeCodeState({ currentTask: null }));
    expect(typeof result).toBe('string');
  });

  it('includes Existing Codebase Files section when manifest is populated', async () => {
    const result = await buildRuntimeContext(makeCodeState({
      _existingCodebaseFiles: ['codebase/src/app.ts', 'codebase/src/utils.ts'],
    }));
    expect(result).toContain('Existing Codebase Files');
    expect(result).toContain('codebase/src/app.ts');
    expect(result).toContain('codebase/src/utils.ts');
    expect(result).toContain('edit_file');
  });

  it('omits Existing Codebase Files section when manifest is empty', async () => {
    const result = await buildRuntimeContext(makeCodeState({
      _existingCodebaseFiles: [],
    }));
    expect(result).not.toContain('Existing Codebase Files');
  });
});

describe('buildRuntimeContext (design)', () => {
  it('includes Target Document when currentTask has targetFile', () => {
    const result = buildDesignRuntimeContext(makeDesignState());
    expect(result).toContain('Target Document');
    expect(result).toContain('be-system-main.md');
  });

  it('includes Directive when present', () => {
    const result = buildDesignRuntimeContext(makeDesignState());
    expect(result).toContain('Design a REST API');
  });

  it('includes existing document in refactor mode', () => {
    const result = buildDesignRuntimeContext(makeDesignState({
      resolvedAction: { mode: 'refactor', source: 'infer', hasExplicitFields: false },
      existingDesignDocs: {
        'be-system-main.md': '# Existing Design\nPrevious content here',
      },
    }));
    expect(result).toContain('Existing Design');
  });
});
