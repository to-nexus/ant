/**
 * FileRenderer — codebase mutation gate via XML artifact tags.
 *
 * Locks the `<file>`/`<append>`/`<edit>`/`<delete>` path of the
 * codebase mutation gate (R6 of the gate plan): symmetric to the
 * tool-handler gate in `agents/common/tool/handlers/codebaseGate.ts`.
 *
 * Policy:
 *   - `code` + `codePhase: 'execute'` (default) → `codebase/` writes allowed.
 *   - `code` + `codePhase: 'plan'`              → `codebase/` writes rejected.
 *   - `design` / `planner`                      → `codebase/` writes rejected.
 *   - All jobs                                  → artifact paths allowed.
 *
 * Without R6 the streaming path bypasses the tool-handler gate; this
 * test pins both halves so `<file>`/`<append>`-style codebase escapes
 * cannot regress.
 */

import { describe, it, expect } from 'vitest';
import { FileRenderer } from '../../src/core/streaming/strategies/common/FileRenderer';
import { FileRegistry } from '../../src/core/streaming/state/FileRegistry';

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
    completeFileDeletion: record('completeFileDeletion'),
    completeFileEdit: record('completeFileEdit'),
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
    deleteFile: async (p: string) => {
      delete files[p];
    },
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

async function streamCreate(
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

describe('FileRenderer codebase mutation gate (XML artifact tags)', () => {
  describe('design job', () => {
    it('rejects <file> targeting codebase/ — write does NOT happen', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'design',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'codebase/src/foo.tsx', 'export const x = 1;\n');
      await renderer.waitForAllFileOperations();

      expect(files['codebase/src/foo.tsx']).toBeUndefined();
      expect(renderer.getFileErrors().length).toBeGreaterThan(0);
      expect(renderer.getFileErrors()[0]).toMatch(/codebase\//);
      expect(chatAPI.calls.some((c: any) => c.method === 'failFileCreation')).toBe(true);
    });

    it('allows <file> targeting architecture/ — write happens', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'design',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'architecture/spec/foo.md', '# Spec\nbody\n');
      await renderer.waitForAllFileOperations();

      expect(files['architecture/spec/foo.md']).toContain('# Spec');
      expect(renderer.getFileErrors()).toEqual([]);
    });
  });

  describe('planner job', () => {
    it('rejects <file> targeting codebase/', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'plan',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'codebase/src/x.ts', 'x\n');
      await renderer.waitForAllFileOperations();

      expect(files['codebase/src/x.ts']).toBeUndefined();
      expect(renderer.getFileErrors().length).toBeGreaterThan(0);
    });

    it('allows <file> targeting plan/', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'plan',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'plan/prd.md', '# PRD\n');
      await renderer.waitForAllFileOperations();

      expect(files['plan/prd.md']).toContain('# PRD');
      expect(renderer.getFileErrors()).toEqual([]);
    });
  });

  describe('code job — execute phase', () => {
    it('allows <file> targeting codebase/ (the canonical case)', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'code',
        codePhase: 'execute',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'codebase/src/foo.tsx', 'export const x = 1;\n');
      await renderer.waitForAllFileOperations();

      expect(files['codebase/src/foo.tsx']).toContain('export const x = 1;');
      expect(renderer.getFileErrors()).toEqual([]);
    });

    it('rejects <file> targeting architecture/ (legacy code-only-under-codebase guard)', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'code',
        codePhase: 'execute',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'architecture/spec/foo.md', 'body\n');
      await renderer.waitForAllFileOperations();

      expect(files['architecture/spec/foo.md']).toBeUndefined();
      expect(renderer.getFileErrors().length).toBeGreaterThan(0);
    });
  });

  describe('code job — plan phase', () => {
    it('rejects <file> targeting codebase/ (plan-phase artifact = the sealed plan, not source code)', async () => {
      const chatAPI = makeChatAPIStub();
      const files: Record<string, string> = {};
      const fs = makeFsStub(files);
      const renderer = new FileRenderer({
        chatAPI,
        gitPort: makeGitStub(),
        fileSystem: fs,
        writeImmediately: true,
        jobType: 'code',
        codePhase: 'plan',
        codebasePath: '/ws/codebase',
      });
      const registry = new FileRegistry(new Set(), fs, 'codebase');

      await streamCreate(renderer, registry, 'codebase/src/foo.tsx', 'export const x = 1;\n');
      await renderer.waitForAllFileOperations();

      expect(files['codebase/src/foo.tsx']).toBeUndefined();
      expect(renderer.getFileErrors().length).toBeGreaterThan(0);
    });
  });
});

/**
 * Deferred terminal file cards — `writeImmediately: false` phases.
 *
 * The terminal `file_create` line is the FE's "the bytes are readable at
 * `metadata.filePath`" contract: for plan/design jobs it promotes the
 * streaming preview into a real editor tab, which immediately GETs that path.
 * A renderer that wrote nothing must therefore not emit it — the planner's
 * execute node writes AFTER the stream (its `<file>` bodies are only complete
 * once the parser flushes), so an eager card made the preview fetch a file
 * that did not exist yet and render blank forever.
 *
 * The card also has to name the path actually written: the planner maps the
 * LLM-emitted path onto a declared target by basename, so `prd.md` lands at
 * `plan/prd.md`.
 */
describe('FileRenderer deferred terminal cards', () => {
  const deferredRenderer = (chatAPI: any) =>
    new FileRenderer({
      chatAPI,
      fileSystem: makeFsStub({}),
      writeImmediately: false,
      jobType: 'plan',
    });

  const terminalCalls = (chatAPI: any) =>
    chatAPI.calls.filter(
      (c: any) => c.method === 'completeFileCreation' || c.method === 'failFileCreation',
    );

  it('emits no terminal card at </file> when nothing was written', async () => {
    const chatAPI = makeChatAPIStub();
    const renderer = deferredRenderer(chatAPI);
    const registry = new FileRegistry(new Set(), makeFsStub({}), 'codebase');

    await streamCreate(renderer, registry, 'prd.md', '# PRD\nbody\n');
    await renderer.waitForAllFileOperations();

    expect(chatAPI.calls.some((c: any) => c.method === 'startFileCreation')).toBe(true);
    expect(terminalCalls(chatAPI)).toEqual([]);
  });

  it('flush reports the WRITTEN path while finalizing the card opened under the emitted path', async () => {
    const chatAPI = makeChatAPIStub();
    const renderer = deferredRenderer(chatAPI);
    const registry = new FileRegistry(new Set(), makeFsStub({}), 'codebase');

    await streamCreate(renderer, registry, 'prd.md', '# PRD\nbody\n');
    await renderer.waitForAllFileOperations();
    renderer.claimDeferredFileCardSettlement();
    await renderer.flushDeferredFileCards(new Map([['prd.md', 'plan/prd.md']]));

    const settled = terminalCalls(chatAPI);
    expect(settled).toHaveLength(1);
    expect(settled[0].method).toBe('completeFileCreation');
    // [reported path, content, stats] — `cardPath` keeps the pending card
    // registered at `<file>` open as the one finalized (no duplicate card).
    expect(settled[0].args[0]).toBe('plan/prd.md');
    expect(settled[0].args[1]).toContain('# PRD');
    expect(settled[0].args[2]?.cardPath).toBe('prd.md');
  });

  it('flush fails an unresolved path instead of claiming success', async () => {
    const chatAPI = makeChatAPIStub();
    const renderer = deferredRenderer(chatAPI);
    const registry = new FileRegistry(new Set(), makeFsStub({}), 'codebase');

    await streamCreate(renderer, registry, 'stray.md', 'body\n');
    await renderer.waitForAllFileOperations();
    renderer.claimDeferredFileCardSettlement();
    await renderer.flushDeferredFileCards(new Map([['stray.md', null]]));

    const settled = terminalCalls(chatAPI);
    expect(settled).toHaveLength(1);
    expect(settled[0].method).toBe('failFileCreation');
    expect(settled[0].args[0]).toBe('stray.md');
  });

  it('finalize fails an unclaimed owed card so the pending card never hangs', async () => {
    const chatAPI = makeChatAPIStub();
    const renderer = deferredRenderer(chatAPI);
    const registry = new FileRegistry(new Set(), makeFsStub({}), 'codebase');

    await streamCreate(renderer, registry, 'plan/prd.md', 'body\n');
    await renderer.waitForAllFileOperations();
    await renderer.finalize();

    const settled = terminalCalls(chatAPI);
    expect(settled).toHaveLength(1);
    expect(settled[0].method).toBe('failFileCreation');
  });

  it('a claim defers past finalize so the writer still settles it as success', async () => {
    const chatAPI = makeChatAPIStub();
    const renderer = deferredRenderer(chatAPI);
    const registry = new FileRegistry(new Set(), makeFsStub({}), 'codebase');

    await streamCreate(renderer, registry, 'prd.md', 'body\n');
    await renderer.waitForAllFileOperations();
    renderer.claimDeferredFileCardSettlement();
    await renderer.finalize();
    expect(terminalCalls(chatAPI)).toEqual([]);

    await renderer.flushDeferredFileCards(new Map([['prd.md', 'plan/prd.md']]));
    expect(terminalCalls(chatAPI).map((c: any) => c.method)).toEqual(['completeFileCreation']);
  });

  it('writeImmediately renderers still emit their terminal card inline', async () => {
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
    const registry = new FileRegistry(new Set(), fs, 'codebase');

    await streamCreate(renderer, registry, 'codebase/src/foo.tsx', 'export const x = 1;\n');
    await renderer.waitForAllFileOperations();

    expect(terminalCalls(chatAPI).map((c: any) => c.method)).toEqual(['completeFileCreation']);
  });
});
