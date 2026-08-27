/**
 * Pure decision layer for session restore — extracted so the rules are
 * table-testable (the ant-ui vitest env is `node`; a hook cannot be rendered).
 */

/**
 * May session restore run yet?
 *
 * It used to be gated on `connectionStatus === 'connected'`, which is wrong in
 * both directions. Too early: the auth-blocked boot branch reports
 * `'connected'` while the project list is still empty, so the one-shot burned
 * against `projects: []` and concluded every saved project was gone. Too late:
 * the first SSE failure flips the same flag to `'disconnected'`, so re-gating
 * on it would never re-open.
 *
 * The honest signal is "the project list for the CURRENT tenant has been
 * fetched successfully" — plus the standard auth gate, since a signed-out
 * cloud boot also settles the list (at `'empty'`).
 */
export function sessionRestoreGateOpen(input: {
  authBlocked: boolean;
  projectsSettled: boolean;
}): boolean {
  return !input.authBlocked && input.projectsSettled;
}

export type SavedProjectVerdict = 'none' | 'stale' | 'restore';

/** Is the saved project still real for the tenant whose list just loaded? */
export function verifySavedProject(
  savedProjectId: string | null | undefined,
  projects: string[],
): SavedProjectVerdict {
  if (!savedProjectId) return 'none';
  return projects.includes(savedProjectId) ? 'restore' : 'stale';
}
