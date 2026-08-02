/**
 * Worker-context handoff learn gate (heavy-bearing-panda RCA).
 *
 * The design parallel worker subgraph reuses the job-level `learn` node per
 * task. `learn`'s handoff disk-load branch collected the file set exclusively
 * from `state.completedTasksDetails[].targetFile` — but that append happens
 * only in the serial main graph / orchestrator merge, never inside the worker
 * subgraph. So EVERY handoff worker task hit the zero-output phantom-success
 * gate ("No design files found …") immediately after completing, regardless
 * of what it wrote. Contract locked here: the file set is the union of
 * completed-task targetFiles AND `state.currentTask.targetFile` (the
 * just-completed task in worker context), deduplicated.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { learn } from '../../src/agents/architect/graph/design/nodes/learn';

const BUNDLE_README = 'visual/game-art/handoff/project/design/README.md';

function fsWith(files: Record<string, string>) {
  const has = (p: string) => Object.keys(files).some((k) => p.endsWith(k));
  return {
    getRootPath: () => '/root',
    async fileExists(p: string): Promise<boolean> {
      return has(p);
    },
    /** Workspace-relative recursive listing (featurePath '/root/feat' ⇒ 'feat/…'). */
    async listFiles(dir: string): Promise<string[]> {
      return Object.keys(files)
        .map((k) => (k.startsWith('feat/') ? k : `feat/${k}`))
        .filter((p) => p.startsWith(`${dir.replace(/\/+$/, '')}/`));
    },
    async readFile(p: string): Promise<string> {
      const hit = Object.keys(files).find((k) => p.endsWith(k));
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[hit];
    },
    async readDirectory(): Promise<never[]> {
      return [];
    },
    async writeFile(): Promise<void> {
      /* noop */
    },
  };
}

function workerHandoffState(overrides: Record<string, unknown> = {}) {
  return {
    recursionCount: 0,
    workerId: 1, // worker context — the RCA surface
    taskQueue: { getAll: () => [] },
    // Pool contains the handoff bundle ⇒ resolveReviseSubSource → 'handoff'
    artifacts: [{ path: BUNDLE_README, content: '# README', role: 'ref' }],
    resolvedAction: { intent: 'rev-game-art', intentGroup: 'design-game-art', mode: 'refactor' },
    context: { featurePath: '/root/feat', project: 'polyhedron', featureFolder: 'base' },
    currentTask: {
      id: 'game-art-handoff-readme',
      name: 'Design README',
      type: 'doc',
      priority: 110,
      description: 'update bundle guide',
      targetFile: 'project/design/README.md',
      targetDir: 'visual/game-art/handoff',
      docFormat: 'handoff',
    },
    completedTasksDetails: [],
    deps: { fileSystem: fsWith({ [BUNDLE_README]: '# README\ncontent\n' }) },
    ...overrides,
  } as never;
}

const UI_BUNDLE = 'visual/ui/handoff';

/**
 * `gen-ui-desc` / mode `generate` — the intent×mode pair the DESIGN.md root-guide
 * floor applies to. `workerId` decides the scope: worker (per task) vs job-terminal.
 */
function generateHandoffState(overrides: Record<string, unknown> = {}) {
  return {
    recursionCount: 0,
    taskQueue: { getAll: () => [] },
    artifacts: [],
    resolvedAction: { intent: 'gen-ui-desc', intentGroup: 'design-ui', mode: 'generate' },
    context: { featurePath: '/root/feat', project: 'ant-showcase', featureFolder: 'main' },
    currentTask: {
      id: 'ui-handoff-tokens-foundation',
      name: 'Foundation Design Tokens',
      type: 'doc',
      priority: 110,
      description: 'author the foundation token layer',
      targetFile: 'tokens/foundation.css',
      targetDir: UI_BUNDLE,
      docFormat: 'handoff',
    },
    completedTasksDetails: [],
    deps: { fileSystem: fsWith({ [`${UI_BUNDLE}/tokens/foundation.css`]: ':root{}\n' }) },
    ...overrides,
  } as never;
}

describe('learn — worker-context handoff gate (heavy-bearing-panda RCA)', () => {
  it('passes for a worker task whose targetFile exists on disk, even with empty completedTasksDetails', async () => {
    const result = (await learn(workerHandoffState())) as { files?: Array<{ path: string }> };
    const paths = (result.files || []).map((f) => f.path);
    expect(paths).toContain('visual/game-art/handoff/project/design/README.md');
  });

  it('still trips the zero-output gate when the targetFile is absent on disk and nothing completed', async () => {
    const state = workerHandoffState({
      deps: { fileSystem: fsWith({}) }, // bundle file missing — genuine no-output
    });
    await expect(learn(state)).rejects.toThrow(/No design files found/);
  });

  it('deduplicates when the current task is already in completedTasksDetails (serial parity)', async () => {
    const state = workerHandoffState({
      completedTasksDetails: [{ id: 'game-art-handoff-readme', targetFile: 'project/design/README.md' }],
    });
    const result = (await learn(state)) as { files?: Array<{ path: string }> };
    const paths = (result.files || []).map((f) => f.path);
    expect(paths.filter((p) => p.endsWith('README.md'))).toHaveLength(1);
  });

  it('a merge-then-delete task (removeFiles) completes normally — removed paths never enter the file set', async () => {
    const state = workerHandoffState({
      currentTask: {
        id: 'game-art-handoff-root-readme',
        name: 'Root README consolidation',
        type: 'doc',
        priority: 110,
        description: 'merge design/README into root README, delete the duplicate',
        targetFile: 'README.md',
        targetDir: 'visual/game-art/handoff',
        docFormat: 'handoff',
        removeFiles: ['project/design/README.md'],
      },
      // Survivor exists; the removed duplicate is already gone from disk.
      deps: { fileSystem: fsWith({ 'visual/game-art/handoff/README.md': '# Root guide\n' }) },
    });
    const result = (await learn(state)) as { files?: Array<{ path: string }> };
    const paths = (result.files || []).map((f) => f.path);
    expect(paths).toContain('visual/game-art/handoff/README.md');
    expect(paths.some((p) => p.endsWith('project/design/README.md'))).toBe(false);
  });
});

/**
 * DESIGN.md root-guide floor scope (velvet-feeding-ghost RCA).
 *
 * The floor is a JOB-level bundle-completeness invariant, but `learn` is also the
 * parallel worker subgraph's terminal node — where the loaded file set is just the
 * one task that finished. Evaluated there it asked "did THIS task write DESIGN.md?"
 * and failed every task except the root-guide one, killing the whole job. The
 * invariant belongs at job scope and reads the disk, not this turn's file set.
 */
describe('learn — handoff DESIGN.md floor scope (velvet-feeding-ghost RCA)', () => {
  it('a worker task that wrote its own file passes even though it is not the root guide', async () => {
    const result = (await learn(generateHandoffState({ workerId: 2 }))) as { files?: Array<{ path: string }> };
    const paths = (result.files || []).map((f) => f.path);
    expect(paths).toContain(`${UI_BUNDLE}/tokens/foundation.css`);
  });

  it('a worker task passes even when DESIGN.md is not on disk yet (guide task still running)', async () => {
    // Concurrency: the root-guide task shares the first barrier window, so an
    // absent DESIGN.md is the normal mid-run state, not a bundle defect.
    await expect(learn(generateHandoffState({ workerId: 2 }))).resolves.toBeDefined();
  });

  it('job scope passes when DESIGN.md exists on disk but was written in an earlier turn', async () => {
    const state = generateHandoffState({
      deps: {
        fileSystem: fsWith({
          [`${UI_BUNDLE}/tokens/foundation.css`]: ':root{}\n',
          [`${UI_BUNDLE}/DESIGN.md`]: '# Guide\n',
        }),
      },
      // Resume shape: this turn only re-ran the tokens task.
      completedTasksDetails: [{ id: 'ui-handoff-tokens-foundation', targetFile: 'tokens/foundation.css' }],
    });
    const result = (await learn(state)) as { files?: Array<{ path: string }> };
    expect((result.files || []).length).toBeGreaterThan(0);
  });

  it('job scope still fails loud when the bundle has no DESIGN.md on disk', async () => {
    const state = generateHandoffState({
      completedTasksDetails: [{ id: 'ui-handoff-tokens-foundation', targetFile: 'tokens/foundation.css' }],
    });
    await expect(learn(state)).rejects.toThrow(/missing DESIGN\.md/);
  });
});

/**
 * Bundle coherence report severity.
 *
 * Unlike the DESIGN.md floor above, this report NEVER throws: the floor's throw
 * is justified because a guide-less bundle is unreadable at all, whereas "real
 * files whose names don't bind" must not destroy a completed job's session
 * checkpoint and usage flush (the throw sits before saveSessionRun / endJob /
 * flushUsageSnapshot). The signal goes to console + execution log + chat + digest.
 */
describe('learn — bundle coherence report severity', () => {
  /** DESIGN.md present (floor satisfied) but a page references classes nothing declares. */
  const incoherentBundle = () => ({
    [`${UI_BUNDLE}/DESIGN.md`]: '# Guide\ncite `--ghost-token` here\n',
    [`${UI_BUNDLE}/tokens/foundation.css`]: ':root{--real:1px}\n',
    [`${UI_BUNDLE}/screens/home.html`]: `<div class="${Array.from({ length: 20 }, (_, i) => `ghost${i}`).join(' ')}"></div>`,
  });

  it('an incoherent bundle completes rather than throwing', async () => {
    const state = generateHandoffState({
      deps: { fileSystem: fsWith(incoherentBundle()) },
      currentTask: {
        id: 'ui-handoff-screen-home',
        name: 'Screen: Home',
        type: 'doc',
        priority: 300,
        description: 'author the home screen',
        targetFile: 'screens/home.html',
        targetDir: UI_BUNDLE,
        docFormat: 'handoff',
      },
      completedTasksDetails: [{ id: 'ui-handoff-screen-home', targetFile: 'screens/home.html' }],
    });
    await expect(learn(state)).resolves.toBeDefined();
  });

  it('an interrupted job is not reported on (a half-built bundle is expected to be incoherent)', async () => {
    const state = generateHandoffState({
      deps: { fileSystem: fsWith(incoherentBundle()) },
      interruption: { reason: 'tasks_failed', message: 'x', timestamp: '', canResume: true },
      completedTasksDetails: [{ id: 'ui-handoff-tokens-foundation', targetFile: 'tokens/foundation.css' }],
    });
    await expect(learn(state)).resolves.toBeDefined();
  });

  it('the call site is gated to job scope and non-interrupted turns', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/agents/architect/graph/design/nodes/learn/index.ts'),
      'utf-8',
    );
    expect(src).toContain('reportHandoffBundleCoherence(');
    expect(src).toMatch(
      /!_isWorkerContext && !hasEarlyTermination && handoffBundleDirRel/,
    );
    // The report must follow the floor, so a guide-less bundle still throws first.
    expect(src.indexOf('reportHandoffBundleCoherence(')).toBeGreaterThan(
      src.indexOf('is missing ${HANDOFF_ROOT_GUIDE}'),
    );
  });
});
