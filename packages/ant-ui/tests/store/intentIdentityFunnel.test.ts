/**
 * Intent → job identity funnel.
 *
 * `applyJobIdentity` (authSlice) is the SSOT writer of the
 * `(selectedAgent, selectedJobType)` pair: it also persists
 * `SELECTED_JOB_TYPE` and re-points the unified SSE `job` query param.
 * `selectIntent` and `updateActionMetadata` used to write the pair inline,
 * so both side effects were skipped.
 *
 * The consequence was not visible until a reload: the SSE stream kept asking
 * for the previously-persisted jobType, and for a jobType with no session file
 * the backend answers with an identity-less empty board — which cleared the
 * job-ID chip and blanked the kanban while the chat (durable `chat.jsonl`)
 * survived. `reconvergeJobType` could not save it: it is gated on
 * `data.jobType !== selectedJobType`, so it no-ops precisely when the
 * in-memory value already matches the running job.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

// `environment: 'node'` has no storage objects, and `saveToStorage` swallows
// the ReferenceError — the persistence assertions need real ones. Installed
// from a hoisted factory so they exist before uiSlice's module-init read.
const { updateJobParamMock } = vi.hoisted(() => {
  const make = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => Array.from(map.keys())[i] ?? null,
      get length() { return map.size; },
    };
  };
  (globalThis as any).localStorage = make();
  (globalThis as any).sessionStorage = make();
  return { updateJobParamMock: vi.fn() };
});

// SSEManager touches `window` at module init (DEV debug shim).
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: { updateJobParam: updateJobParamMock },
}));
// uiSlice's `persistWorkspaceDomain` writes back via the api module.
vi.mock('@/infrastructure/http/api', () => ({ updateProjectConfig: vi.fn() }));

import { createUISlice, type UISlice } from '../../src/domain/store/slices/uiSlice';
import { createAuthSlice, type AuthSlice } from '../../src/domain/store/slices/authSlice';
import { STORAGE_KEYS } from '../../src/domain/store/storage';

type TestStore = UISlice & AuthSlice;

function makeStore() {
  return create<TestStore>()((...args) => ({
    ...createUISlice(...args),
    ...createAuthSlice(...args),
  }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  updateJobParamMock.mockReset();
});

function persistedJobType(): string | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEYS.SELECTED_JOB_TYPE)
    ?? localStorage.getItem(STORAGE_KEYS.SELECTED_JOB_TYPE);
  return raw == null ? undefined : JSON.parse(raw);
}

describe('selectIntent funnels through applyJobIdentity', () => {
  it('persists the derived jobType and re-points the SSE job param', () => {
    const store = makeStore();
    store.getState().selectIntent('gen-code-directive');

    expect(store.getState().selectedJobType).toBe('code');
    expect(store.getState().selectedAgent).toBe('architect');
    expect(persistedJobType()).toBe('code');
    expect(updateJobParamMock).toHaveBeenCalledWith('code');
  });

  it('still applies the intent-scoped store fields', () => {
    const store = makeStore();
    store.getState().selectIntent('gen-code-directive');

    expect(store.getState().selectedIntentId).toBe('gen-code-directive');
    expect(store.getState().actionMetadata.intent).toBe('gen-code-directive');
    expect(store.getState().pendingChatInput?.source).toBe('intent-change');
  });
});

describe('updateActionMetadata funnels through applyJobIdentity', () => {
  it('persists on an intent change', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-plan' });

    expect(store.getState().selectedJobType).toBe('plan');
    expect(persistedJobType()).toBe('plan');
    expect(updateJobParamMock).toHaveBeenCalledWith('plan');
  });

  it('does NOT touch the identity when the patch carries no intent change', () => {
    const store = makeStore();
    store.getState().updateActionMetadata({ intent: 'gen-code-directive' });
    updateJobParamMock.mockReset();

    // Same intent again + an unrelated field: no identity write.
    store.getState().updateActionMetadata({ intent: 'gen-code-directive' });
    store.getState().updateActionMetadata({ refs: ['assets/game/models/Duck.glb'] });

    expect(updateJobParamMock).not.toHaveBeenCalled();
    expect(store.getState().selectedJobType).toBe('code');
  });
});
