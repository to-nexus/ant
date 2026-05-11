import type { StoreState } from '../types';

/**
 * Single SSOT for "should this lifecycle / sync hook skip its protected
 * fetch right now?".
 *
 * Returns `true` (block) when:
 *   - cloud mode + no `userEmail` (signed out / cleared), OR
 *   - cloud mode + `authStatus === 'verifying'` (mount-time `fetchAuthMe`
 *     is still in flight, so a stale `userEmail` is not yet validated).
 *
 * Returns `false` (allow) otherwise. Local mode is never blocked here.
 *
 * Replaces the scattered `state.launchMode === 'cloud' && !state.userEmail`
 * inline checks. Lifecycle hooks (`useProjectLifecycle`, `usePreviewSync`
 * initial fetch, `App.loadSession`, `useDesktopBridge` initial fetch) and
 * the slice actions that fan out from them MUST go through this selector,
 * otherwise stale-session detection produces a 401 storm before
 * `clearUser` 's cascade has a chance to land.
 *
 * See plan `stale-session-lifecycle-cascade`.
 */
export function selectIsAuthBlocked(state: StoreState): boolean {
  if (state.launchMode !== 'cloud') return false;
  if (!state.userEmail) return true;
  return state.authStatus === 'verifying';
}
