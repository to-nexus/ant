/**
 * Deploy Types
 * 
 * Shared types for the deploy feature (static build + serve).
 * Used for SSE events and API contracts between BE and FE.
 */

export type DeployPhase = 'idle' | 'building' | 'deploying' | 'running' | 'error' | 'stopped';

export type DeployFramework = 'vite' | 'cra' | 'nextjs' | 'static' | 'unknown';

export interface DeployStatus {
  phase: DeployPhase;
  url?: string;
  port?: number;
  framework?: string;
  error?: string;
}

export interface DeployLogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr';
  message: string;
}
