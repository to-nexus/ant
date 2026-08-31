import type { ServerMode, OrganizationKind } from '@ant/shared';
import type { StoreState } from '../types';

/** Active org kind for the current identity (undefined until `/auth/me` lands). */
export function selectUserOrgKind(state: StoreState): OrganizationKind | undefined {
  return state.userOrgKind;
}

/**
 * Human label for the active account in the nav bar. Individual orgs show a
 * fixed "Individual" label (the raw `'individual'` id is not user-facing);
 * team/local show the org id/name.
 */
export function selectOrgDisplayLabel(state: StoreState): string | undefined {
  if (state.userOrgKind === 'individual') return 'Individual';
  return state.userOrganization;
}

/**
 * BE-derived server mode getter. Returns the resolved `ServerMode` once
 * `loadSystemConfig` has landed, or `null` during the first paint window
 * (before `/system/config` responds). Callers that must take a side BEFORE
 * the BE mode is known should treat `null` conservatively — for auth gates
 * that means "behave as cloud" so we don't fan out protected requests
 * unauthenticated.
 */
export function selectServerMode(state: StoreState): ServerMode | null {
  return state.serverMode.status === 'ready' ? state.serverMode.data : null;
}

/**
 * Single SSOT for "is the current visitor allowed to act as a user?" — the
 * positive gate shared by every UI action/render surface (chat input & policy,
 * explorer, UI action policy, and the QuickStart onboarding entry/submit).
 *
 * `true` when local mode (the app always acts as the local tenant) OR a
 * `userEmail` is present (cloud signed-in). While `serverMode` is still `null`
 * (system config loading) this reads as `!!userEmail` — conservative for cloud,
 * and the short window is already covered by upstream loading gates.
 *
 * Distinct from `selectIsAuthBlocked`, which additionally blocks during the
 * cloud `verifying` window to protect PROTECTED FETCHES. UI presence gates use
 * this simpler form so chat / explorer / onboarding stay consistent — do NOT
 * re-inline `serverMode === 'local' || !!userEmail` at call sites.
 */
export function selectIsAuthenticated(state: StoreState): boolean {
  return selectServerMode(state) === 'local' || !!state.userEmail;
}

/**
 * Single SSOT for "should this lifecycle / sync hook skip its protected
 * fetch right now?".
 *
 * Returns `true` (block) when:
 *   - BE mode unknown (system config not yet loaded) — conservative,
 *   - cloud mode + no `userEmail` (signed out / cleared), OR
 *   - cloud mode + `authStatus === 'verifying'` (mount-time `fetchAuthMe`
 *     is still in flight, so a stale `userEmail` is not yet validated), OR
 *   - cloud mode + the account is not approved. Every authenticated route now
 *     answers 403 to an unapproved account (`requireApprovedAccount`), so
 *     without this the approval screen would sit in front of a 403 storm.
 *
 * Returns `false` (allow) otherwise. Local mode is never blocked here.
 *
 * Lifecycle hooks (`useProjectLifecycle`, `usePreviewSync` initial fetch,
 * `App.loadSession`, `useDesktopBridge` initial fetch) and the slice
 * actions that fan out from them MUST go through this selector, otherwise
 * stale-session detection produces a 401 storm before `clearUser`'s
 * cascade has a chance to land.
 *
 * See plan `stale-session-lifecycle-cascade`.
 */
export function selectIsAuthBlocked(state: StoreState): boolean {
  const mode = selectServerMode(state);
  if (mode === 'local') return false;
  // Unknown mode → conservative cloud-block. The window is short (one
  // `/system/config` round-trip) and re-renders flip to `false` for local.
  if (!state.userEmail) return true;
  if (state.authStatus === 'verifying') return true;
  return !selectIsApproved(state);
}

/**
 * Cloud account approval gate. `false` ONLY when the server explicitly reports
 * a non-approved status (`pending` / `denied`). Local mode, legacy servers, and
 * the pre-verify window all read `undefined` → approved (fail-open, matching the
 * BE guard's posture; the BE re-checks every authenticated request).
 */
export function selectIsApproved(state: StoreState): boolean {
  const s = state.approvalStatus;
  return s !== 'pending' && s !== 'denied';
}

/**
 * Should the app shell be replaced by the account-approval screen?
 *
 * A state-driven branch rather than a URL route, so it covers every entry into
 * the product with one predicate — the OAuth redirect, a deep link, QuickStart,
 * the project wizard. `authStatus === 'verifying'` is excluded so the screen
 * cannot flash during the mount-time `/auth/me`, and `approvalStatus`
 * `undefined` already reads as approved.
 */
export function selectShowApprovalGate(state: StoreState): boolean {
  if (selectServerMode(state) !== 'cloud') return false;
  if (!state.userEmail) return false;
  if (state.authStatus === 'verifying') return false;
  return !selectIsApproved(state);
}

/** Role in the active org (3-role ladder), from memberships. */
export function selectActiveUserRole(state: StoreState): 'owner' | 'admin' | 'member' | undefined {
  const m = state.memberships.find((x) => x.organizationId === state.userOrganization);
  return m?.role;
}

/** Is the active org a team? Gates every org-settings surface (kind-dispatch). */
export function selectIsTeamActive(state: StoreState): boolean {
  return state.userOrgKind === 'team';
}

/** admin+ (admin or owner) in the ACTIVE team org — gates manage surfaces. */
export function selectIsOrgAdmin(state: StoreState): boolean {
  if (!selectIsTeamActive(state)) return false;
  const role = selectActiveUserRole(state);
  return role === 'owner' || role === 'admin';
}

/**
 * Pending invites not yet dismissed from the banner (the switcher dot still
 * counts ALL pending invites — dismissal hides the strip, not the fact).
 */
export function selectVisiblePendingInvites(state: StoreState) {
  return state.pendingInvites.filter((i) => !state.dismissedInviteIds.includes(i.id));
}

/** Domain-join candidates whose banner wasn't dismissed for that org. */
export function selectVisibleDomainJoinableOrgs(state: StoreState) {
  return state.domainJoinableOrgs.filter(
    (d) => !state.dismissedDomainOrgIds.includes(d.organizationId),
  );
}

/**
 * The "a login added you to this team" notice, unless dismissed or already
 * the active org (in which case there is nothing to switch to).
 */
export function selectVisibleAutoJoinedOrg(state: StoreState) {
  const org = state.autoJoinedOrg;
  if (!org) return null;
  if (org.organizationId === state.userOrganization) return null;
  if (state.dismissedAutoJoinOrgIds.includes(org.organizationId)) return null;
  return org;
}

/** The caller's own pending join requests, by org id — drives the join modal. */
export function selectMyPendingJoinRequestByOrg(state: StoreState) {
  const byOrg = new Map<string, StoreState['myJoinRequests'][number]>();
  for (const r of state.myJoinRequests) {
    if (r.status === 'pending') byOrg.set(r.organizationId, r);
  }
  return byOrg;
}

/**
 * Single visibility seam: may USD cost be shown to this caller?
 *
 * Current phase: fully transparent — token → real USD → credit shown to
 * everyone regardless of role (per product decision). This is the single
 * switch to flip later if USD should become operator-only (e.g.
 * `state.userOrgKind === 'team' ? selectActiveUserRole(state) === 'owner' : true`).
 */
export function selectCanViewUsdCost(_state: StoreState): boolean {
  return true;
}

/**
 * Single visibility seam: may CREDITS (the ANT billing unit) be shown?
 *
 * Cloud only. Local mode calls the provider with the user's own API key and is
 * never charged in credits, so every credit-flavoured label/row must disappear
 * there — USD cost stays (it's the real provider bill).
 *
 * Reads `serverMode` rather than `billingEnabled` so it fails CLOSED during the
 * first paint window: `billingEnabled` defaults to `true` before
 * `/system/config` lands and would flash credits in local mode.
 */
export function selectCanViewCredits(state: StoreState): boolean {
  return selectServerMode(state) === 'cloud';
}
