/**
 * Handoff structural revision (merge-then-delete) — plumbing locks.
 *
 * `task.removeFiles` deletions must propagate to the artifact pool: without
 * pruning, a deleted bundle file's resolve-time stub survives and poisons
 * later tasks' `include` loads with content that no longer exists on disk.
 * Both pool-merge sites (serial checkTaskStatus edge + parallel merge in
 * design/graph.ts) prune via the same `prunePoolPaths` SSOT.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { join } from 'path';
import { prunePoolPaths, appendOrUpdatePool } from '../../src/core/artifact/ArtifactPipeline';
import type { ResolvedArtifact } from '../../src/core/artifact/ArtifactPipeline';

const pool: ResolvedArtifact[] = [
  { path: 'visual/game-art/handoff/README.md', content: '# root', role: 'ref' },
  { path: 'visual/game-art/handoff/project/design/README.md', content: '# dup', role: 'ref' },
  { path: 'plan/prd-main.md', content: 'prd', role: 'context' },
] as ResolvedArtifact[];

describe('prunePoolPaths', () => {
  it('drops exactly the deleted paths and keeps everything else', () => {
    const pruned = prunePoolPaths(pool, ['visual/game-art/handoff/project/design/README.md']);
    expect(pruned.map((a) => a.path)).toEqual([
      'visual/game-art/handoff/README.md',
      'plan/prd-main.md',
    ]);
  });

  it('is a no-op for an empty deletion list and for unknown paths (idempotent)', () => {
    expect(prunePoolPaths(pool, [])).toBe(pool);
    const once = prunePoolPaths(pool, ['visual/game-art/handoff/ghost.md']);
    expect(once.map((a) => a.path)).toEqual(pool.map((a) => a.path));
    const twice = prunePoolPaths(
      prunePoolPaths(pool, ['visual/game-art/handoff/project/design/README.md']),
      ['visual/game-art/handoff/project/design/README.md'],
    );
    expect(twice).toHaveLength(2);
  });

  it('composes with appendOrUpdatePool the way the graph merge sites do (upsert then prune)', () => {
    const merged = prunePoolPaths(
      appendOrUpdatePool(pool, [
        { path: 'visual/game-art/handoff/README.md', content: '# merged root', role: 'ref' } as ResolvedArtifact,
      ]),
      ['visual/game-art/handoff/project/design/README.md'],
    );
    const root = merged.find((a) => a.path === 'visual/game-art/handoff/README.md');
    expect(root?.content).toBe('# merged root');
    expect(merged.some((a) => a.path.endsWith('project/design/README.md'))).toBe(false);
  });
});

describe('removeFiles pass-through — decompose parsers carry the field to the task queue', () => {
  // Source-level lock: both parsers must spread `removeFiles` into the pushed
  // task. Dropping the spread silently disables structural revision while the
  // gate + templates keep advertising it.
  const PARSERS = [
    'src/agents/architect/graph/design/nodes/decompose/gameArtDesignDecompose.ts',
    'src/agents/architect/graph/design/nodes/decompose/uiDesignDecompose.ts',
  ];
  for (const rel of PARSERS) {
    it(`${rel.includes('gameArt') ? 'game-art' : 'ui'} parser spreads removeFiles into taskQueue.push`, () => {
      const src = fs.readFileSync(join(__dirname, '../..', rel), 'utf-8');
      expect(src).toMatch(/removeFiles\?: string\[\]/);
      expect(src).toMatch(/\{ removeFiles: task\.removeFiles \}/);
    });
  }

  it('both graph merge sites prune removed bundle paths', () => {
    const src = fs.readFileSync(
      join(__dirname, '../..', 'src/agents/architect/graph/design/graph.ts'),
      'utf-8',
    );
    expect((src.match(/prunePoolPaths\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/collectRemovedBundlePaths\(\[state\.currentTask as DesignTask\]\)/);
    expect(src).toMatch(/collectRemovedBundlePaths\(result\.completedTasks\)/);
  });
});
