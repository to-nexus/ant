/**
 * Tenant-scoped teardown — the single definition of "what belongs to the
 * active `(organization)` and must not survive a tenant change".
 *
 * Two triggers share it:
 *   - `clearUser` (sign-out / stale-session), and
 *   - `setUser` when `/auth/me` reports a different organization than the one
 *     the store was hydrated with (org switch, cross-tab switch, re-login as
 *     another account).
 *
 * Keeping both on one definition is the point: when they drifted, an org
 * switch left the previous org's `selectedProject` in the store, the unified
 * SSE opened against a project that does not exist under the new workspace
 * root, and the backend's 404 turned into a permanent reconnect loop that
 * pinned the UI on the "connecting" placeholder.
 *
 * Store-free so it stays table-testable — callers spread the patch into their
 * own `set()`.
 */

import { STORAGE_KEYS, removeFromStorage } from '../../storage';

/**
 * Does this `/auth/me` result represent a tenant change?
 *
 * `undefined` previous means first sign-in, not a switch — there is nothing
 * from another tenant to scrub. A same-org reload (`prev === next`) must be a
 * no-op or every mount would wipe the user's selection.
 */
export function isTenantChange(prev: string | undefined, next: string | undefined): boolean {
  return prev !== undefined && prev !== next;
}

/**
 * State patch clearing everything scoped to the previous tenant: the project
 * identity, the project list, and the org-owned agent surface.
 *
 * `projectsStatus: 'idle'` (not `'empty'`) is load-bearing — it keeps
 * `selectProjectsLoaded` false so the boot gate covers the refetch window, and
 * keeps `selectProjectsSettled` closed until the NEW org's fetch resolves.
 */
export function tenantScrubPatch(): Record<string, unknown> {
  return {
    // Project identity — the field whose staleness wedges the SSE stream.
    selectedProject: undefined,
    selectedFeature: undefined,
    features: [],
    pendingFeatures: [],
    // Project list.
    projects: [],
    projectsStatus: 'idle',
    // Agent state is tenant-scoped (org-owned agents differ per active org),
    // so a tenant change must not leak the previous identity's lists/selection.
    accountAgents: [],
    accountAgentsError: null,
    agentSettingsSelection: { agentId: undefined, jobId: undefined, intentId: undefined },
    definitionTree: [],
    openDefinitionFile: null,
    definitionValidation: null,
    customAgents: [],
    customAgentsError: null,
    selectedCustomAgentId: undefined,
    selectedCustomJobId: undefined,
  };
}

/**
 * The persisted half. `SELECTED_AGENT` / `SELECTED_JOB_TYPE` are deliberately
 * absent: both hold built-in identifiers from closed unions, never an
 * org-owned id — the tenant-scoped custom-agent selection lives in the state
 * patch above.
 */
export function removeTenantScopedStorage(): void {
  removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
  removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);
}
