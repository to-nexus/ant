/**
 * Application Constants
 * 
 * Centralized constants for the entire application
 */

/**
 * Available job types for the Architect agent
 * Corresponds to AgentJob type in ant-cli
 */
export const AVAILABLE_JOBS = [
  { 
    value: 'design' as const, 
    label: '🎨 Design', 
    description: 'Create architecture & design',
    agent: 'Architect'
  },
  { 
    value: 'code' as const, 
    label: '💻 Code', 
    description: 'Implement features',
    agent: 'Architect'
  },
  { 
    value: 'learn' as const, 
    label: '📚 Learn', 
    description: 'Analyze & document',
    agent: 'Architect'
  }
] as const;

export type JobType = typeof AVAILABLE_JOBS[number]['value'];

/**
 * Get job info by value
 */
export function getJobInfo(jobValue: string) {
  return AVAILABLE_JOBS.find(job => job.value === jobValue);
}

/**
 * Get agent name for job type
 */
export function getAgentName(jobValue: string): string {
  const job = getJobInfo(jobValue);
  return job?.agent || 'Agent';
}

/**
 * Git fetch interval (in milliseconds)
 * Controls how often Git status is auto-refreshed per feature
 */
export const GIT_FETCH_INTERVAL = 30 * 1000; // 30 seconds (for testing)
// export const GIT_FETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes (production)

