/**
 * Design completion output-gate — shared single-owner helper.
 *
 * Both design completion nodes call this ONE predicate (same ownership pattern
 * as `reconcileSpecDoc` / `assetValidation`):
 *   - serial   `design/graph.ts::checkTaskStatus`
 *   - parallel `design/parallel/workerGraph.ts::workerCheckTaskStatus`
 *
 * Root defect it closes (`heavy-bridging-onion`): a design execute phase that
 * degenerates into a read-only loop and is force-drained by the recursion /
 * no-output guard produced ZERO artifacts, yet completion marked the task
 * `_taskCompleted: true` — a phantom success. `learn` then scanned the target
 * dir, loaded PRE-EXISTING stale files, and reported "Design document created"
 * with the `spec_complete` "Start Development" card.
 *
 * The gate fails loud instead: when the run wrote no `<file>` for the task
 * (`_taskFilesWritten === 0`) AND the declared target is absent/empty on disk,
 * the task is NOT completed — a resumable `design_no_output` interruption is
 * raised so the user re-runs rather than building on stale specs.
 *
 * Retry authority (Retry Authority SSOT): `canResume` is declared here at the
 * interruption-creation site — phase nodes never re-judge it.
 */
import path from 'node:path';
import { designDirOf, type InterruptionDetails } from '@ant/shared';

interface OutputFileSystem {
  readFile(p: string): Promise<string>;
}

/**
 * True when the current task produced zero artifacts this run AND its declared
 * target file is absent (or empty) on disk. `targetMissing` keeps refactor /
 * append tasks (target already exists) and wrong-named-but-produced runs
 * (`_taskFilesWritten > 0`) from false-positives.
 */
export async function isNoOutputCompletion(
  fileSystem: OutputFileSystem | undefined,
  featurePath: string | undefined,
  task: { targetDir?: string; targetFile?: string } | undefined,
  taskFilesWritten: number | undefined,
): Promise<boolean> {
  if (!task?.targetFile || !featurePath || !fileSystem) return false;
  if ((taskFilesWritten || 0) > 0) return false; // produced something this run

  const dir = task.targetDir ?? designDirOf(task.targetFile);
  const filePath = path.join(featurePath, dir, task.targetFile);
  try {
    const content = await fileSystem.readFile(filePath);
    return !content || content.trim().length === 0; // exists but empty → no output
  } catch {
    return true; // ENOENT — target never written
  }
}

/**
 * Build the resumable `design_no_output` interruption. Shared so the serial
 * return and the parallel typed-error carry an identical shape/message.
 */
export function buildDesignNoOutputInterruption(
  task: { name?: string; targetFile?: string },
  opts: { callIndex?: number; completedCount?: number; tasksRemaining?: number },
): InterruptionDetails {
  const target = task.targetFile || task.name || 'the target document';
  return {
    reason: 'design_no_output',
    message:
      `Design execute produced no output for "${target}" — the model explored ` +
      `without ever writing the document (${opts.callIndex ?? 0} calls). Nothing was ` +
      `created. Re-run to continue; the earlier exploration is discarded.`,
    timestamp: new Date().toISOString(),
    canResume: true,
    metadata: {
      targetFile: task.targetFile,
      callIndex: opts.callIndex ?? 0,
      completedCount: opts.completedCount ?? 0,
      tasksRemaining: opts.tasksRemaining ?? 0,
    },
  };
}
