/**
 * Deploy parity hardening — locks the deploy-side fixes that mirror preview:
 *   - `selectIsDeployLoading` forces false on a terminal phase, so the Deploy
 *     button re-enables after success/failure/stop even if the explicit
 *     `setDeployLoading(false)` was missed.
 *   - `setDeployStopGuard` records a window; `setDeployLogs` bulk-hydrates and
 *     caps at 200.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import {
  createDeploySlice,
  selectIsDeployLoading,
  selectDeployStopGuardUntil,
  isTerminalDeployPhase,
  type DeploySlice,
} from '../../src/domain/store/slices/deploySlice';
import type { DeployStatus, DeployLogEntry } from '../../src/infrastructure/http/api';

function makeStore() {
  return create<DeploySlice>()((set, get, store) =>
    createDeploySlice(set, get, store),
  );
}

const KEY = 'proj:main';
const dlog = (m: string): DeployLogEntry => ({ timestamp: 't', type: 'stdout', message: m } as DeployLogEntry);

describe('isTerminalDeployPhase', () => {
  it('treats running/error/stopped/hibernated/unavailable as terminal', () => {
    for (const p of ['running', 'error', 'stopped', 'hibernated', 'unavailable'] as const) {
      expect(isTerminalDeployPhase(p)).toBe(true);
    }
    for (const p of ['building', 'deploying', 'starting', 'idle'] as const) {
      expect(isTerminalDeployPhase(p as DeployStatus['phase'])).toBe(false);
    }
  });
});

describe('selectIsDeployLoading — terminal invariant', () => {
  it('error phase ⇒ false even when raw isLoading=true', () => {
    const s = makeStore();
    s.getState().setDeployLoading(KEY, true);
    s.getState().setDeployStatus(KEY, { phase: 'error' } as DeployStatus);
    expect(selectIsDeployLoading(s.getState(), KEY)).toBe(false);
  });

  it('building phase ⇒ honours raw isLoading=true', () => {
    const s = makeStore();
    s.getState().setDeployLoading(KEY, true);
    s.getState().setDeployStatus(KEY, { phase: 'building' } as DeployStatus);
    expect(selectIsDeployLoading(s.getState(), KEY)).toBe(true);
  });
});

describe('deploy stopGuard + log hydration', () => {
  it('setDeployStopGuard stores the window', () => {
    const s = makeStore();
    s.getState().setDeployStopGuard(KEY, 12345);
    expect(selectDeployStopGuardUntil(s.getState(), KEY)).toBe(12345);
  });

  it('setDeployLogs bulk-hydrates and caps at 200', () => {
    const s = makeStore();
    const many = Array.from({ length: 250 }, (_, i) => dlog(`line ${i}`));
    s.getState().setDeployLogs(KEY, many);
    const logs = s.getState().deployByFeature[KEY].logs;
    expect(logs).toHaveLength(200);
    expect(logs[logs.length - 1].message).toBe('line 249');
  });
});
