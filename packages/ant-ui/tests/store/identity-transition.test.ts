/**
 * Unified panel-lifecycle policy on `(project, feature)` identity change.
 *
 * Locks the SSOT introduced in `domain/project-world/identityTransition.ts` +
 * `resetSlice.applyIdentityTransition`, and that the project-slice setters
 * delegate to it (single owner — see docs/internals/ui-async-policy.md §7.6).
 *
 * Behavior under test:
 *   - feature change → transient editor/figma cleared; conversation/board
 *     runtime PRESERVED (SSE/session refill); previewConfig STAYS OPEN;
 *     fileEdit/transfer closed; transfer source cleared; prev bucket evicted.
 *   - project change → all of the above PLUS conversation/board wiped and
 *     previewConfig closed.
 *   - the backend preview server is never stopped (UI-only eviction).
 *   - setSelectedProject / setSelectedFeature route through applyIdentityTransition.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { create } from 'zustand';

import { createProjectSlice } from '../../src/domain/store/slices/projectSlice';
import { createFileSlice } from '../../src/domain/store/slices/fileSlice';
import { createUISlice } from '../../src/domain/store/slices/uiSlice';
import { createPreviewSlice } from '../../src/domain/store/slices/previewSlice';
import { createDeploySlice, makeFeatureKey } from '../../src/domain/store/slices/deploySlice';
import { createTransferSlice } from '../../src/domain/store/slices/transferSlice';
import { createResetSlice } from '../../src/domain/store/slices/resetSlice';

// projectSlice imports the SSEManager singleton, which touches `window` at
// module load. Stub it (only `disconnectAll` is used by the setters) so the
// suite runs in the default node environment.
vi.mock('@/infrastructure/sse/SSEManager', () => ({
  sseManager: {
    disconnectAll: vi.fn(),
    connectWorkflow: vi.fn(),
    disconnectWorkflow: vi.fn(),
  },
}));

// Silence the async session-load path in setSelectedFeature (dynamic import).
vi.mock('@/infrastructure/http/api', () => ({
  fetchFeatureSession: vi.fn().mockResolvedValue(null),
  fetchFeatures: vi.fn().mockResolvedValue([]),
}));

// In-memory web-storage stub so the real setters' persist calls don't warn
// under the default node environment.
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  } as Storage;
}
vi.stubGlobal('sessionStorage', memStorage());
vi.stubGlobal('localStorage', memStorage());

const P = 'proj-1';
const F1 = 'feat-a';
const F2 = 'feat-b';

function buildStore() {
  return create<any>((set, get, store) => ({
    ...createProjectSlice(set as any, get as any, store as any),
    ...createFileSlice(set as any, get as any, store as any),
    ...createUISlice(set as any, get as any, store as any),
    ...createPreviewSlice(set as any, get as any, store as any),
    ...createDeploySlice(set as any, get as any, store as any),
    ...createTransferSlice(set as any, get as any, store as any),
    ...createResetSlice(set as any, get as any, store as any),
  }));
}

function seed(useStore: ReturnType<typeof buildStore>) {
  const key = makeFeatureKey(P, F1)!;
  useStore.setState({
    selectedProject: P,
    selectedFeature: F1,
    runningJobsByFeature: {},
    // conversation / board / session runtime
    session: { state: { jobId: 'j' } } as any,
    chatEvents: [{ id: 'c1' }] as any,
    streamingBuffers: { j: 'partial' } as any,
    kanban: { jobId: 'j', todo: [{}], inProgress: [], completed: [], isEstimating: false, dataSource: 'live' } as any,
    isRunning: true,
    currentJobId: 'j',
    // transient
    figmaPopulated: { some: 'thing' } as any,
    editorTabs: [{ id: 'editor:foo' }] as any,
    activeEditorTabId: 'editor:foo',
    activeJobs: { code: 'j' } as any,
    // transfer source referencing the current feature
    sendPreselectedSource: { projectId: P, featureId: F1, path: 'a.ts', type: 'file' } as any,
    // open secondary tabs
    mainPanelActiveTab: 'previewConfig',
    mainPanelOpenTabs: {
      projectConfig: true,
      accountConfig: false,
      fileEdit: true,
      transfer: true,
      previewConfig: true,
      actions: false,
      billing: false,
      pipelines: true,
    },
    mainPanelTabOrder: ['projectConfig', 'fileEdit', 'transfer', 'previewConfig', 'pipelines'],
    // per-feature preview + deploy buckets (server "running")
    previewByFeature: { [key]: { status: { running: true, phase: 'running' }, isLoading: false, stopGuardUntil: 0 } } as any,
    deployByFeature: { [key]: { status: undefined, logs: [], isLoading: false, stopGuardUntil: 0 } } as any,
    customDomainsByFeature: { [key]: [] } as any,
    customDomainEnabledByFeature: { [key]: true } as any,
  } as any);
}

describe('applyIdentityTransition — feature change', () => {
  let useStore: ReturnType<typeof buildStore>;
  beforeEach(() => {
    useStore = buildStore();
    seed(useStore);
    useStore.getState().applyIdentityTransition({ scope: 'feature', prevProject: P, prevFeature: F1 });
  });

  it('preserves conversation/board runtime (SSE/session refill)', () => {
    const s = useStore.getState();
    expect(s.session).toEqual({ state: { jobId: 'j' } });
    expect(s.chatEvents).toEqual([{ id: 'c1' }]);
    expect(s.kanban.jobId).toBe('j');
    expect(s.isRunning).toBe(true);
    expect(s.currentJobId).toBe('j');
  });

  it('clears transient editor/figma/parallel-job state', () => {
    const s = useStore.getState();
    expect(s.editorTabs).toEqual([]);
    expect(s.activeEditorTabId).toBeNull();
    expect(s.figmaPopulated).toBeNull();
    expect(s.activeJobs).toEqual({});
  });

  it('closes fileEdit + transfer but keeps previewConfig open', () => {
    const s = useStore.getState();
    expect(s.mainPanelOpenTabs.fileEdit).toBe(false);
    expect(s.mainPanelOpenTabs.transfer).toBe(false);
    expect(s.mainPanelOpenTabs.previewConfig).toBe(true);
    // active tab was previewConfig — stays put (not one of the closed tabs).
    expect(s.mainPanelActiveTab).toBe('previewConfig');
  });

  it('clears the transfer pre-selected source', () => {
    expect(useStore.getState().sendPreselectedSource).toBeNull();
  });

  it('evicts the previous feature preview + deploy + custom-domain buckets', () => {
    const key = makeFeatureKey(P, F1)!;
    const s = useStore.getState();
    expect(s.previewByFeature[key]).toBeUndefined();
    expect(s.deployByFeature[key]).toBeUndefined();
    expect(s.customDomainsByFeature[key]).toBeUndefined();
    expect(s.customDomainEnabledByFeature[key]).toBeUndefined();
  });
});

describe('applyIdentityTransition — project change', () => {
  let useStore: ReturnType<typeof buildStore>;
  beforeEach(() => {
    useStore = buildStore();
    seed(useStore);
    useStore.getState().applyIdentityTransition({ scope: 'project', prevProject: P, prevFeature: F1 });
  });

  it('wipes conversation/board/session runtime', () => {
    const s = useStore.getState();
    expect(s.session).toBeUndefined();
    expect(s.chatEvents).toEqual([]);
    expect(s.streamingBuffers).toEqual({});
    expect(s.kanban.jobId).toBeUndefined();
    expect(s.isRunning).toBe(false);
    expect(s.currentJobId).toBeUndefined();
  });

  it('closes previewConfig in addition to fileEdit + transfer', () => {
    const s = useStore.getState();
    expect(s.mainPanelOpenTabs.previewConfig).toBe(false);
    expect(s.mainPanelOpenTabs.fileEdit).toBe(false);
    expect(s.mainPanelOpenTabs.transfer).toBe(false);
    // active tab was previewConfig (now closed) → falls back to 'job'.
    expect(s.mainPanelActiveTab).toBe('job');
  });

  it('keeps the pipelines tab open — the panel is account-scoped (cross-project)', () => {
    expect(useStore.getState().mainPanelOpenTabs.pipelines).toBe(true);
  });

  it('evicts the previous feature buckets', () => {
    const key = makeFeatureKey(P, F1)!;
    expect(useStore.getState().previewByFeature[key]).toBeUndefined();
    expect(useStore.getState().deployByFeature[key]).toBeUndefined();
  });
});

describe('setters delegate to applyIdentityTransition (single owner)', () => {
  it('setSelectedFeature calls applyIdentityTransition with scope=feature + prev identity', () => {
    const useStore = buildStore();
    seed(useStore);
    const spy = vi.fn();
    useStore.setState({ applyIdentityTransition: spy } as any);

    useStore.getState().setSelectedFeature(F2);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'feature', prevProject: P, prevFeature: F1 }),
    );
    expect(useStore.getState().selectedFeature).toBe(F2);
  });

  it('setSelectedProject calls applyIdentityTransition with scope=project + prev identity', () => {
    const useStore = buildStore();
    seed(useStore);
    const spy = vi.fn();
    useStore.setState({
      applyIdentityTransition: spy,
      fetchFeatures: vi.fn(),
    } as any);

    useStore.getState().setSelectedProject('proj-2');

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'project', prevProject: P, prevFeature: F1 }),
    );
    expect(useStore.getState().selectedProject).toBe('proj-2');
  });
});
