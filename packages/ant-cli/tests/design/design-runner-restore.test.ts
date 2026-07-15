/**
 * Design runner restore gate — sharp-choking-glove RCA regression guard.
 *
 * Locks the four restore behaviours of `runDesignGraph`'s session-restore
 * block:
 *   (a) a NEW turn with a divergent EXPLICIT intent is NEVER converted into
 *       a resume (the incident: explicit gen-spec swallowed by rev-spec
 *       leftovers),
 *   (b) a same-work feedback turn restores the queue as revise context and
 *       the NEW directive survives (the old unconditional
 *       `initial.overrideDirective = session.state.overrideDirective`
 *       clobber is dead),
 *   (c) an explicit /resume restores the queue WITHOUT fabricating a
 *       "new directive" out of the session's stored one (plain continue —
 *       not a spurious revise),
 *   (d) a dismissed session never hijacks an implicit new turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/architect/graph/design/graph', () => ({
  buildDesignGraph: () => ({}),
}));
vi.mock('../../src/agents/architect/graph/design/session/checkpoint', () => ({
  saveInterruptionCheckpoint: vi.fn(),
}));
vi.mock('../../src/agents/common/graph/runnerHelpers', () => ({
  loadRecursionLimit: () => 100,
  isRecursionLimitError: () => false,
  cleanupChat: vi.fn(),
  isEnvResume: () => false,
  logResumeMarker: vi.fn(),
  invokeGraph: vi.fn(async (_app: unknown, initial: unknown) => initial),
  saveEarlyDirective: vi.fn(),
}));

import { runDesignGraph } from '../../src/agents/architect/graph/design/runner';

const INCIDENT_DIRECTIVE = 'six game defects…';

function incidentSession(over: Record<string, any> = {}) {
  return {
    state: {
      jobId: 'sharp-choking-glove',
      taskQueue: [{ id: 'spec-game-fixes-1', name: 'Spec: Game Fixes', completed: false }],
      completedTasks: [],
      interruption: {
        reason: 'user_stopped',
        message: 'Task stopped by user',
        timestamp: '2026-07-15T05:10:42.305Z',
        canResume: true,
      },
      resolvedAction: {
        intent: 'rev-spec',
        intentGroup: 'design-spec',
        mode: 'refactor',
        target: ['architecture/spec/defect-fixes.md'],
        refs: ['architecture/spec/defect-fixes.md'],
        context: [],
        source: 'infer',
      },
      // NB: no overrideDirective persisted — the incident shape.
      ...over,
    },
  };
}

function makeInitial(over: Record<string, any> = {}) {
  return {
    context: { project: 'dronewar', featureFolder: 'base' },
    deps: {
      session: { load: vi.fn(async () => incidentSession(over.__session ?? {})) },
    },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== '__session')),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('design runner restore gate (deriveRestoreMode wiring)', () => {
  it('(a) explicit divergent intent → fresh: no queue restore, new directive & metadata intact', async () => {
    const initial = makeInitial({
      overrideDirective: INCIDENT_DIRECTIVE,
      actionMetadata: { intent: 'gen-spec', explicit: true, target: ['architecture/spec/*.md'], refs: ['plan/prd.md'] },
    });
    const state = await runDesignGraph(initial);

    expect(state.isResume).not.toBe(true);
    expect(state.taskQueue).toBeUndefined();
    expect(state.overrideDirective).toBe(INCIDENT_DIRECTIVE);
    // Fresh path: the stale rev-spec RAC must NOT be restored.
    expect(state.resolvedAction).toBeUndefined();
  });

  it('(b) infer feedback turn → revise context: queue restored AND the new directive survives', async () => {
    const initial = makeInitial({ overrideDirective: 'please also fix the HUD overlap' });
    const state = await runDesignGraph(initial);

    expect(state.isResume).toBe(true);
    expect(state.taskQueue?.getAll().map((t: any) => t.id)).toEqual(['spec-game-fixes-1']);
    // The clobber (`initial.overrideDirective = session.state.overrideDirective`)
    // would have wiped this to undefined.
    expect(state.overrideDirective).toBe('please also fix the HUD overlap');
    expect(state.resolvedAction?.intent).toBe('rev-spec');
  });

  it('(c) explicit resume → plain continue: queue restored, NO directive fabricated from the session', async () => {
    const initial = makeInitial({
      isResume: true,
      __session: { overrideDirective: 'original stored directive' },
    });
    const state = await runDesignGraph(initial);

    expect(state.isResume).toBe(true);
    expect(state.taskQueue?.size()).toBe(1);
    // Plain resume must route to continue (parallelOrchestrator/plan), not
    // revise — so overrideDirective stays empty; the stored directive is
    // restored into `directive` only.
    expect(state.overrideDirective).toBeUndefined();
    expect(state.directive).toBe('original stored directive');
  });

  it('(d) dismissed session → fresh even for a same-intent feedback turn', async () => {
    const initial = makeInitial({
      overrideDirective: 'follow-up feedback',
      __session: {
        interruption: {
          reason: 'user_stopped',
          message: 'Dismissed by user',
          timestamp: 't',
          canResume: true,
          dismissed: true,
        },
      },
    });
    const state = await runDesignGraph(initial);

    expect(state.isResume).not.toBe(true);
    expect(state.taskQueue).toBeUndefined();
    expect(state.overrideDirective).toBe('follow-up feedback');
  });

  it('(e) same-intent EXPLICIT turn → revise context with RAC rebuilt from the new metadata', async () => {
    const initial = makeInitial({
      overrideDirective: 'refine the spec with these notes',
      actionMetadata: { intent: 'rev-spec', explicit: true, target: ['architecture/spec/defect-fixes.md'] },
    });
    const state = await runDesignGraph(initial);

    expect(state.isResume).toBe(true);
    expect(state.taskQueue?.size()).toBe(1);
    // resolveResumedActionContext rebuilds the RAC from the explicit turn.
    expect(state.resolvedAction?.intent).toBe('rev-spec');
    expect(state.resolvedAction?.source).toBe('explicit');
  });
});
