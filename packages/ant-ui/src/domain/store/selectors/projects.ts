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

/**
 * Stricter sibling of `selectProjectsLoaded`: has the project list actually
 * been fetched SUCCESSFULLY?
 *
 * `'error'` is excluded deliberately. A failed `listProjects()` also leaves
 * `projects: []`, which is indistinguishable from "your project was deleted" —
 * and session restore must not wipe a valid saved selection because the server
 * blipped. `'idle'` is excluded too: the auth-blocked boot branch writes
 * `projects: []` without moving the status, so `'idle'` means "no fetch has
 * happened yet", not "there are none".
 */
export function selectProjectsSettled(s: WithProjectsStatus): boolean {
  return s.projectsStatus === 'ready' || s.projectsStatus === 'empty';
}
