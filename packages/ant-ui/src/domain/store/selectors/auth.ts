import type { ServerMode } from '@ant/shared';
import type { StoreState } from '../types';

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
