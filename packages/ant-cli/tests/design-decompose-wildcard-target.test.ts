/**
 * Regression pin — `validateAndFixTargetFiles` wildcard placeholder semantics.
 *
 * Bug: action-config-matrix's `formatOutputSpec` ships
 * `outputs/design/system/be-system-*.md` into `actionMetadata.target` (FE)
 * since `0f9ee7e4`. The strict equality (`f === 'be-system-main.md'`) in
 * `validateAndFixTargetFiles` Step 1 never matched the wildcard form, so
 * every LLM-emitted task was dropped → `generateMinimumTasks` re-injected
 * wildcard-shaped placeholders → docGen prompt landed with `*.md` filenames
 * → LLMs interpreted the `*` as "produce all three documents" and each
 * parallel worker wrote every system-design file (3 tasks × 3 documents).
 *
 * Fix invariants verified here:
 *   1. Single-package fallback — wildcards survive Step 1 (no MSA decision)
 *      then collapse to `-main.md`.
 *   2. MSA backend — `services` non-empty expands `be-system-*.md` /
 *      `api-contract-*.md` per service.
 *   3. MSA frontend — `fePackages` non-empty expands `fe-system-*.md` per
 *      package.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAndFixTargetFiles,
  type SystemDesignResponse,
} from '../src/agents/architect/graph/design/nodes/decompose/systemDesignDecompose.js';

function makeTask(targetFile: string, idx: number): SystemDesignResponse['tasks'][number] {
  return {
    id: `design-${targetFile.replace(/\.md$/, '')}`,
    name: `Design Document: ${targetFile}`,
    targetFile,
    description: `Generate ${targetFile} based on requirements.`,
    priority: 200 + idx * 20,
  };
}

function baseResponse(overrides: Partial<SystemDesignResponse> = {}): SystemDesignResponse {
  return {
    documentType: 'unified',
    targetFiles: [],
    tasks: [],
    ...overrides,
  };
}

describe('validateAndFixTargetFiles — wildcard placeholder semantics', () => {
  it('single-package fallback: wildcard input collapses to -main.md when no MSA decision', () => {
    const response = baseResponse({
      tasks: [
        makeTask('be-system-main.md', 0),
        makeTask('fe-system-main.md', 1),
        makeTask('api-contract-main.md', 2),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-*.md', 'fe-system-*.md', 'api-contract-*.md'],
      undefined,
      'generate',
    );

    expect(result.targetFiles).toEqual([
      'be-system-main.md',
      'fe-system-main.md',
      'api-contract-main.md',
    ]);
    // LLM tasks survive Step 2 (concrete -main.md matches collapsed effectiveTargetFiles)
    expect(result.tasks.map(t => t.targetFile)).toEqual([
      'be-system-main.md',
      'fe-system-main.md',
      'api-contract-main.md',
    ]);
    expect(result.documentType).toBe('contract-first');
  });

  it('MSA backend: services expands `be-system-*.md` and `api-contract-*.md` per service', () => {
    const response = baseResponse({
      services: ['auth', 'matching-engine', 'api'],
      tasks: [
        makeTask('be-system-auth.md', 0),
        makeTask('be-system-matching-engine.md', 1),
        makeTask('be-system-api.md', 2),
        makeTask('api-contract-auth.md', 3),
        makeTask('api-contract-matching-engine.md', 4),
        makeTask('api-contract-api.md', 5),
      ],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-*.md', 'api-contract-*.md'],
      undefined,
      'generate',
    );

    expect(result.targetFiles).toEqual([
      'be-system-auth.md',
      'be-system-matching-engine.md',
      'be-system-api.md',
      'api-contract-auth.md',
      'api-contract-matching-engine.md',
      'api-contract-api.md',
    ]);
    expect(result.tasks).toHaveLength(6);
    expect(result.documentType).toBe('msa-contract-first');
  });

  it('MSA frontend: fePackages expands `fe-system-*.md` per package', () => {
    const response = baseResponse({
      fePackages: ['web', 'admin'],
      tasks: [makeTask('fe-system-web.md', 0), makeTask('fe-system-admin.md', 1)],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['fe-system-*.md'],
      undefined,
      'generate',
    );

    expect(result.targetFiles).toEqual(['fe-system-web.md', 'fe-system-admin.md']);
    expect(result.tasks).toHaveLength(2);
    expect(result.documentType).toBe('msa-contract-first');
  });

  it('legacy path parity: `-main.md` input still triggers MSA expansion (pre-0f9ee7e4 path preserved)', () => {
    const response = baseResponse({
      services: ['auth', 'order'],
      tasks: [makeTask('be-system-auth.md', 0), makeTask('be-system-order.md', 1)],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-main.md'],
      undefined,
      'generate',
    );

    expect(result.targetFiles).toEqual(['be-system-auth.md', 'be-system-order.md']);
  });

  it('mixed wildcard + concrete: only wildcards collapse, concrete pass through', () => {
    const response = baseResponse({
      tasks: [makeTask('be-system-main.md', 0), makeTask('fe-system-main.md', 1)],
    });

    const result = validateAndFixTargetFiles(
      response,
      ['be-system-*.md', 'fe-system-main.md'],
      undefined,
      'generate',
    );

    expect(result.targetFiles).toEqual(['be-system-main.md', 'fe-system-main.md']);
  });
});
