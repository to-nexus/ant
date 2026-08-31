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
 * (`selectCustomJob` — the toolbar's agent/job chips). Picking an INTENT is one
 * atomic store write (`selectCustomIntent`): it arms the intent for the next
 * turn AND makes it the detail page's subject, so the chip's `selected` ring,
 * the composer's `UniversalTurnMetaBadges` chip and the open detail page can
 * never disagree. Canonical parity — `ActionsPanel.handleIntentSelect` calls
 * `selectIntent` and then routes the step; arming is NOT the footer's job (its
 * Chat button only RESTORES the pin after a disarm or a send, and focuses the
 * composer).
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
  /** Pick an intent: arms it for the next turn AND makes it the detail subject. */
  selectIntent: (intentId: string) => void;
}

export function useUniversalActionSurface(): UniversalActionSurface {
  const { t } = useTranslation('actions');
  const customAgents = useStore((s) => s.customAgents);
  const selectedCustomAgentId = useStore((s) => s.selectedCustomAgentId);
  const selectedCustomJobId = useStore((s) => s.selectedCustomJobId);
  const selectCustomJob = useStore((s) => s.selectCustomJob);
  const selectCustomIntent = useStore((s) => s.selectCustomIntent);
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
    // No subtitle: an intent's `infer` criterion is prompt text (rendered into
    // the Intent Catalog every turn), not UI copy — the same rule the tab strip
    // follows. The full criterion stays on the intent detail page.
    intentChipItems: intents.map((intent) => ({
      id: intent.id,
      label: intent.id,
      icon: Target,
      selected: armedIntents.includes(intent.id),
    })),
    intents,
    selectJob: (jobId: string) => {
      if (agent) selectCustomJob(agent.id, jobId);
    },
    selectIntent: (intentId: string) => {
      // Catalog-reload race: never arm an id that has left the catalog (the
      // mirror image of the detail view's own vanished-subject guard).
      if (intents.some((i) => i.id === intentId)) selectCustomIntent(intentId);
    },
  };
}
