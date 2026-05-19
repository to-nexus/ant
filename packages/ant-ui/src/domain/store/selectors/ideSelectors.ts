/**
 * IDE state selectors — the only legitimate place to read `ideSession`.
 *
 * This module is pure (no `useStore` import) so tests can import it without
 * dragging in the entire store tree (which transitively requires `window`
 * via SSEManager). Hooks live in a sibling `ideSelectorHooks.ts` module.
 */

import type { IdeSessionState, UIState } from '../types';

/**
 * Overlay rendering mode. `IdeConnectionPanel` renders one of these and
 * nothing else — this is the single discriminator the UI reads.
 */
export type IdeOverlayMode =
  | 'hidden'
  | 'starting'
  | 'progressing'
  | 'stuck'
  | 'frameLoading'
  | 'disconnectedHard'
  | 'disconnectedSoft'
  | 'reconnecting'
  | 'failed';

type SliceState = Pick<UIState, 'ideSession' | 'ideReloadTimestamp' | 'ideWorkspacePath'>;

export const selectIdeSession = (s: SliceState): IdeSessionState => s.ideSession;

export const selectIdeBaseUrl = (s: SliceState): string | undefined =>
  'baseUrl' in s.ideSession ? s.ideSession.baseUrl : undefined;

export const selectIdeWorkspacePath = (s: SliceState): string | undefined => s.ideWorkspacePath;

export const selectIdeReloadTimestamp = (s: SliceState): number => s.ideReloadTimestamp;

export const selectIdeSessionKey = (s: SliceState): string | undefined =>
  'sessionKey' in s.ideSession ? s.ideSession.sessionKey : undefined;

export const selectIdeStartupPhase = (
  s: SliceState,
): import('@ant/shared').IdePhase | null =>
  s.ideSession.kind === 'starting' ? s.ideSession.phase : null;

export const selectIdeStuckSince = (s: SliceState): number | undefined =>
  s.ideSession.kind === 'starting' ? s.ideSession.stuckSince : undefined;

export const selectIdeConnectError = (s: SliceState): string | undefined =>
  s.ideSession.kind === 'failed' ? s.ideSession.error : undefined;

/**
 * Centralized mapping union kind → overlay mode. Adding a new union kind
 * requires updating this switch — TS exhaustiveness will catch omissions.
 */
export const selectIdeOverlayMode = (s: SliceState): IdeOverlayMode => {
  const session = s.ideSession;
  switch (session.kind) {
    case 'idle':
    case 'connected':
      return 'hidden';
    case 'starting':
      if (session.stuckSince !== undefined) return 'stuck';
      return session.phase === null ? 'starting' : 'progressing';
    case 'frameLoading':
      return 'frameLoading';
    case 'disconnected':
      return session.signal === 'sse-channel-down' ? 'disconnectedSoft' : 'disconnectedHard';
    case 'reconnecting':
      return 'reconnecting';
    case 'failed':
      return 'failed';
  }
};

/**
 * Elapsed since the lifecycle anchor of the current kind. Use this for the
 * "X초 경과" counters in the UI — pass `Date.now()` from a re-rendered
 * component so the value advances over time.
 */
export const selectIdeElapsedMs = (s: SliceState, now: number): number => {
  const session = s.ideSession;
  if (session.kind === 'starting') return now - session.startedAt;
  if (session.kind === 'frameLoading') return now - session.mountedAt;
  if (session.kind === 'reconnecting') return now - session.attemptStartedAt;
  if (session.kind === 'disconnected') return now - session.detectedAt;
  return 0;
};

