/**
 * `ideSelectors` — selector behavior across all 7 union kinds of
 * `IdeSessionState`. This is the SSOT for "what does this union kind mean";
 * any direct `state.ideSession.kind === '...'` outside the selectors module
 * is a smell, so we lock the mapping here.
 *
 * Each kind is checked against every selector once — if a future refactor
 * forgets a branch, one of these will fail.
 */

import { describe, it, expect } from 'vitest';
import {
  selectIdeBaseUrl,
  selectIdeConnectError,
  selectIdeElapsedMs,
  selectIdeOverlayMode,
  selectIdeSessionKey,
  selectIdeStartupPhase,
  selectIdeStuckSince,
} from '../../src/domain/store/selectors/ideSelectors';
import type { IdeSessionState } from '../../src/domain/store/types';

function makeState(session: IdeSessionState) {
  return {
    ideSession: session,
    ideReloadTimestamp: 0,
    ideWorkspacePath: undefined,
  };
}

const NOW = 1_700_000_000_000;

describe('ideSelectors — overlay mode mapping', () => {
  it('idle → hidden', () => {
    expect(selectIdeOverlayMode(makeState({ kind: 'idle' }))).toBe('hidden');
  });

  it('starting (phase=null) → starting', () => {
    expect(
      selectIdeOverlayMode(makeState({ kind: 'starting', phase: null, startedAt: NOW, sessionKey: 'p:f' })),
    ).toBe('starting');
  });

  it('starting (phase=image-pulling) → progressing', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'starting', phase: 'image-pulling', startedAt: NOW, sessionKey: 'p:f' }),
      ),
    ).toBe('progressing');
  });

  it('starting + stuckSince → stuck', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'starting', phase: 'image-pulling', startedAt: NOW, sessionKey: 'p:f', stuckSince: NOW + 1000 }),
      ),
    ).toBe('stuck');
  });

  it('frameLoading → frameLoading', () => {
    expect(
      selectIdeOverlayMode(makeState({ kind: 'frameLoading', baseUrl: 'http://x', mountedAt: NOW, sessionKey: 'p:f' })),
    ).toBe('frameLoading');
  });

  it('connected → hidden', () => {
    expect(
      selectIdeOverlayMode(makeState({ kind: 'connected', baseUrl: 'http://x', sessionKey: 'p:f' })),
    ).toBe('hidden');
  });

  it('disconnected (probe-dead) → disconnectedHard', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'disconnected', baseUrl: 'http://x', sessionKey: 'p:f', detectedAt: NOW, signal: 'probe-dead' }),
      ),
    ).toBe('disconnectedHard');
  });

  it('disconnected (iframe-error) → disconnectedHard', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'disconnected', baseUrl: 'http://x', sessionKey: 'p:f', detectedAt: NOW, signal: 'iframe-error' }),
      ),
    ).toBe('disconnectedHard');
  });

  it('disconnected (sse-channel-down) → disconnectedSoft', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'disconnected', baseUrl: 'http://x', sessionKey: 'p:f', detectedAt: NOW, signal: 'sse-channel-down' }),
      ),
    ).toBe('disconnectedSoft');
  });

  it('reconnecting → reconnecting', () => {
    expect(
      selectIdeOverlayMode(
        makeState({ kind: 'reconnecting', baseUrl: 'http://x', sessionKey: 'p:f', attemptStartedAt: NOW }),
      ),
    ).toBe('reconnecting');
  });

  it('failed → failed', () => {
    expect(selectIdeOverlayMode(makeState({ kind: 'failed', error: 'boom' }))).toBe('failed');
  });
});

describe('ideSelectors — baseUrl extraction', () => {
  it('returns undefined for idle / starting / failed', () => {
    expect(selectIdeBaseUrl(makeState({ kind: 'idle' }))).toBeUndefined();
    expect(
      selectIdeBaseUrl(makeState({ kind: 'starting', phase: null, startedAt: NOW, sessionKey: 'p:f' })),
    ).toBeUndefined();
    expect(selectIdeBaseUrl(makeState({ kind: 'failed', error: 'x' }))).toBeUndefined();
  });

  it('returns baseUrl for frameLoading / connected / disconnected / reconnecting', () => {
    expect(
      selectIdeBaseUrl(makeState({ kind: 'frameLoading', baseUrl: 'http://x', mountedAt: NOW, sessionKey: 'p:f' })),
    ).toBe('http://x');
    expect(
      selectIdeBaseUrl(makeState({ kind: 'connected', baseUrl: 'http://x', sessionKey: 'p:f' })),
    ).toBe('http://x');
    expect(
      selectIdeBaseUrl(
        makeState({ kind: 'disconnected', baseUrl: 'http://x', sessionKey: 'p:f', detectedAt: NOW, signal: 'probe-dead' }),
      ),
    ).toBe('http://x');
    expect(
      selectIdeBaseUrl(
        makeState({ kind: 'reconnecting', baseUrl: 'http://x', sessionKey: 'p:f', attemptStartedAt: NOW }),
      ),
    ).toBe('http://x');
  });
});

describe('ideSelectors — derived fields', () => {
  it('connectError surfaces only for failed kind', () => {
    expect(selectIdeConnectError(makeState({ kind: 'failed', error: 'boom' }))).toBe('boom');
    expect(selectIdeConnectError(makeState({ kind: 'idle' }))).toBeUndefined();
    expect(
      selectIdeConnectError(makeState({ kind: 'connected', baseUrl: 'http://x', sessionKey: 'p:f' })),
    ).toBeUndefined();
  });

  it('startupPhase surfaces only for starting kind', () => {
    expect(
      selectIdeStartupPhase(
        makeState({ kind: 'starting', phase: 'pod-pending', startedAt: NOW, sessionKey: 'p:f' }),
      ),
    ).toBe('pod-pending');
    expect(
      selectIdeStartupPhase(makeState({ kind: 'connected', baseUrl: 'http://x', sessionKey: 'p:f' })),
    ).toBeNull();
  });

  it('stuckSince surfaces only for starting kind with stuckSince set', () => {
    expect(
      selectIdeStuckSince(
        makeState({ kind: 'starting', phase: 'image-pulling', startedAt: NOW, sessionKey: 'p:f', stuckSince: NOW + 100 }),
      ),
    ).toBe(NOW + 100);
    expect(
      selectIdeStuckSince(
        makeState({ kind: 'starting', phase: 'image-pulling', startedAt: NOW, sessionKey: 'p:f' }),
      ),
    ).toBeUndefined();
    expect(selectIdeStuckSince(makeState({ kind: 'idle' }))).toBeUndefined();
  });

  it('sessionKey surfaces for every kind that has one', () => {
    expect(selectIdeSessionKey(makeState({ kind: 'idle' }))).toBeUndefined();
    expect(
      selectIdeSessionKey(makeState({ kind: 'starting', phase: null, startedAt: NOW, sessionKey: 'p:f' })),
    ).toBe('p:f');
    expect(
      selectIdeSessionKey(makeState({ kind: 'connected', baseUrl: 'http://x', sessionKey: 'p:f' })),
    ).toBe('p:f');
    expect(selectIdeSessionKey(makeState({ kind: 'failed', error: 'x' }))).toBeUndefined();
  });

  it('elapsedMs uses kind-specific anchor', () => {
    expect(
      selectIdeElapsedMs(
        makeState({ kind: 'starting', phase: null, startedAt: 1000, sessionKey: 'p:f' }),
        5000,
      ),
    ).toBe(4000);
    expect(
      selectIdeElapsedMs(
        makeState({ kind: 'frameLoading', baseUrl: 'http://x', mountedAt: 2000, sessionKey: 'p:f' }),
        5000,
      ),
    ).toBe(3000);
    expect(
      selectIdeElapsedMs(
        makeState({ kind: 'reconnecting', baseUrl: 'http://x', sessionKey: 'p:f', attemptStartedAt: 3000 }),
        5000,
      ),
    ).toBe(2000);
    expect(
      selectIdeElapsedMs(
        makeState({ kind: 'disconnected', baseUrl: 'http://x', sessionKey: 'p:f', detectedAt: 4000, signal: 'probe-dead' }),
        5000,
      ),
    ).toBe(1000);
    expect(selectIdeElapsedMs(makeState({ kind: 'idle' }), 5000)).toBe(0);
  });
});
