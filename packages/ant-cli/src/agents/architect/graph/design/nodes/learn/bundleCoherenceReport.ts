/**
 * Job-level handoff bundle coherence report.
 *
 * Sits beside the DESIGN.md existence floor in `learn`, but with deliberately
 * different severity: it NEVER throws. The floor's throw is justified because a
 * bundle with no root guide is unreadable by the code job at all; "17 real files
 * whose names don't bind" is not worth destroying a completed job's session
 * checkpoint and usage flush (the floor throws before `saveSessionRun`, `endJob`
 * and `flushUsageSnapshot`).
 *
 * `observable-fallback` is satisfied by making the degraded state distinguishable
 * on four channels — console, the ExecutionLogger violation record, chat prose,
 * and the distilled turn hint the next resolve reads. The behaviour this replaces
 * (19 files, "success", nothing said) was the actual violation; a throw would
 * merely trade a silent failure for a destroyed one.
 */
import type { FileSystemPort } from '../../../../../../core/ports/filesystem';
import { getExecutionLogger } from '../../../../../../core/utils/executionLogger';
import {
  evaluateBundleCoherence,
  loadHandoffBundleFiles,
  formatCoherenceReport,
  type BundleCoherenceReport,
} from '../../../../../../infrastructure/workspace/handoffBundleCoherence';

export async function reportHandoffBundleCoherence(opts: {
  fileSystem: Pick<FileSystemPort, 'listFiles' | 'readFile'> | undefined;
  /** Already-resolved bundle directory (workspace-relative in this call site). */
  bundleDirRel: string | undefined;
  /** Both required to open the job's execution log; absent → console + chat only. */
  featurePath?: string;
  jobId?: string;
}): Promise<BundleCoherenceReport | null> {
  const { fileSystem, bundleDirRel } = opts;
  if (!fileSystem || !bundleDirRel) return null;

  try {
    const { files, skipped } = await loadHandoffBundleFiles(fileSystem, bundleDirRel);
    const report = skipped
      ? { ok: true, findings: [], hardCount: 0, warnCount: 0, inspected: files.length, skipped }
      : evaluateBundleCoherence(files);

    if (report.skipped) {
      console.warn(`⚠️ [Learn] Bundle coherence not checked (${report.skipped.reason}): ${report.skipped.detail}`);
      return report;
    }
    if (report.findings.length === 0) {
      console.log(`✅ [Learn] Bundle coherence clean (${report.inspected} files under ${bundleDirRel})`);
      return report;
    }

    const rendered = formatCoherenceReport(report, { bundleDir: bundleDirRel });
    if (report.hardCount > 0) console.error(`❌ [Learn] ${rendered}`);
    else console.warn(`⚠️ [Learn] ${rendered}`);

    if (opts.featurePath && opts.jobId) {
      // Best-effort — the console + chat channels already carry the signal.
      void getExecutionLogger({ featurePath: opts.featurePath, jobId: opts.jobId, jobType: 'design' })
        .logViolation('(bundle)', {
          violationType: 'bundle_coherence',
          message: rendered,
          retryCount: 0,
        })
        .catch(() => undefined);
    }

    return report;
  } catch (error) {
    console.warn(`⚠️ [Learn] Bundle coherence check errored: ${(error as Error).message}`);
    return null;
  }
}

/** One-line hint (≤120 chars) for the distilled turn record. */
export function coherenceOutcomeHint(report: BundleCoherenceReport | null): string | undefined {
  if (!report || report.hardCount === 0) return undefined;
  const files = [...new Set(report.findings.filter(f => f.severity === 'hard').map(f => f.file))];
  const shown = files.slice(0, 3).join(', ');
  const more = files.length > 3 ? ` +${files.length - 3} more` : '';
  return `Bundle has unbound names in ${files.length} file(s): ${shown}${more}`.slice(0, 120);
}
