/**
 * Handoff bundle coherence gate — shared single-owner helper.
 *
 * Both design completion nodes call this ONE helper:
 *   - serial   `design/graph.ts::checkTaskStatus`
 *   - parallel `design/parallel/workerGraph.ts::workerCheckTaskStatus`
 *
 * Same reason as `assetValidation.ts`: a gate wired into the serial node only
 * silently never runs, because the default `ANT_TASK_CONCURRENCY > 1` routes
 * design tasks through the worker graph.
 *
 * What it catches: a bundle file that references a css custom property or class
 * name nothing in the bundle declares. Nothing crashes on such a miss — an
 * unresolved `var(--x)` falls back to `initial` and an unstyled class simply has
 * no rule — so without this gate a fully broken bundle completes green.
 *
 * Scoping is by PATH, not `task.priority`: priority is LLM-assigned and can
 * drift, whereas a bundle-relative path deterministically states which layer a
 * file belongs to. Checks run only where the scheduler makes them decidable.
 * Because findings report only MISSING references against the whole on-disk
 * symbol set, a scheduling surprise yields a false NEGATIVE (the job-level pass
 * in `learn` still catches it) — never a false positive.
 */
import path from 'node:path';
import type { FileSystemPort } from '../../../../../../core/ports/filesystem';
import {
  evaluateBundleCoherence,
  loadHandoffBundleFiles,
  type BundleCoherenceReport,
  type CoherenceCode,
} from '../../../../../../infrastructure/workspace/handoffBundleCoherence';

/** True for handoff-bundle authoring tasks (the ant-canonical JSON trio is out of scope). */
export function isHandoffBundleTask(task?: { docFormat?: string; targetFile?: string }): boolean {
  return task?.docFormat === 'handoff' && !!task.targetFile;
}

/**
 * Dependency stage of a bundle-relative path.
 *   1 authority — bundle-root files (DESIGN.md, styles.css) and `tokens/**`
 *   2 shared    — `components|entities/**.css`, `assets/**`, any Ring-3 dir
 *   3 consumer  — pages: `screens/**.html` and specimen `components|entities/**.html`
 */
export function bundleStageOf(bundleRelativePath: string): 1 | 2 | 3 {
  const posix = bundleRelativePath.split(path.sep).join('/');
  const isHtml = /\.html?$/i.test(posix);
  if (posix.startsWith('tokens/')) return 1;
  if (!posix.includes('/')) return 1;
  if (posix.startsWith('screens/')) return 3;
  if ((posix.startsWith('components/') || posix.startsWith('entities/')) && isHtml) return 3;
  return 2;
}

/** Checks the scheduler guarantees are decidable when this file's task completes. */
export function coherenceChecksForStage(stage: 1 | 2 | 3, bundleRelativePath: string): CoherenceCode[] {
  // Stage 1 siblings race each other (a token file may reference a property a
  // concurrent token file declares), and the guide is authored alongside them.
  if (stage === 1) return [];
  // A stage-2 specimen (only possible in a bundle whose decomposition predates
  // the stage split) cannot see its own `.css` yet.
  if (stage === 2) return /\.css$/i.test(bundleRelativePath) ? ['undefined-css-var'] : [];
  return ['undefined-css-var', 'unstyled-class'];
}

/**
 * Evaluate the bundle from the completing task's vantage point. Findings are
 * anchored to that task's own file only — a task is never blamed for a sibling.
 *
 * Shares the `path.join(featurePath, task.targetDir)` assembly convention with
 * `isNoOutputCompletion` / `designTargetExists`.
 */
export async function validateTaskBundleCoherence(
  fileSystem: Pick<FileSystemPort, 'listFiles' | 'readFile'> | undefined,
  featurePath: string | undefined,
  task: { targetFile?: string; targetDir?: string; docFormat?: string } | undefined,
): Promise<BundleCoherenceReport> {
  const clean: BundleCoherenceReport = { ok: true, findings: [], hardCount: 0, warnCount: 0, inspected: 0 };
  const targetFile = task?.targetFile;
  if (!fileSystem || !featurePath || !task || !targetFile || !task.targetDir) return clean;

  const stage = bundleStageOf(targetFile);
  const checks = coherenceChecksForStage(stage, targetFile);
  if (checks.length === 0) return clean;

  const { files, skipped } = await loadHandoffBundleFiles(
    fileSystem,
    path.join(featurePath, task.targetDir),
  );
  if (skipped) return { ...clean, skipped };

  return evaluateBundleCoherence(files, { only: [targetFile], checks });
}

/** Re-prompt appended to the execute conversation. Shared so serial/worker never drift. */
export function buildBundleCoherenceRetryMessage(
  report: BundleCoherenceReport,
  targetFile: string,
): string {
  const parts: string[] = [
    'VALIDATION FAILED — names referenced by this file are declared nowhere in the bundle.',
    `File: ${targetFile}`,
  ];

  for (const f of report.findings.filter(f => f.severity === 'hard')) {
    const sample = f.symbols.join(', ');
    const more = f.count > f.symbols.length ? ` (+${f.count - f.symbols.length} more)` : '';
    if (f.code === 'undefined-css-var') {
      parts.push(
        `${f.count} of ${f.total} custom properties are undeclared: ${sample}${more}`,
        'Call `read_file` on the token concern files, then bind ONLY to the property names they declare. '
          + 'Do not invent a parallel token vocabulary and do not hardcode the value.',
      );
    } else if (f.code === 'unstyled-class') {
      const families = f.families?.length ? ` Offending blocks: ${f.families.join(', ')}.` : '';
      parts.push(
        `${f.count} of ${f.total} class names have no rule anywhere: ${sample}${more}.${families}`,
        'Call `read_file` on the component stylesheet(s) this page composes and use the class names they declare. '
          + "Scaffolding used by this page alone belongs in this file's own `<style>` block.",
      );
    } else {
      parts.push(`${f.code}: ${f.reason} — ${sample}${more}`);
    }
  }

  parts.push('Rewrite the complete file with every name bound, then emit it in a single <file> block.');
  return parts.join('\n');
}
