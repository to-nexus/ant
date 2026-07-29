/**
 * subagent_drain trace — report-delivery instrumentation (sage-causing-rover).
 *
 * The incident's second finding was two SETTLED reports that never appeared
 * in the parent plan conversation; the mechanism was undecidable post-hoc
 * because no delivery record exists outside the job-runner console. Every
 * drain/join site now writes a `subagent_drain` event into
 * `log-{jobId}.json`, so the next occurrence is diagnosable from the session
 * bundle alone: which ids were delivered, at which site, into which phase,
 * and how many children were still pending.
 *
 * Best-effort and non-blocking by contract — a logging failure must never
 * affect delivery itself.
 */

import { getExecutionLogger } from '../../../core/utils/executionLogger';
import { pendingFor } from './registry';
import type { SubagentEntry } from './types';

export function logSubagentDrain(args: {
  featurePath?: string;
  jobId?: string;
  /** Delivery seam that fired. */
  site: 'tool-drain' | 'join' | 'seal-drain';
  ownerKey: string;
  delivered: SubagentEntry[];
  orphanCount?: number;
  /** Parent phase at delivery time (e.g. `plan` / `execute`), when known. */
  phase?: string;
  taskId?: string;
}): void {
  const { featurePath, jobId } = args;
  if (!featurePath || !jobId) return;
  if (args.delivered.length === 0 && !args.orphanCount) return;
  try {
    void getExecutionLogger({ featurePath, jobId, jobType: 'subagent-trace' })
      .log(
        'subagent_drain',
        {
          site: args.site,
          ownerKey: args.ownerKey,
          deliveredIds: args.delivered.map((e) => e.id),
          deliveredStates: args.delivered.map((e) => e.result?.state ?? 'unknown'),
          orphanCount: args.orphanCount ?? 0,
          pendingCount: pendingFor(args.ownerKey).length,
          ...(args.phase ? { phase: args.phase } : {}),
        },
        args.taskId,
      )
      .catch(() => {
        /* non-blocking */
      });
  } catch {
    /* non-blocking */
  }
}
