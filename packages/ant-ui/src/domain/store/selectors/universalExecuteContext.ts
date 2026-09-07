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

/**
 * The Actions-tab Build button's wire params: the CURRENT turn meta with the
 * intent slot replaced by `intentId`. Build decides the intent and nothing
 * else — armed `@ctx` / `@plan` chips are the user's explicit input and ride
 * the run (resetting them before dispatch is how a Build lost the material it
 * was meant to work from). Pure: composes over the state, never writes it.
 */
export function selectUniversalBuildExecuteContext(
  state: Parameters<typeof selectUniversalExecuteContext>[0],
  intentId: string,
): UniversalExecuteContext | null {
  return selectUniversalExecuteContext({
    ...state,
    universalTurnMeta: { ...state.universalTurnMeta, intents: [intentId] },
  });
}
