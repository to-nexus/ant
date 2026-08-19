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
 * Picking a job lands on state the chat surface already owns
 * (`selectCustomJob` — the toolbar's agent/job chips). Intent chips NAVIGATE
 * to the intent-detail page (canonical parity); arming as an `@intent:`
 * mention happens there, via the footer's Chat/Build actions, and the chip's
 * `selected` ring mirrors `universalTurnMeta.intents`.
 */

import { useTranslation } from 'react-i18next';
import { Briefcase, Target } from 'lucide-react';
import type { CustomIntentDef } from '@ant/shared';
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
  /** The selected job’s full catalog (hooks/clarify/hasPrompt) — the detail view’s data. */
  intents: CustomIntentDef[];
  selectJob: (jobId: string) => void;
}

export function useUniversalActionSurface(): UniversalActionSurface {
  const { t } = useTranslation('actions');
  const customAgents = useStore((s) => s.customAgents);
  const selectedCustomAgentId = useStore((s) => s.selectedCustomAgentId);
  const selectedCustomJobId = useStore((s) => s.selectedCustomJobId);
  const selectCustomJob = useStore((s) => s.selectCustomJob);
  const armedIntents = useStore((s) => s.universalTurnMeta.intents);

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
    intents,
    selectJob: (jobId: string) => {
      if (agent) selectCustomJob(agent.id, jobId);
    },
  };
}
