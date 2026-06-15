import { isNonTaskJob } from '@ant/shared';
import type { KanbanData } from '@/infrastructure/http/api';

type ReconvergeState = {
  selectedJobType?: string;
  activeJobs: Record<string, { status: string; agent?: string }>;
};

/**
 * Decide whether the live running job should re-converge the view identity
 * (`selectedJobType` / `selectedAgent`) to its own job type.
 *
 * Only the actively-running owner (`live` / `estimating`) converges, so a
 * passively-viewed past job never flips the toolbar. The
 * `data.jobType === selectedJobType` guard makes this fire ONCE per actual
 * divergence (not per broadcast) — after convergence every subsequent
 * broadcast of the same job is a no-op, so there is no loop and no fetch
 * storm (the applier is fetch-free).
 *
 * Invariant I4: a paused non-task job (plan / visual awaiting a clarify
 * answer) owns the identity and must NOT be stomped by a concurrent running
 * decomposable job — mirrors the feature-entry bootstrap priority.
 */
export function shouldReconvergeJobType(
  data: Pick<KanbanData, 'jobType' | 'dataSource'>,
  state: ReconvergeState,
): boolean {
  if (!data.jobType) return false;
  if (data.dataSource !== 'live' && data.dataSource !== 'estimating') return false;
  if (data.jobType === state.selectedJobType) return false;
  const current = state.activeJobs[state.selectedJobType ?? ''];
  if (current?.status === 'paused' && isNonTaskJob(state.selectedJobType ?? '')) return false;
  return true;
}

/**
 * Re-converge the chat identity to the live job via the `applyJobIdentity`
 * SSOT writer (which also updates `selectedAgent` and persistence), so the
 * toolbar, workflow graph, and job history all follow the board.
 */
export function reconvergeJobType(data: KanbanData, get: any): void {
  const state = get();
  if (!shouldReconvergeJobType(data, state)) return;
  const agent = state.activeJobs[data.jobType!]?.agent;
  get().applyJobIdentity({ jobType: data.jobType, agent });
}
