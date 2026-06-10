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
 * Single SSOT for "should this lifecycle / sync hook skip its protected
 * fetch right now?".
 *
 * Returns `true` (block) when:
 *   - BE mode unknown (system config not yet loaded) — conservative,
 *   - cloud mode + no `userEmail` (signed out / cleared), OR
 *   - cloud mode + `authStatus === 'verifying'` (mount-time `fetchAuthMe`
 *     is still in flight, so a stale `userEmail` is not yet validated).
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
  return state.authStatus === 'verifying';
}

/** Role in the active org (`'owner' | 'member'`), from memberships. */
export function selectActiveUserRole(state: StoreState): 'owner' | 'member' | undefined {
  const m = state.memberships.find((x) => x.organizationId === state.userOrganization);
  return m?.role;
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
