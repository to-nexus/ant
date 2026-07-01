/**
 * Reference handler behavior — register emits a side-effect; read/list gate on
 * registration; a registered read returns real file content.
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

function ctx(referenceRequests: any[] = []): any {
  return {
    fileSystem: undefined,
    chatStatus: noopChatStatus,
    workingDir: base,
    workspaceResolver: wr,
    userId: 'u',
    organizationId: 'o',
    referenceRequests,
  };
}

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-handlers-'));
  const be = path.join(base, 'o', 'u', 'be', 'codebase');
  fs.mkdirSync(be, { recursive: true });
  fs.writeFileSync(path.join(be, 'api.ts'), 'export const PORT = 4000;\n');
  fs.mkdirSync(path.join(base, 'o', 'u', 'app', 'codebase'), { recursive: true });
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
