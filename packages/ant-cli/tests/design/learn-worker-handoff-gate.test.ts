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
import { learn } from '../../src/agents/architect/graph/design/nodes/learn';

const BUNDLE_README = 'visual/game-art/handoff/project/design/README.md';

function fsWith(files: Record<string, string>) {
  const has = (p: string) => Object.keys(files).some((k) => p.endsWith(k));
  return {
    getRootPath: () => '/root',
    async fileExists(p: string): Promise<boolean> {
      return has(p);
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
});
