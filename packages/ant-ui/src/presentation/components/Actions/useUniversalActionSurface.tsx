/**
 * The universal (workspace) action surface — the agents on this workspace, the
 * jobs of the selected agent, and that job's intents, in chip form.
 *
 * Universal projects have no RAC and no action/intent matrix, so the canonical
 * `ACTION_DEFINITIONS` vocabulary is meaningless there: what a workspace can do
 * is `{agentId}/{jobId}`, refined by that job's own intent catalog. This hook is
 * the ONE derivation of that surface, consumed by both places the vocabulary is
 * offered — the actions panel and the chat action area — so a canonical chip can
 * never leak into either, and the two can never drift into different depths.
 *
 * Picking an AGENT or a JOB lands on state the chat surface already owns
 * (`selectCustomJob` — the composer toolbar's chips write the same fact).
 * Picking an INTENT is one atomic store write (`selectCustomIntent`): it arms
 * the intent for the next turn AND makes it the detail page's subject, so the
 * chip's `selected` ring, the composer's `UniversalTurnMetaBadges` chip and the
 * open detail page can never disagree. Canonical parity —
 * `ActionsPanel.handleIntentSelect` calls `selectIntent` and then routes the
 * step; arming is NOT the footer's job (its Chat button only RESTORES the pin
 * after a disarm or a send, and focuses the composer).
 */

import { useTranslation } from 'react-i18next';
import { Briefcase, Target } from 'lucide-react';
import type { CustomAgentScope, CustomIntentDef } from '@ant/shared';
import { useStore } from '@/domain/store';
import { AgentIcon, agentIconComponent } from '@/presentation/components/AgentIcon';
import type { ChipItem } from './ActionChipGrid';
import type { TabItem } from './ScrollableTabNav';
import { groupAgentsByScope, type AgentScopeGroup } from './universalSurfaceRules';

export interface UniversalAgentOption {
  id: string;
  name: string;
  scope: CustomAgentScope;
  jobCount: number;
}

export interface UniversalActionSurface {
  agentId: string | null;
  agentName: string;
  /** False when the workspace resolves no agents at all — distinct from "none selected". */
  hasAgents: boolean;
  /** True once an agent with at least one job is selected — nothing to offer otherwise. */
  ready: boolean;
  /** Agents grouped personal / organization / built-in, empty groups dropped. */
  agentGroups: AgentScopeGroup<UniversalAgentOption>[];
  agentChipItems: (agents: UniversalAgentOption[]) => ChipItem[];
  agentTabItems: TabItem[];
  jobs: Array<{ id: string; name: string }>;
  selectedJobId: string | null;
  jobChipItems: ChipItem[];
  jobTabItems: TabItem[];
  intentChipItems: ChipItem[];
  /** The selected job’s full catalog (hooks/clarify/hasPrompt) — the detail view’s data. */
  intents: CustomIntentDef[];
  /** Switch agent — lands on its first job, the same write the composer chip makes. */
  selectAgent: (agentId: string) => void;
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

  const options: UniversalAgentOption[] = customAgents.map((a) => ({
    id: a.id,
    name: a.name,
    scope: a.scope,
    jobCount: a.jobs.length,
  }));

  const noJobs = t('universal.agentNoJobs', { defaultValue: 'No jobs authored yet' });

  return {
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? '',
    hasAgents: customAgents.length > 0,
    ready: agent != null && jobs.length > 0,
    agentGroups: groupAgentsByScope(options),
    // A renderer, not a list: the grid is drawn once per scope group, and the
    // chips of a group must carry that group's rows only.
    agentChipItems: (group) =>
      group.map((a) => ({
        id: a.id,
        label: a.name,
        description: t('universal.agentJobCount', {
          count: a.jobCount,
          defaultValue: '{{count}} job(s)',
        }),
        leading: <AgentIcon agentId={a.id} size={26} style={{ marginBottom: 2 }} />,
        // Zero-job agents are listed but never selectable — the composer menu's
        // rule, so a workspace lists the same agents in both places.
        disabled: a.jobCount === 0,
        blockReason: a.jobCount === 0 ? noJobs : undefined,
        selected: a.id === selectedCustomAgentId,
      })),
    agentTabItems: options.map((a) => ({
      id: a.id,
      label: a.name,
      icon: agentIconComponent(a.id),
    })),
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
    jobTabItems: jobs.map((j) => ({ id: j.id, label: j.name, icon: Briefcase })),
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
    selectAgent: (agentId: string) => {
      const next = customAgents.find((a) => a.id === agentId);
      if (next?.jobs[0]) selectCustomJob(next.id, next.jobs[0].id);
    },
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
