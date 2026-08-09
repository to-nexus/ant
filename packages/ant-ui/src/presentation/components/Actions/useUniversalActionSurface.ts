/**
 * The universal (workspace) action surface — jobs and intents of the agent the
 * chat toolbar has selected, in chip form.
 *
 * Universal projects have no RAC and no action/intent matrix, so the canonical
 * `ACTION_DEFINITIONS` vocabulary is meaningless there: what a workspace agent
 * can do is `{agentId}/{jobId}`, refined by that job's own intent catalog. This
 * hook is the ONE derivation of that surface, consumed by both places the
 * actions vocabulary is offered — the panel and the chat empty state — so a
 * canonical chip can never leak into either.
 *
 * Both writes land on state the chat surface already owns: picking a job is
 * `selectCustomJob` (the toolbar's agent/job chips), arming an intent is
 * `@intent:` turn meta (the mention dropdown). Intents therefore TOGGLE — a
 * turn may carry several, and the selection clears when the turn is sent.
 */

import { useTranslation } from 'react-i18next';
import { Briefcase, Target } from 'lucide-react';
import { useStore } from '@/domain/store';
import type { ChipItem } from './ActionChipGrid';

export interface UniversalActionSurface {
  agentId: string | null;
  agentName: string;
  /** True once an agent with at least one job is selected — nothing to offer otherwise. */
  ready: boolean;
  jobs: Array<{ id: string; name: string }>;
  selectedJobId: string | null;
  jobChipItems: ChipItem[];
  intentChipItems: ChipItem[];
  selectJob: (jobId: string) => void;
  toggleIntent: (intentId: string) => void;
}

export function useUniversalActionSurface(): UniversalActionSurface {
  const { t } = useTranslation('actions');
  const customAgents = useStore((s) => s.customAgents);
  const selectedCustomAgentId = useStore((s) => s.selectedCustomAgentId);
  const selectedCustomJobId = useStore((s) => s.selectedCustomJobId);
  const selectCustomJob = useStore((s) => s.selectCustomJob);
  const armedIntents = useStore((s) => s.universalTurnMeta.intents);
  const addIntent = useStore((s) => s.addUniversalIntentMention);
  const removeIntent = useStore((s) => s.removeUniversalIntentMention);

  const agent = customAgents.find((a) => a.id === selectedCustomAgentId);
  const jobs = agent?.jobs ?? [];
  const job = jobs.find((j) => j.id === selectedCustomJobId);
  const intents = job?.intents ?? [];

  return {
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? '',
    ready: agent != null && jobs.length > 0,
    jobs: jobs.map((j) => ({ id: j.id, name: j.name })),
    selectedJobId: selectedCustomJobId ?? null,
    jobChipItems: jobs.map((j) => ({
      id: j.id,
      label: j.name,
      description: t('universal.jobIntentCount', {
        count: j.intents?.length ?? 0,
        defaultValue: '{{count}} intent(s)',
      }),
      icon: Briefcase,
    })),
    intentChipItems: intents.map((intent) => ({
      id: intent.id,
      label: intent.id,
      description: intent.description,
      icon: Target,
      selected: armedIntents.includes(intent.id),
    })),
    selectJob: (jobId: string) => {
      if (agent) selectCustomJob(agent.id, jobId);
    },
    toggleIntent: (intentId: string) =>
      armedIntents.includes(intentId) ? removeIntent(intentId) : addIntent(intentId),
  };
}
