import type { AsyncStatus } from '@/domain/async';

interface WithProjectsStatus {
  projectsStatus: AsyncStatus;
}

/**
 * Backwards-compatible projection of the old `projectsLoaded: boolean` flag:
 * true iff the first `fetchProjects` call has resolved (success, empty, or
 * error — all count as "attempted once"). QuickStart and the boot gate
 * consume this to know whether they can make flash-free routing decisions.
 */
export function selectProjectsLoaded(s: WithProjectsStatus): boolean {
  return s.projectsStatus === 'ready' || s.projectsStatus === 'empty' || s.projectsStatus === 'error';
}
