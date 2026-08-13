/**
 * Universal execute-context selector — the ONE home for mapping the store's
 * universal selection onto `executeCodeJob` parameters.
 *
 * Every path that can start a universal job (chat submit, clarify-card
 * submit via runJob) reads THIS: a universal job must ride
 * `jobType: 'universal'` + `customJobRef` + `skipTriage`, or the BE would
 * start a canonical job against a workspace project.
 */
import { formatCustomJobRef } from '@ant/shared';
import type { UniversalSlice } from '../slices/universalSlice';

export interface UniversalExecuteContext {
  /** `{agentId}/{jobId}` — forwarded verbatim to executeCodeJob. */
  customJobRef: string;
  jobType: 'universal';
  agent: 'universal';
  /** Universal jobs are addressed explicitly — triage has nothing to infer. */
  skipTriage: true;
  /** Explicit `@intent:` mentions for the next run (undefined when none). */
  intents?: string[];
  /** Explicit `@ctx:` artifact paths for the next run (undefined when none). */
  context?: string[];
  /** `@plan` per-turn plan-mode request (undefined when off). */
  plan?: boolean;
}

/**
 * Returns the execute context when the project is universal AND a custom
 * (agent, job) pair is selected — else null (canonical path).
 */
export function selectUniversalExecuteContext(
  state: Pick<
    UniversalSlice,
    'projectType' | 'selectedCustomAgentId' | 'selectedCustomJobId' | 'universalTurnMeta'
  >,
): UniversalExecuteContext | null {
  if (state.projectType !== 'universal') return null;
  const { selectedCustomAgentId, selectedCustomJobId, universalTurnMeta } = state;
  if (!selectedCustomAgentId || !selectedCustomJobId) return null;
  return {
    customJobRef: formatCustomJobRef({ agentId: selectedCustomAgentId, jobId: selectedCustomJobId }),
    jobType: 'universal',
    agent: 'universal',
    skipTriage: true,
    intents: universalTurnMeta.intents.length > 0 ? [...universalTurnMeta.intents] : undefined,
    context: universalTurnMeta.context.length > 0 ? [...universalTurnMeta.context] : undefined,
    plan: universalTurnMeta.plan || undefined,
  };
}
