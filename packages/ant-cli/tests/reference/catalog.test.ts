/**
 * buildReferenceCatalog — enumerates sibling projects + refs, excludes current.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { buildReferenceCatalog } from '../../src/agents/common/tool/reference/catalog';
import { hasReferenceSurface } from '../../src/agents/common/tool/reference/gate';

const uc = { userId: 'u', organizationId: 'o' };
let base: string;
let wr: UnifiedWorkspaceResolver;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-catalog-'));
  fs.mkdirSync(path.join(base, 'o', 'u', 'be', 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(base, 'o', 'u', 'be', 'features', 'dev', 'codebase'), { recursive: true });
  fs.mkdirSync(path.join(base, 'o', 'u', 'app', 'codebase'), { recursive: true });
  wr = new UnifiedWorkspaceResolver(base);
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('buildReferenceCatalog', () => {
  it('lists sibling projects and excludes the current one', async () => {
    const catalog = await buildReferenceCatalog(wr, uc, { excludeProject: 'app' });
    const names = catalog.map((c) => c.project);
    expect(names).toContain('be');
    expect(names).not.toContain('app');
  });

  it('offers main + feature branches', async () => {
    const catalog = await buildReferenceCatalog(wr, uc, { excludeProject: 'app' });
    const be = catalog.find((c) => c.project === 'be');
    expect(be?.branches).toEqual(expect.arrayContaining(['main', 'feature/dev']));
  });

  it('hasReferenceSurface is true when a sibling exists', async () => {
    const state = { deps: { workspaceResolver: wr }, context: { ...uc, projectName: 'app' } };
    expect(await hasReferenceSurface(state)).toBe(true);
  });

  it('hasReferenceSurface is false when the only project is the current one', async () => {
    const solo = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-solo-'));
    fs.mkdirSync(path.join(solo, 'o', 'u', 'app', 'codebase'), { recursive: true });
    const soloWr = new UnifiedWorkspaceResolver(solo);
    const state = { deps: { workspaceResolver: soloWr }, context: { ...uc, projectName: 'app' } };
    expect(await hasReferenceSurface(state)).toBe(false);
    fs.rmSync(solo, { recursive: true, force: true });
  });
});
