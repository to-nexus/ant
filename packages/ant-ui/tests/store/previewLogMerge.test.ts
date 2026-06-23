/**
 * Preview log-preservation + terminal-phase loading invariant.
 *
 * Locks the two store-level fixes:
 *   - `mergePreviewStatus` never lets an incoming status `logs` array shrink or
 *     replace a live SSE-accumulated buffer (GET /status returns last-50 /
 *     empty-on-non-owning-pod). It adopts `patch.logs` only to seed an empty
 *     buffer (cold hydration).
 *   - A terminal phase (running | error | stopped) forces `isLoading=false`,
 *     both in the slice merge and in `selectPreviewVM` — so a failed/stopped
 *     preview never leaves the Start button stuck behind a spinner.
 */

import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import {
  createPreviewSlice,
  isTerminalPhase,
  type PreviewSlice,
} from '../../src/domain/store/slices/previewSlice';
import { selectPreviewVM } from '../../src/domain/store/selectors/previewSelectors';
import type { LogEntry, PreviewStatus } from '../../src/infrastructure/http/api';

function makeStore() {
  return create<PreviewSlice>()((set, get, store) =>
    createPreviewSlice(set, get, store),
  );
}

const log = (message: string): LogEntry => ({
  timestamp: '2026-06-23T00:00:00.000Z',
  type: 'stdout',
  message,
});

const KEY = 'proj:main';

describe('isTerminalPhase', () => {
  it('is true for running/error/stopped, false otherwise', () => {
    expect(isTerminalPhase('running')).toBe(true);
    expect(isTerminalPhase('error')).toBe(true);
    expect(isTerminalPhase('stopped')).toBe(true);
    expect(isTerminalPhase('installing')).toBe(false);
    expect(isTerminalPhase('starting')).toBe(false);
    expect(isTerminalPhase('stopping')).toBe(false);
    expect(isTerminalPhase(undefined)).toBe(false);
  });
});

describe('mergePreviewStatus — log preservation', () => {
  it('does NOT let a shorter status patch replace a longer live buffer', () => {
    const s = makeStore();
    // Live SSE buffer of 3 lines.
    s.getState().appendPreviewLog(KEY, log('a'));
    s.getState().appendPreviewLog(KEY, log('b'));
    s.getState().appendPreviewLog(KEY, log('c'));
    // GET /status arrives carrying only the backend's last-1.
    s.getState().mergePreviewStatus(KEY, { phase: 'starting', logs: [log('c')] } as Partial<PreviewStatus>);
    expect(s.getState().previewByFeature[KEY].status?.logs).toHaveLength(3);
  });

  it('does NOT let an empty status patch wipe a populated buffer (non-owning pod)', () => {
    const s = makeStore();
    s.getState().appendPreviewLog(KEY, log('a'));
    s.getState().appendPreviewLog(KEY, log('b'));
    s.getState().mergePreviewStatus(KEY, { phase: 'starting', logs: [] } as Partial<PreviewStatus>);
    expect(s.getState().previewByFeature[KEY].status?.logs).toHaveLength(2);
  });

  it('adopts patch.logs to seed an EMPTY buffer (cold hydration)', () => {
    const s = makeStore();
    s.getState().mergePreviewStatus(KEY, { phase: 'running', logs: [log('x'), log('y')] } as Partial<PreviewStatus>);
    expect(s.getState().previewByFeature[KEY].status?.logs).toHaveLength(2);
  });
});

describe('mergePreviewStatus — terminal phase clears loading', () => {
  it('forces isLoading=false when phase becomes error', () => {
    const s = makeStore();
    s.getState().setPreviewLoading(KEY, true);
    s.getState().mergePreviewStatus(KEY, { phase: 'error', error: 'boom' } as Partial<PreviewStatus>);
    expect(s.getState().previewByFeature[KEY].isLoading).toBe(false);
  });

  it('keeps isLoading while phase is transitional (starting)', () => {
    const s = makeStore();
    s.getState().setPreviewLoading(KEY, true);
    s.getState().mergePreviewStatus(KEY, { phase: 'starting' } as Partial<PreviewStatus>);
    expect(s.getState().previewByFeature[KEY].isLoading).toBe(true);
  });
});

describe('selectPreviewVM — isLoading invariant', () => {
  it('error phase with raw loading=true ⇒ vm.isLoading false', () => {
    const state = {
      previewByFeature: {
        [KEY]: { status: { running: false, phase: 'error' } as PreviewStatus, isLoading: true, stopGuardUntil: 0 },
      },
    };
    expect(selectPreviewVM(state as any, KEY).isLoading).toBe(false);
  });

  it('starting phase with raw loading=true ⇒ vm.isLoading true', () => {
    const state = {
      previewByFeature: {
        [KEY]: { status: { running: false, phase: 'starting' } as PreviewStatus, isLoading: true, stopGuardUntil: 0 },
      },
    };
    expect(selectPreviewVM(state as any, KEY).isLoading).toBe(true);
  });
});
