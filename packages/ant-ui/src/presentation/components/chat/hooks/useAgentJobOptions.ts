import { useState, useEffect, useMemo } from 'react';
import { useStore } from '@/domain/store';
import { fetchAgents, type Agent } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';

// ✅ Conservative fallback used only when /agents fetch fails.
// `learn` is gated by the BE's vector-DB capability (`/system/config`
// .capabilities.vectorDb) and the canonical list comes from
// fetchAgents(); we omit it from the fallback so the picker never
// surfaces a workflow the BE may have disabled.
const DEFAULT_AGENTS: Agent[] = [
  { value: 'architect', label: 'Architect', enabled: true, jobs: [
    { value: 'code', label: 'Code' },
    { value: 'design', label: 'Design' },
  ]},
  { value: 'creator', label: 'Creator', enabled: true, jobs: [
    { value: 'visual', label: 'Visual' }
  ]}
];

export interface AgentWithMetadata extends Agent {
  displayLabel: string;
  description: string;
}

export interface JobWithMetadata {
  value: string;
  label: string;
  description: string;
}

/**
 * Fetches agent list from API, enriches agents and jobs with emoji/description
 * metadata, and derives the current selection.
 */
export function useAgentJobOptions() {
  const { t } = useTranslation('chat');
  const selectedJobType = useStore((state) => state.selectedJobType);
  const selectedAgent = useStore((state) => state.selectedAgent);
  // Domain context drives the planner / plan-job copy so a game workspace's
  // chat picker reads a game-flavored PRD description instead of the
  // service-default wording. The plan document is the same PRD in both
  // domains — only the description differs. i18next's `context` param
  // resolves `agent.planner_game` first, falling back to `agent.planner`.
  const domain = useStore((state) => state.actionMetadata.domain);

  // Universal (workspace) projects never render the canonical pickers —
  // skip the /agents fetch there (universalSlice owns the custom-agent list).
  const isUniversalMode = useStore((state) => state.projectType === 'universal');

  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);

  useEffect(() => {
    if (isUniversalMode) return;
    async function loadAgents() {
      try {
        const agentsData = await fetchAgents();
        setAgents(agentsData);
      } catch (error) {
        console.error('[ChatInput] Failed to load agents:', error);
        setAgents(DEFAULT_AGENTS);
      }
    }
    loadAgents();
  }, [isUniversalMode]);

  // Agents carry no emoji: every agent surface renders the Ant character
  // (`AgentLogo`) instead, so the label here is the bare name. Job labels keep
  // their emoji — a job still has a built-in identity.
  const agentsWithMetadata: AgentWithMetadata[] = useMemo(() =>
    agents.map((agent) => {
      const descriptions: Record<string, string> = {
        architect: t('agent.architect'),
        planner: t('agent.planner', { context: domain }),
        reviewer: t('agent.reviewer'),
        doc: t('agent.doc'),
        creator: t('agent.creator'),
      };
      return {
        ...agent,
        displayLabel: agent.label,
        description: descriptions[agent.value] || agent.label,
      };
    }),
    [agents, t, domain]
  );

  const currentAgent = agentsWithMetadata.find((a) => a.value === selectedAgent) || agentsWithMetadata[0];

  const jobs = agents.find((a) => a.value === selectedAgent)?.jobs || [];

  const jobsWithMetadata: JobWithMetadata[] = useMemo(() =>
    jobs.map((job) => {
      const metadata: Record<string, { emoji: string; description: string }> = {
        design: { emoji: '🎨', description: t('jobMode.design.description') },
        code: { emoji: '💻', description: t('jobMode.code.description') },
        learn: { emoji: '📚', description: t('jobMode.learn.description') },
        plan: { emoji: '📋', description: t('jobMode.plan.description', { context: domain }) },
        visual: { emoji: '🖼️', description: t('jobMode.visual.description') },
      };
      const meta = metadata[job.value] || { emoji: '🎯', description: job.label };
      return {
        value: job.value,
        label: `${meta.emoji} ${job.label}`,
        description: meta.description
      };
    }),
    [jobs, t, domain]
  );

  const currentJob = jobsWithMetadata.find((j) => j.value === selectedJobType) || jobsWithMetadata[0];

  return {
    agents,
    agentsWithMetadata,
    currentAgent,
    jobsWithMetadata,
    currentJob,
  };
}
