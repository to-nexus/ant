import { describe, it, expect } from 'vitest';
import {
  buildRuntimeContext,
  generateFileTree,
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
    projectCodeContext: { filePaths: [], files: [] },
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
  it('includes Current Task section when currentTask is present', () => {
    const result = buildRuntimeContext(makeCodeState());
    expect(result).toContain('Current Task');
    expect(result).toContain('Build API');
  });

  it('includes IMPLEMENTATION PLAN when planText is present', () => {
    const result = buildRuntimeContext(makeCodeState({
      planText: '{"create":[],"modify":[],"assets":[]}',
    }));
    expect(result).toContain('IMPLEMENTATION PLAN');
    expect(result).toContain('create');
  });

  it('includes assets section when runtimeAssetsIndex has files', () => {
    const result = buildRuntimeContext(makeCodeState({
      runtimeAssetsIndex: {
        count: 1,
        files: ['logo.png'],
      },
    }));
    expect(result).toContain('Available Assets');
    expect(result).toContain('logo.png');
  });

  it('returns string even with minimal state', () => {
    const result = buildRuntimeContext(makeCodeState({ currentTask: null }));
    expect(typeof result).toBe('string');
  });
});

describe('generateFileTree', () => {
  it('returns null when no filePaths', () => {
    const result = generateFileTree(makeCodeState());
    expect(result).toBeNull();
  });

  it('includes Files Loaded section when content-loaded files exist', () => {
    const result = generateFileTree(makeCodeState({
      projectCodeContext: {
        filePaths: ['src/index.ts', 'src/app.ts'],
        files: [
          { path: 'src/index.ts', content: 'console.log("hi")' },
        ],
      },
    }));
    expect(result).not.toBeNull();
    expect(result).toContain('Files Loaded with Content');
    expect(result).toContain('index.ts');
  });

  it('includes Existing Files section for path-only files', () => {
    const result = generateFileTree(makeCodeState({
      projectCodeContext: {
        filePaths: ['src/utils.ts'],
        files: [],
      },
    }));
    expect(result).not.toBeNull();
    expect(result).toContain('Existing Files');
    expect(result).toContain('DO NOT recreate');
    expect(result).toContain('utils.ts');
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
