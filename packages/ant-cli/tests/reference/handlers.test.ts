/**
 * Reference handler behavior — register emits a side-effect; read/list gate on
 * registration; a registered read returns real file content.
 *
 * New model: no {project}/codebase main worktree — the default branchBase
 * ('main') resolves to the feature worktree {project}/features/main/codebase.
 * An omitted branch defaults to the connection-linked feature name verbatim
 * (no `feature/` prefix), and the connection scan only runs when
 * ctx.featureFolder is set.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { UnifiedWorkspaceResolver } from '../../src/core/config/WorkspacePathResolver';
import { handleRegisterReference } from '../../src/agents/common/tool/handlers/registerReference';
import { handleReadReferenceFile } from '../../src/agents/common/tool/handlers/readReferenceFile';
import { handleListReferenceFiles } from '../../src/agents/common/tool/handlers/listReferenceFiles';

const noopChatStatus: any = {
  showStatus: async () => undefined,
  removeStatus: async () => undefined,
  addReadingFile: async () => undefined,
  addReadComplete: async () => undefined,
};

let base: string;
let wr: UnifiedWorkspaceResolver;

function ctx(referenceRequests: any[] = [], project?: string, featureFolder?: string): any {
  return {
    fileSystem: undefined,
    chatStatus: noopChatStatus,
    workingDir: base,
    workspaceResolver: wr,
    userId: 'u',
    organizationId: 'o',
    project,
    featureFolder,
    referenceRequests,
  };
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-handlers-'));
  // "be" has a feature named 'main' (the default branchBase target).
  const beMain = path.join(base, 'o', 'u', 'be', 'features', 'main', 'codebase');
  fs.mkdirSync(beMain, { recursive: true });
  fs.writeFileSync(path.join(beMain, 'api.ts'), 'export const PORT = 4000;\n');
  fs.mkdirSync(path.join(base, 'o', 'u', 'app', 'features', 'main', 'codebase'), {
    recursive: true,
  });
  wr = new UnifiedWorkspaceResolver(base);
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('reference handlers', () => {
  it('register_reference emits a referenceRegistered side-effect', async () => {
    const r = await handleRegisterReference(ctx(), { project: 'be' });
    expect(r.error).toBeUndefined();
    expect(r.sideEffects).toEqual([{ type: 'referenceRegistered', project: 'be', branch: undefined }]);
  });

  it('register_reference rejects a project outside the tenant', async () => {
    const r = await handleRegisterReference(ctx(), { project: 'ghost' });
    expect(r.error).toBeTruthy();
    expect(r.sideEffects).toBeUndefined();
  });

  it('register_reference rejects registering the current project (self)', async () => {
    const r = await handleRegisterReference(ctx([], 'be'), { project: 'be' });
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('current project');
    expect(r.sideEffects).toBeUndefined();
  });

  it('register_reference defaults an omitted branch to the connection-linked feature', async () => {
    // Current project "app" (feature 'main') links to sibling "be" at feature
    // "dev" via @connection.
    const appCodebase = path.join(base, 'o', 'u', 'app', 'features', 'main', 'codebase');
    fs.writeFileSync(
      path.join(appCodebase, '.env.example'),
      '# @connection business backend ant-project:be:dev\nBACKEND_URL=\n',
    );
    // A "dev" worktree for "be" so the branch resolves dir-mode on disk.
    const beDev = path.join(base, 'o', 'u', 'be', 'features', 'dev', 'codebase');
    fs.mkdirSync(beDev, { recursive: true });
    fs.writeFileSync(path.join(beDev, 'marker.ts'), 'export const X = 1;\n');

    const r = await handleRegisterReference(ctx([], 'app', 'main'), { project: 'be' });
    expect(r.error).toBeUndefined();
    // Feature name verbatim — no `feature/` prefix.
    expect(r.sideEffects).toEqual([
      { type: 'referenceRegistered', project: 'be', branch: 'dev' },
    ]);
  });

  it('register_reference skips the connection scan when ctx.featureFolder is unset', async () => {
    // Same @connection annotation exists on disk, but without featureFolder the
    // scan must not run — the branch falls through to the target's branchBase.
    const r = await handleRegisterReference(ctx([], 'app'), { project: 'be' });
    expect(r.error).toBeUndefined();
    expect(r.sideEffects).toEqual([
      { type: 'referenceRegistered', project: 'be', branch: undefined },
    ]);
  });

  it('read_reference_file errors when the project is not registered', async () => {
    const r = await handleReadReferenceFile(ctx([]), { project: 'be', path: 'api.ts' });
    expect(r.error).toContain('not registered');
  });

  it('read_reference_file returns content once registered', async () => {
    const r = await handleReadReferenceFile(ctx([{ project: 'be' }]), { project: 'be', path: 'api.ts' });
    expect(r.error).toBeUndefined();
    expect(String(r.content)).toContain('PORT = 4000');
  });

  it('list_reference_files lists the registered project root', async () => {
    const r = await handleListReferenceFiles(ctx([{ project: 'be' }]), { project: 'be' });
    expect(String(r.content)).toContain('api.ts');
  });
});
