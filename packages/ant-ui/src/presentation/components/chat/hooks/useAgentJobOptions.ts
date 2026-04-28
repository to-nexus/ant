import { useState, useEffect, useMemo } from 'react';
import { useStore } from '@/domain/store';
import { fetchAgents, type Agent } from '@/infrastructure/http/api';
import { useTranslation } from 'react-i18next';

const DEFAULT_AGENTS: Agent[] = [
  { value: 'architect', label: 'Architect', enabled: true, jobs: [
    { value: 'code', label: 'Code' },
    { value: 'design', label: 'Design' },
    { value: 'learn', label: 'Learn' }
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
  // D28-revised — domain context drives the planner / plan-job copy so a
  // game workspace's chat picker reads "GDD / 게임 기획서" instead of the
  // service-default PRD wording. i18next's `context` param resolves
  // `agent.planner_game` first, falling back to `agent.planner`.
  const domain = useStore((state) => state.actionMetadata.domain);

  const [agents, setAgents] = useState<Agent[]>(DEFAULT_AGENTS);

  useEffect(() => {
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
  }, []);

  const agentsWithMetadata: AgentWithMetadata[] = useMemo(() =>
    agents.map((agent) => {
      const metadata: Record<string, { emoji: string; description: string }> = {
        architect: { emoji: '🤖', description: t('agent.architect') },
        planner: { emoji: '📋', description: t('agent.planner', { context: domain }) },
        reviewer: { emoji: '🔍', description: t('agent.reviewer') },
        doc: { emoji: '📝', description: t('agent.doc') },
        creator: { emoji: '🎨', description: t('agent.creator') }
      };
      const meta = metadata[agent.value] || { emoji: '🤖', description: agent.label };
      return {
        ...agent,
        displayLabel: `${meta.emoji} ${agent.label}`,
        description: meta.description
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
