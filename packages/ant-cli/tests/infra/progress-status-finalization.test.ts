import { describe, expect, it, vi } from 'vitest';
import { handleListFiles } from '../../src/agents/common/tool/handlers/listFiles';
import { handleSearchReferenceCode } from '../../src/agents/common/tool/handlers/searchReferenceCode';

describe('progress status finalization', () => {
  it('listFiles removes listing_files progress when readDirectory throws', async () => {
    const showStatus = vi.fn(async () => 'listing-card');
    const removeStatus = vi.fn(async () => undefined);
    const readDirectory = vi.fn(async () => {
      throw new Error('readDirectory failed');
    });

    const ctx = {
      fileSystem: {
        getRootPath: () => '/tmp/workspace',
        readDirectory,
      },
      chatStatus: {
        showStatus,
        removeStatus,
      },
      workingDir: '/tmp/workspace',
    } as any;

    const result = await handleListFiles(ctx, { directory: 'codebase' });

    expect(result.error).toContain('readDirectory failed');
    expect(removeStatus).toHaveBeenCalledWith('listing-card', 'listing_files');
  });

  it('searchReferenceCode chains merge indexes for searched_reference and explored statuses', async () => {
    const showStatus = vi.fn(async (key: string) => {
      if (key === 'searching_reference') return 'searching-card';
      if (key === 'exploring') return 'exploring-card';
      return undefined;
    });

    const ctx = {
      chatStatus: { showStatus },
      referenceRequests: [{ project: 'reference-repo' }],
      retriever: {
        retrieve: vi.fn(async () => ({
          code: 'export const x = 1;',
          stats: { filesLoaded: 2, estimatedTokens: 10 },
          files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }],
        })),
      },
      vectorDB: {},
      git: {},
      workspaceResolver: {
        getCodebasePath: () => '/tmp/reference-repo/codebase',
      },
      userId: 'u',
      organizationId: 'o',
      resolvedActionMode: 'generate',
      workingDir: '/tmp/workspace',
      fileSystem: { getRootPath: () => '/tmp/workspace' },
    } as any;

    const result = await handleSearchReferenceCode(ctx, {
      project: 'reference-repo',
      query: 'query',
    });

    expect(result.error).toBeUndefined();
    expect(showStatus).toHaveBeenCalledWith(
      'searched_reference',
      expect.objectContaining({
        project: 'reference-repo',
        filesCount: 2,
        _mergeIndex: 'searching-card',
      }),
    );
    expect(showStatus).toHaveBeenCalledWith(
      'explored',
      expect.objectContaining({
        filesCount: 2,
        _mergeIndex: 'exploring-card',
      }),
    );
  });

  it('searchReferenceCode emits searched_reference terminal on error with merge index', async () => {
    const showStatus = vi.fn(async (key: string) => {
      if (key === 'searching_reference') return 'searching-card';
      return undefined;
    });

    const ctx = {
      chatStatus: { showStatus },
      referenceRequests: [{ project: 'reference-repo' }],
      retriever: {
        retrieve: vi.fn(async () => {
          throw new Error('retriever failed');
        }),
      },
      vectorDB: {},
      git: {},
      workspaceResolver: {
        getCodebasePath: () => '/tmp/reference-repo/codebase',
      },
      userId: 'u',
      organizationId: 'o',
      resolvedActionMode: 'generate',
      workingDir: '/tmp/workspace',
      fileSystem: { getRootPath: () => '/tmp/workspace' },
    } as any;

    const result = await handleSearchReferenceCode(ctx, {
      project: 'reference-repo',
      query: 'query',
    });

    expect(result.error).toContain('retriever failed');
    expect(showStatus).toHaveBeenCalledWith(
      'searched_reference',
      expect.objectContaining({
        project: 'reference-repo',
        filesCount: 0,
        _mergeIndex: 'searching-card',
      }),
    );
  });
});
