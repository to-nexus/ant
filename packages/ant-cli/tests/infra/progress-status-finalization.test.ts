import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleListFiles } from '../../src/agents/common/tool/handlers/listFiles';
import { handleSearchReferenceCode } from '../../src/agents/common/tool/handlers/searchReferenceCode';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';

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

  // ── search_reference_code (ripgrep/git, no vector DB) ──
  let base: string;
  let wr: UnifiedWorkspaceResolver;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-status-'));
    const be = path.join(base, 'o', 'u', 'reference-repo', 'codebase');
    fs.mkdirSync(be, { recursive: true });
    fs.writeFileSync(path.join(be, 'a.ts'), 'export const x = 1;\n');
    wr = new UnifiedWorkspaceResolver(base);
  });

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  function refCtx(showStatus: any) {
    return {
      chatStatus: { showStatus },
      referenceRequests: [{ project: 'reference-repo' }],
      workspaceResolver: wr,
      userId: 'u',
      organizationId: 'o',
      workingDir: base,
    } as any;
  }

  it('searchReferenceCode emits searched_reference terminal with merge index on match', async () => {
    const showStatus = vi.fn(async (key: string) => (key === 'searching_reference' ? 'searching-card' : undefined));
    const result = await handleSearchReferenceCode(refCtx(showStatus), {
      project: 'reference-repo',
      pattern: 'const x',
    });

    expect(result.error).toBeUndefined();
    expect(showStatus).toHaveBeenCalledWith(
      'searched_reference',
      expect.objectContaining({ project: 'reference-repo', _mergeIndex: 'searching-card' }),
    );
  });

  it('searchReferenceCode emits searched_reference terminal on error with merge index', async () => {
    const showStatus = vi.fn(async (key: string) => (key === 'searching_reference' ? 'searching-card' : undefined));
    // Registered but not a real tenant project → resolve throws inside the try,
    // so the terminal searched_reference still fires with the merge index.
    const ctx = refCtx(showStatus);
    ctx.referenceRequests = [{ project: 'ghost' }];
    const result = await handleSearchReferenceCode(ctx, { project: 'ghost', pattern: 'x' });

    expect(result.error).toBeTruthy();
    expect(showStatus).toHaveBeenCalledWith(
      'searched_reference',
      expect.objectContaining({ project: 'ghost', filesCount: 0, _mergeIndex: 'searching-card' }),
    );
  });
});
