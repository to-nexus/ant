/**
 * Single owner of the "switch active organization" gesture.
 *
 * The reload is load-bearing correctness, not polish: the active org changes
 * the workspace root, and `SSEManager.connect` dedupes on
 * `(projectId, featureName, job)` with no org in the identity — an in-place
 * switch would silently keep the previous tenant's stream open. Anything that
 * replaces the reload has to give SSE an org-aware identity first.
 *
 * The storage scrub here is the pre-emptive half for the gesture we control.
 * `authSlice.setUser` holds the authoritative one (it also covers a switch
 * made in another tab, and a re-login as a different account) — both call the
 * same `removeTenantScopedStorage`, so there is one definition of which keys
 * are tenant-scoped.
 */

import { switchOrg } from '@/infrastructure/http/api';
import { removeTenantScopedStorage } from '@/domain/store/slices/auth/tenantScrub';

export async function switchActiveOrg(organizationId: string): Promise<void> {
  await switchOrg(organizationId);
  removeTenantScopedStorage();
  window.location.reload();
}
