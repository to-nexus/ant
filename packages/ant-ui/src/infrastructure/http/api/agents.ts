import { API_BASE, apiGet } from './client';

export interface AgentJobInfo {
  value: string;
  label: string;
}

export interface Agent {
  value: string;
  label: string;
  enabled: boolean;
  jobs: AgentJobInfo[];
}

export function fetchAgents(): Promise<Agent[]> {
  return apiGet(`${API_BASE()}/agents`);
}
