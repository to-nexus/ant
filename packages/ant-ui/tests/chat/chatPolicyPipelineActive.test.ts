/**
 * useChatPolicy pipeline lock — while the selected project is OWNED by an
 * active pipeline, the chat input locks with a pipeline reason. The branch
 * sits BEFORE the isRunning branch on purpose: a pipeline-driven isRunning
 * must not fall into the plain 'job-running' stop semantics (a raw stop would
 * kill a scheduled step under the scheduler).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { storeState, useStoreMock } = vi.hoisted(() => {
  const storeState: any = {};
  const useStoreMock: any = (selector: any) => selector(storeState);
  useStoreMock.getState = () => storeState;
  return { storeState, useStoreMock };
});

vi.mock('@/domain/store', () => ({ useStore: useStoreMock }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useChatPolicy } from '../../src/application/hooks/ui/useChatPolicy';

beforeEach(() => {
  Object.assign(storeState, {
    serverMode: { status: 'ready', data: 'local' },
    userEmail: null,
    selectedAgent: 'universal',
    selectedProject: 'proj',
    selectedFeature: 'universal',
    selectedJobType: 'universal',
    isRunning: false,
    isQueued: false,
    queuePosition: null,
    kanban: null,
    dismissedInterruptTimestamp: null,
    activePipelineByProject: {},
  });
});

describe('useChatPolicy — pipeline-owned project lock', () => {
  it("reports 'pipeline-active' (send blocked) while the pipeline waits between fires", () => {
    storeState.activePipelineByProject = {
      proj: { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting', nextFireAt: '2026-08-21T00:00:00.000Z', liveRuns: [] },
    };
    const policy = useChatPolicy();
    expect(policy.reason).toBe('pipeline-active');
    expect(policy.canSendMessage).toBe(false);
    expect(policy.canChangeJob).toBe(false);
  });

  const LIVE = (runId: string, status: 'running' | 'awaiting_human' = 'running') => ({ runId, status, startedAt: 'now', firedBy: 'manual', currentStepIds: [] });

  it("reports 'pipeline-running' and WINS over isRunning while a step executes", () => {
    storeState.isRunning = true;
    storeState.activePipelineByProject = {
      proj: { pipelineId: 'p1', pipelineName: 'Digest', state: 'running', liveRuns: [LIVE('r1')] },
    };
    expect(useChatPolicy().reason).toBe('pipeline-running');
  });

  it("treats 'awaiting_human' as running (a live run holds the project)", () => {
    storeState.activePipelineByProject = {
      proj: { pipelineId: 'p1', pipelineName: 'Digest', state: 'awaiting_human', liveRuns: [LIVE('r1', 'awaiting_human')] },
    };
    expect(useChatPolicy().reason).toBe('pipeline-running');
  });

  // The lock reads the live SET (user decision: any live run locks the chat).
  it('N live runs lock exactly like one', () => {
    storeState.activePipelineByProject = {
      proj: { pipelineId: 'p1', pipelineName: 'Digest', state: 'running', liveRuns: [LIVE('r1'), LIVE('r2'), LIVE('r3')] },
    };
    const policy = useChatPolicy();
    expect(policy.reason).toBe('pipeline-running');
    expect(policy.canSendMessage).toBe(false);
  });

  it('another project\'s activation never locks this one', () => {
    storeState.activePipelineByProject = {
      other: { pipelineId: 'p1', pipelineName: 'Digest', state: 'waiting', liveRuns: [] },
    };
    expect(useChatPolicy().reason).toBe('ready');
  });

  it('a deactivated (null) entry reads as unlocked', () => {
    storeState.activePipelineByProject = { proj: null };
    expect(useChatPolicy().reason).toBe('ready');
  });
});
