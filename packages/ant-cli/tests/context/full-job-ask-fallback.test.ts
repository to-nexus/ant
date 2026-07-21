/**
 * E2-5 — full-job ask dead path repair (context-lens remainder).
 *
 * When a full job's (learn/design/code) triage groups the turn as 'ask',
 * the graph ends at __end__ without answering. architect/index.ts must run
 * the ask graph out-of-graph via `answerFullJobAsk` (same wiring as
 * inline-ask dispatch: rich tail → runAskGraph → ephemeral distill) and
 * swap the placeholder message for the real answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const runAskGraphMock = vi.fn();
const buildChatTailMock = vi.fn();
const distillAssistantTurnMock = vi.fn();
const sessionCtorArgs: unknown[][] = [];

vi.mock('../../src/agents/architect/graph/ask/runner', () => ({
  runAskGraph: (...args: unknown[]) => runAskGraphMock(...args),
}));
vi.mock('../../src/core/context/chatTailBuilder', () => ({
  buildChatTail: (...args: unknown[]) => buildChatTailMock(...args),
}));
vi.mock('../../src/core/context/assistantTurn', () => ({
  distillAssistantTurn: (...args: unknown[]) => distillAssistantTurnMock(...args),
}));
vi.mock('../../src/periphery/adapters/session/FileSessionAdapter', () => ({
  FileSessionAdapter: class {
    constructor(...args: unknown[]) {
      sessionCtorArgs.push(args);
    }
  },
}));

import { answerFullJobAsk } from '../../src/agents/architect/graph/ask/fullJobAskFallback';

const WS = { hasPlan: false, hasMetaDirectives: false } as any;

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    question: 'what did you just change?',
    language: 'en' as const,
    featurePath: '/ws/org/user/proj/features/f1',
    projectId: 'proj',
    currentJob: 'design' as const,
    currentAgent: 'architect',
    workspaceState: WS,
    llm: { invoke: vi.fn() },
    jobId: 'job-1',
    turnId: 'turn-1',
    ...overrides,
  };
}

beforeEach(() => {
  runAskGraphMock.mockReset().mockResolvedValue({ response: 'THE ANSWER', toolCallCount: 0 });
  buildChatTailMock.mockReset().mockResolvedValue({ exchanges: [{ user: 'u', assistant: 'a' }] });
  distillAssistantTurnMock.mockReset().mockResolvedValue(undefined);
  sessionCtorArgs.length = 0;
});

describe('answerFullJobAsk', () => {
  it('runs the ask graph with the rich tail and returns the answer', async () => {
    const answer = await answerFullJobAsk(baseParams());

    expect(answer).toBe('THE ANSWER');
    expect(runAskGraphMock).toHaveBeenCalledTimes(1);
    const askParams = runAskGraphMock.mock.calls[0][0] as any;
    expect(askParams.question).toBe('what did you just change?');
    // Tools need featurePath on workspaceState (setWorkspaceFeaturePath).
    expect(askParams.workspaceState.featurePath).toBe('/ws/org/user/proj/features/f1');
    expect(askParams.currentJob).toBe('design');
    expect(askParams._httpJobId).toBe('job-1');
    expect(askParams.recentConversation).toEqual({ exchanges: [{ user: 'u', assistant: 'a' }] });
    // Current turn is excluded from the rich-tail scan (P1 contract).
    expect(buildChatTailMock).toHaveBeenCalledWith(expect.anything(), { excludeTurnId: 'turn-1' });
  });

  it('distills an ephemeral assistant_turn with the answer as finalTextOverride', async () => {
    await answerFullJobAsk(baseParams());

    expect(distillAssistantTurnMock).toHaveBeenCalledTimes(1);
    const distillInput = distillAssistantTurnMock.mock.calls[0][0] as any;
    expect(distillInput.ephemeral).toBe(true);
    expect(distillInput.jobType).toBe('ask');
    expect(distillInput.finalTextOverride).toBe('THE ANSWER');
    expect(distillInput.jobId).toBe('job-1');
    expect(distillInput.turnId).toBe('turn-1');
  });

  it('skips the distill when jobId/turnId are missing (same gate as inline-ask)', async () => {
    await answerFullJobAsk(baseParams({ turnId: undefined }));

    expect(runAskGraphMock).toHaveBeenCalledTimes(1);
    expect(distillAssistantTurnMock).not.toHaveBeenCalled();
  });

  it('returns undefined without invoking the graph when prerequisites are missing', async () => {
    expect(await answerFullJobAsk(baseParams({ featurePath: undefined }))).toBeUndefined();
    expect(await answerFullJobAsk(baseParams({ workspaceState: undefined }))).toBeUndefined();
    expect(await answerFullJobAsk(baseParams({ llm: undefined }))).toBeUndefined();
    expect(runAskGraphMock).not.toHaveBeenCalled();
  });

  it('never throws — an ask graph failure yields undefined (caller keeps placeholder)', async () => {
    runAskGraphMock.mockRejectedValueOnce(new Error('recursion limit'));
    const answer = await answerFullJobAsk(baseParams());
    expect(answer).toBeUndefined();
  });
});

describe('architectAgent ask-branch wiring', () => {
  it('learn branch calls answerFullJobAsk and returns the real answer', async () => {
    vi.resetModules();
    const answerMock = vi.fn().mockResolvedValue('REAL ANSWER');
    vi.doMock('../../src/agents/architect/graph/ask/fullJobAskFallback', () => ({
      answerFullJobAsk: answerMock,
    }));
    vi.doMock('../../src/agents/architect/graph/learn/runner', () => ({
      runLearnGraph: vi.fn().mockResolvedValue({
        stored: 0,
        triageResult: { resolvedIntentId: 'ask-general', group: 'ask', mode: 'explain', domain: 'service' },
        workspaceState: WS,
        directive: 'what is the current plan?',
        turnId: 'turn-9',
      }),
    }));

    const { architectAgent } = await import('../../src/agents/architect/index');
    const result = await architectAgent(
      'what is the current plan?',
      'proj',
      'learn',
      undefined,
      {
        config: { load: vi.fn().mockResolvedValue({ localPath: '/tmp/proj', repoType: 'cloud' }) } as any,
        llm: { invoke: vi.fn() } as any,
        feature: 'f1',
        featurePath: '/ws/proj/features/f1',
      } as any,
      undefined,
      undefined,
      'job-9',
    );

    expect(answerMock).toHaveBeenCalledTimes(1);
    const params = answerMock.mock.calls[0][0] as any;
    expect(params.question).toBe('what is the current plan?');
    expect(params.currentJob).toBe('learn');
    expect(params.turnId).toBe('turn-9');
    expect(params.jobId).toBe('job-9');
    expect(result.message).toBe('REAL ANSWER');
    expect(result.success).toBe(true);

    vi.doUnmock('../../src/agents/architect/graph/ask/fullJobAskFallback');
    vi.doUnmock('../../src/agents/architect/graph/learn/runner');
  });
});
