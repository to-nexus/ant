/**
 * Cross-intent PRD sync — design-job task creation.
 *
 * Design mirror of the code-job path (see
 * `code/nodes/decompose/{responseParser,index}.ts`): when a design job's
 * directive asks to ALSO keep the related planning doc(s) in sync, the decompose
 * LLM emits `<prdSync>{ "targets": ["plan/prd.md"], ... }</prdSync>`, and a
 * single-owner `doc` task rewrites those docs after the authoring work settles.
 *
 * Two divergences from the code path, both forced by the design write model:
 *   1. **One task per target file.** Design execute pins exactly one
 *      `expectedTargetFile` per task (`design/nodes/execute/index.ts`), so a
 *      multi-target sync is one task per doc — not the code job's single
 *      multi-target task.
 *   2. **`targetDir: 'plan'` override.** `designDirOf('prd.md')` would misroute
 *      to `architecture/system`; the explicit `targetDir` places the write under
 *      `plan/` (the same override spec / handoff tasks use).
 *
 * The write lands via the file tool handlers on the granted `plan/*.md`
 * path as a full overwrite of the current doc.
 */

import type { DesignTask, TaskQueue } from '../../../../types/task';
import type { ArtifactPoolView } from '../../../../../../core/prompt/builder/ArtifactPipeline';

/** `plan/<name>.md` — the only shape a sync target may take. */
const PLAN_DOC_RE = /^plan\/[^/]+\.md$/;

/**
 * Validate + normalize the `<prdSync>` decision parsed off a design decompose
 * response. Mirrors the code parser's contract: a target must be a `plan/*.md`
 * path AND present in the artifact pool (the current doc content is injected
 * from there for the surgical rewrite). Invalid / absent targets are dropped —
 * an empty result means "no sync".
 */
export function resolvePrdSyncTargets(
  rawPrdSync: unknown,
  pool: ArtifactPoolView,
): string[] {
  const targets = (rawPrdSync as { targets?: unknown } | null | undefined)?.targets;
  if (!Array.isArray(targets)) return [];
  const poolPaths = new Set(pool.all.map((a) => a.path));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of targets) {
    if (typeof t !== 'string' || !PLAN_DOC_RE.test(t) || !poolPaths.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Append one single-owner PRD-sync `doc` task per target file to the design
 * task queue. Each task:
 *   - carries the write grant (`prdSyncTargets`) scoped to its own doc;
 *   - includes its target so the current doc content is injected for a surgical
 *     full rewrite;
 *   - is `exclusive` and priced ABOVE every existing task, so the orchestrator
 *     runs it LAST and alone (it reconciles against the settled design output).
 *     `TaskOrchestrator` holds an exclusive head until `runningTasks` drains, so
 *     ordering is guaranteed in both sequential and parallel modes.
 *
 * No-op when `targets` is empty.
 */
export function appendPrdSyncTasks(
  taskQueue: TaskQueue<DesignTask>,
  targets: string[],
): void {
  if (targets.length === 0) return;

  const maxPriority = taskQueue.getAll().reduce((m, t) => Math.max(m, t.priority), 0);
  const base = maxPriority + 100;

  targets.forEach((target, i) => {
    const basename = target.split('/').pop() ?? target;
    taskQueue.push({
      id: `prd-sync-${i}`,
      name: 'Sync planning docs',
      type: 'doc',
      priority: base + i,
      description:
        `Update the planning document (${target}) so it reflects the changes this design job made, per the user's directive. ` +
        `Surgically update ONLY the sections the changes affect; preserve all unrelated content verbatim.`,
      // `targetDir: 'plan'` — avoids the `designDirOf` misroute (see file header).
      targetFile: basename,
      targetDir: 'plan',
      include: [target],
      prdSyncTargets: [target],
      exclusive: true,
      completed: false,
    } as DesignTask);
    console.log(`📝 [DesignDecompose] Appended PRD-sync doc task → ${target} (priority ${base + i})`);
  });
}
