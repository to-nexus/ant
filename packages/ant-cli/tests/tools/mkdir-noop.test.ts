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
