/**
 * Code runner restore gate — mirror of tests/design/design-runner-restore.test.ts.
 * The code runner shares `deriveRestoreMode` (sharp-choking-glove RCA), so a
 * divergent explicit intent / dismissed session must not hijack a new turn,
 * while feedback turns and explicit resumes still restore the queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/architect/graph/code/graph', () => ({
  buildCodeGraph: () => ({}),
}));
vi.mock('../../src/agents/architect/graph/code/nodes/plan/rag', () => ({
  resetKeywordDedup: vi.fn(),
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
vi.mock('../../src/core/session/archive', () => ({
  archiveSupersededState: vi.fn(async () => true),
}));

import { runCodeGraph } from '../../src/agents/architect/graph/code/runner';
import { invokeGraph } from '../../src/agents/common/graph/runnerHelpers';
import { archiveSupersededState } from '../../src/core/session/archive';

/** runCodeGraph returns a summary, not the state — capture the (mutated)
 * initial state the runner handed to the graph. */
async function runAndCaptureState(initial: any): Promise<any> {
  await runCodeGraph(initial);
  const calls = (invokeGraph as any).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
}

function session(over: Record<string, any> = {}) {
  return {
    state: {
      jobId: 'old-code-job',
      taskQueue: [{ id: 'task-1', name: 'Feature', type: 'feature', completed: false }],
      completedTasks: [],
      interruption: {
        reason: 'user_stopped',
        message: 'Task stopped by user',
        timestamp: 't',
        canResume: true,
      },
      resolvedAction: {
        intent: 'gen-code-spec',
        intentGroup: 'code',
        mode: 'generate',
        target: [],
        refs: ['architecture/spec/defect-fixes.md'],
        context: [],
        source: 'infer',
      },
      ...over,
    },
  };
}

function makeInitial(over: Record<string, any> = {}) {
  return {
    context: { project: 'p', featureFolder: 'base' },
    deps: {
      session: { load: vi.fn(async () => session(over.__session ?? {})) },
    },
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== '__session')),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('code runner restore gate (deriveRestoreMode wiring)', () => {
  it('divergent explicit intent → fresh (no queue restore, stale RAC not restored)', async () => {
    const initial = makeInitial({
      overrideDirective: 'build it from the system design instead',
      actionMetadata: { intent: 'gen-code-sys', explicit: true },
    });
    const state = await runAndCaptureState(initial);

    expect(state.isResume).not.toBe(true);
    expect(state.taskQueue).toBeUndefined();
    expect(state.overrideDirective).toBe('build it from the system design instead');
    expect(state.resolvedAction).toBeUndefined();
  });

  it('feedback turn (no intent) → revise context with queue restored', async () => {
    const initial = makeInitial({ overrideDirective: 'also handle the edge case' });
    const state = await runAndCaptureState(initial);

    expect(state.isResume).toBe(true);
    expect(state.taskQueue?.size()).toBe(1);
    expect(state.overrideDirective).toBe('also handle the edge case');
    expect(state.resolvedAction?.intent).toBe('gen-code-spec');
  });

  it('dismissed session → fresh even with a feedback directive', async () => {
    const initial = makeInitial({
      overrideDirective: 'follow-up',
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
    const state = await runAndCaptureState(initial);

    expect(state.isResume).not.toBe(true);
    expect(state.taskQueue).toBeUndefined();
  });

  it('explicit resume → plain continue with queue restored', async () => {
    const initial = makeInitial({ isResume: true });
    const state = await runAndCaptureState(initial);

    expect(state.isResume).toBe(true);
    expect(state.taskQueue?.size()).toBe(1);
    expect(state.overrideDirective).toBeUndefined();
  });

  it('fresh takeover of resumable work archives the superseded state (icy-landing-glade)', async () => {
    const initial = makeInitial({
      overrideDirective: 'follow-up',
      __session: {
        interruption: {
          reason: 'user_stopped', message: 'Dismissed by user', timestamp: 't',
          canResume: true, dismissed: true,
        },
      },
    });
    initial.context.featurePath = '/tmp/feature-x';
    await runAndCaptureState(initial);

    expect(archiveSupersededState).toHaveBeenCalledTimes(1);
    const [featurePath, agent, jobType, state] = (archiveSupersededState as any).mock.calls[0];
    expect(featurePath).toBe('/tmp/feature-x');
    expect(agent).toBe('architect');
    expect(jobType).toBe('code');
    expect(state.jobId).toBe('old-code-job');
  });

  it('revise-context and explicit resume do NOT archive (the slot is being restored, not superseded)', async () => {
    const feedback = makeInitial({ overrideDirective: 'also handle the edge case' });
    feedback.context.featurePath = '/tmp/feature-x';
    await runAndCaptureState(feedback);

    const resume = makeInitial({ isResume: true });
    resume.context.featurePath = '/tmp/feature-x';
    await runAndCaptureState(resume);

    expect(archiveSupersededState).not.toHaveBeenCalled();
  });
});

describe('code runner restores tokenUsageByModel on resume (USD/credit reset guard)', () => {
  const byModel = {
    'claude-opus-5': {
      inputTokens: 1000, outputTokens: 500, totalTokens: 1500,
      cacheReadTokens: 100, cacheCreationTokens: 0, callCount: 4,
    },
  };
  const tokenUsage = { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 };

  it('restores BOTH the aggregate and the per-model map (not just tokens)', async () => {
    // The bug: only `tokenUsage` was restored, so USD/credit (derived from the
    // per-model map) reset to 0 while the token total stayed cumulative.
    const initial = makeInitial({ isResume: true, __session: { tokenUsage, tokenUsageByModel: byModel } });
    const state = await runAndCaptureState(initial);

    expect(state.tokenUsage).toEqual(tokenUsage);
    expect(state.tokenUsageByModel).toEqual(byModel);
  });
});
