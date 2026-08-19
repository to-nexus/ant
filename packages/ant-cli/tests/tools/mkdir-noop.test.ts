/**
 * mkdir handler — honest no-op signal (oat-judging-mound RCA).
 *
 * `FileSystemAdapter.createDirectory` is `fs.mkdir(recursive: true)`, which
 * never fails on an existing directory. Before this guard the handler
 * returned "Directory created: <path>" unconditionally, so a repeated mkdir
 * read as fresh progress and sustained a no-output loop until the design
 * breaker fired (4× `mkdir architecture/spec`, each answered with a fake
 * creation success). The handler must distinguish creation from a no-op.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleMkdir } from '../../src/agents/common/tool/handlers/mkdir';
import { FileSystemAdapter } from '../../src/periphery/adapters/filesystem/FileSystemAdapter';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

function makeCtx(workspacePath: string): ToolExecutionContext {
  const noop = async () => undefined as any;
  return {
    fileSystem: new FileSystemAdapter(workspacePath),
    chatStatus: new Proxy({}, { get: () => noop }) as ToolExecutionContext['chatStatus'],
    workingDir: workspacePath,
  };
}

let workspacePath: string;

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-mkdir-noop-'));
});

afterEach(() => {
  if (workspacePath) fs.rmSync(workspacePath, { recursive: true, force: true });
});

describe('handleMkdir — creation vs no-op', () => {
  it('reports creation for a new directory', async () => {
    const result = await handleMkdir(makeCtx(workspacePath), { path: 'architecture/spec' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Directory created');
    expect(fs.existsSync(path.join(workspacePath, 'architecture/spec'))).toBe(true);
  });

  it('reports "already exists (no-op)" for an existing directory instead of a fake creation', async () => {
    fs.mkdirSync(path.join(workspacePath, 'architecture/spec'), { recursive: true });
    const result = await handleMkdir(makeCtx(workspacePath), { path: 'architecture/spec' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('already exists (no-op)');
    expect(result.content).not.toContain('Directory created');
  });
});

/**
 * `directoryCreated` is the channel that refreshes the FE file tree:
 * ToolOrchestrator is the single owner of `notifyFileTreeUpdate` and decides
 * from `sideEffects`. Before this, mkdir emitted nothing at all, so a
 * workspace-project output written into a NEW root-level directory needed a
 * browser refresh to appear.
 *
 * Asserted as a side effect, not via a notify spy: the handler no longer
 * notifies, and the side effect IS the contract the orchestrator consumes.
 */
describe('handleMkdir — tree-mutation side effect', () => {
  it('emits directoryCreated for a real creation', async () => {
    const result = await handleMkdir(makeCtx(workspacePath), { path: 'architecture/system' });
    expect(result.sideEffects).toEqual([{ type: 'directoryCreated', path: 'architecture/system' }]);
  });

  it('emits nothing on the no-op path, so a repeated mkdir costs no tree walk', async () => {
    fs.mkdirSync(path.join(workspacePath, 'architecture/system'), { recursive: true });
    const result = await handleMkdir(makeCtx(workspacePath), { path: 'architecture/system' });
    expect(result.sideEffects).toBeUndefined();
  });
});
