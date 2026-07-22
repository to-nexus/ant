/**
 * Cross-intent PRD sync — design-job task creation (deferred half of req 5).
 *
 * Covers the pure logic of the design-side sync helper:
 *   - target validation (plan/*.md AND present in pool)
 *   - one exclusive sync task per target, priced ABOVE existing tasks
 *   - targetDir='plan' override + prdSyncTargets grant (the write-gate key)
 *
 * The FileRenderer overwrite branch + design execute dispatch are covered by
 * the existing write-path tests and typecheck; this test locks the decompose
 * contract that feeds them.
 */
import { describe, it, expect } from 'vitest';
import { ArtifactPoolView } from '../../src/core/artifact/ArtifactPipeline';
import { TaskQueue } from '../../src/agents/architect/types/task';
import type { DesignTask } from '../../src/agents/architect/types/task';
import {
  resolvePrdSyncTargets,
  appendPrdSyncTasks,
} from '../../src/agents/architect/graph/design/nodes/decompose/prdSync';
import { isPrdSyncTask } from '@ant/shared';

function poolOf(paths: string[]): ArtifactPoolView {
  return new ArtifactPoolView(
    paths.map((p) => ({ path: p, role: 'context' as const, content: '# doc' })),
  );
}

function queueWith(priorities: number[]): TaskQueue<DesignTask> {
  const q = new TaskQueue<DesignTask>();
  priorities.forEach((p, i) =>
    q.push({ id: `t${i}`, name: `t${i}`, type: 'doc', priority: p, description: '' } as DesignTask),
  );
  return q;
}

describe('resolvePrdSyncTargets', () => {
  const pool = poolOf(['plan/prd.md', 'plan/tech-constraints.md', 'architecture/system/be-system-main.md']);

  it('keeps plan/*.md targets present in the pool', () => {
    expect(resolvePrdSyncTargets({ targets: ['plan/prd.md'] }, pool)).toEqual(['plan/prd.md']);
    expect(
      resolvePrdSyncTargets({ targets: ['plan/prd.md', 'plan/tech-constraints.md'] }, pool),
    ).toEqual(['plan/prd.md', 'plan/tech-constraints.md']);
  });

  it('drops non-plan paths, nested plan paths, and pool-absent targets', () => {
    expect(resolvePrdSyncTargets({ targets: ['architecture/system/be-system-main.md'] }, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({ targets: ['plan/sub/nested.md'] }, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({ targets: ['plan/absent.md'] }, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({ targets: ['plan/prd.txt'] }, pool)).toEqual([]);
  });

  it('dedupes and tolerates malformed input', () => {
    expect(resolvePrdSyncTargets({ targets: ['plan/prd.md', 'plan/prd.md'] }, pool)).toEqual(['plan/prd.md']);
    expect(resolvePrdSyncTargets(undefined, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({}, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({ targets: 'plan/prd.md' }, pool)).toEqual([]);
    expect(resolvePrdSyncTargets({ targets: [1, null, 'plan/prd.md'] }, pool)).toEqual(['plan/prd.md']);
  });
});

describe('appendPrdSyncTasks', () => {
  it('is a no-op for empty targets', () => {
    const q = queueWith([200, 250]);
    appendPrdSyncTasks(q, []);
    expect(q.size()).toBe(2);
  });

  it('appends one exclusive sync task per target, priced above all existing tasks', () => {
    const q = queueWith([200, 250, 260]);
    appendPrdSyncTasks(q, ['plan/prd.md', 'plan/tech-constraints.md']);

    const all = q.getAll();
    const sync = all.filter((t) => isPrdSyncTask(t));
    expect(sync).toHaveLength(2);

    for (const t of sync) {
      expect(t.type).toBe('doc');
      expect(t.exclusive).toBe(true);
      expect(t.targetDir).toBe('plan');
      // priced strictly above the max existing authoring priority (260)
      expect(t.priority).toBeGreaterThan(260);
    }

    // one task per doc, each granting + targeting exactly its own file
    const prd = sync.find((t) => t.prdSyncTargets?.[0] === 'plan/prd.md')!;
    expect(prd.targetFile).toBe('prd.md');
    expect(prd.include).toEqual(['plan/prd.md']);
    expect(prd.prdSyncTargets).toEqual(['plan/prd.md']);

    const tech = sync.find((t) => t.prdSyncTargets?.[0] === 'plan/tech-constraints.md')!;
    expect(tech.targetFile).toBe('tech-constraints.md');
  });

  it('sync task sorts LAST in the queue (runs after authoring)', () => {
    const q = queueWith([200, 900]); // an authoring task already at a high number
    appendPrdSyncTasks(q, ['plan/prd.md']);
    const all = q.getAll(); // TaskQueue keeps ascending priority order
    expect(isPrdSyncTask(all[all.length - 1])).toBe(true);
  });
});
