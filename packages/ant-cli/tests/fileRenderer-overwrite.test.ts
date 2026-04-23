/**
 * FileRenderer — overwrite diff metadata regression test.
 *
 * Guards the `<file>` tag overwrite path: when the streamed file was
 * "known at start" (already existed in the codebase), FileRenderer MUST
 * read the pre-write line count and include `diffBeforeLines` in the
 * `completeFileCreation` call. This is what lets FileCard render `+Y -X`
 * instead of a misleading bare `+Y` for overwrites (root cause of the
 * `lapis-bonding-fruit` navbar display bug).
 */

import { describe, it, expect } from 'vitest';
import { FileRenderer } from '../src/core/streaming/strategies/common/FileRenderer';
import { FileRegistry } from '../src/core/streaming/state/FileRegistry';

function makeChatAPIStub() {
  const calls: { method: string; args: any[] }[] = [];
  const record = (method: string) => (...args: any[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };
  return {
    startFileCreation: record('startFileCreation'),
    streamFileContent: record('streamFileContent'),
    completeFileCreation: record('completeFileCreation'),
    failFileCreation: record('failFileCreation'),
    showChatStatus: record('showChatStatus'),
    sendLLMEvent: record('sendLLMEvent'),
    calls,
  } as any;
}

function makeFsStub(files: Record<string, string>) {
  return {
    readFile: async (p: string) => files[p] ?? null,
    writeFile: async (p: string, c: string) => {
      files[p] = c;
    },
    fileExists: async (p: string) => p in files,
    deleteFile: async () => {},
    readDirectory: async () => [],
    createDirectory: async () => {},
    listFiles: async () => [],
    getRootPath: () => '/ws',
    getBasePath: () => '/ws',
  } as any;
}

function makeGitStub() {
  return {
    getRepoRoot: async () => '/ws/codebase',
  } as any;
}

async function streamFile(
  renderer: FileRenderer,
  registry: FileRegistry,
  filePath: string,
  body: string,
) {
  await renderer.renderFileStart(
    { data: { filePath, actionType: 'create' } } as any,
    registry,
  );
  await renderer.renderFileContent(
    { data: { filePath, content: body } } as any,
    registry,
  );
  await renderer.renderFileEnd(
    { data: { filePath } } as any,
    registry,
  );
}

describe('FileRenderer overwrite diff metadata', () => {
  it('includes diffBeforeLines when `<file>` overwrites an existing file', async () => {
    const chatAPI = makeChatAPIStub();
    const files: Record<string, string> = {
      'codebase/src/navbar.tsx': 'line1\nline2\nline3\nline4\nline5\n', // 6 lines incl. trailing ''
    };
    const fs = makeFsStub(files);

    const renderer = new FileRenderer({
      chatAPI,
      gitPort: makeGitStub(),
      fileSystem: fs,
      writeImmediately: true,
      jobType: 'code',
      codebasePath: '/ws/codebase',
    });

    const registry = new FileRegistry(
      new Set(['codebase/src/navbar.tsx']),
      fs,
      'codebase',
    );

    const newBody = 'new-l1\nnew-l2\nnew-l3\n';
    await streamFile(renderer, registry, 'codebase/src/navbar.tsx', newBody);
    await renderer.waitForAllFileOperations();

    const complete = chatAPI.calls.find((c: any) => c.method === 'completeFileCreation');
    expect(complete).toBeDefined();
    expect(complete.args[0]).toBe('codebase/src/navbar.tsx');
    expect(complete.args[2]).toEqual({ diffBeforeLines: 6 });
    expect(renderer.getFileErrors()).toEqual([]);
  });

  it('does NOT include diffBeforeLines for a true new file creation', async () => {
    const chatAPI = makeChatAPIStub();
    const files: Record<string, string> = {};
    const fs = makeFsStub(files);

    const renderer = new FileRenderer({
      chatAPI,
      gitPort: makeGitStub(),
      fileSystem: fs,
      writeImmediately: true,
      jobType: 'code',
      codebasePath: '/ws/codebase',
    });

    // Empty existingFiles set → isKnownAtStart returns false.
    const registry = new FileRegistry(new Set(), fs, 'codebase');

    await streamFile(renderer, registry, 'codebase/src/hero.tsx', 'a\nb\n');
    await renderer.waitForAllFileOperations();

    const complete = chatAPI.calls.find((c: any) => c.method === 'completeFileCreation');
    expect(complete).toBeDefined();
    // Third arg is the optional stats object — undefined for new creation.
    expect(complete.args[2]).toBeUndefined();
  });
});
