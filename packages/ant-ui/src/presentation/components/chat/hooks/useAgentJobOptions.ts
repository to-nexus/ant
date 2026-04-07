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
        planner: { emoji: '📋', description: t('agent.planner') },
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
    [agents, t]
  );

  const currentAgent = agentsWithMetadata.find((a) => a.value === selectedAgent) || agentsWithMetadata[0];

  const jobs = agents.find((a) => a.value === selectedAgent)?.jobs || [];

  const jobsWithMetadata: JobWithMetadata[] = useMemo(() =>
    jobs.map((job) => {
      const metadata: Record<string, { emoji: string; description: string }> = {
        design: { emoji: '🎨', description: t('jobMode.design.description') },
        code: { emoji: '💻', description: t('jobMode.code.description') },
        learn: { emoji: '📚', description: t('jobMode.learn.description') },
        plan: { emoji: '📋', description: t('jobMode.plan.description') },
        visual: { emoji: '🖼️', description: t('jobMode.visual.description') },
      };
      const meta = metadata[job.value] || { emoji: '🎯', description: job.label };
      return {
        value: job.value,
        label: `${meta.emoji} ${job.label}`,
        description: meta.description
      };
    }),
    [jobs, t]
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
