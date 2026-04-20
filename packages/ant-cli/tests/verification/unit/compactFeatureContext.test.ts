import { describe, it, expect, vi } from 'vitest';
import type { FeatureContext, MergedUserTurn } from '../../../src/core/context/featureContextBuilder';
import { compactFeatureContext } from '../../../src/core/context/featureContextBuilder';
import type { LLMClient } from '../../../src/core/ports/llm';
import type { PromptPort } from '../../../src/core/ports/prompt';

function makeTurn(idx: number, userLen = 20): MergedUserTurn {
  return {
    type: 'user_turn',
    ts: `2026-04-19T00:00:${String(idx).padStart(2, '0')}.000Z`,
    jobId: `job-${idx}`,
    turnId: `t-${idx}`,
    jobType: 'code',
    text: 'x'.repeat(userLen),
  };
}

function makeCtx(turns: MergedUserTurn[]): FeatureContext {
  return { breadcrumbs: [], userTurns: turns };
}

function makeLLM(summary = 'digest-summary'): LLMClient {
  return {
    invoke: vi.fn().mockResolvedValue(summary),
    invokeWithUsage: vi.fn().mockResolvedValue({
      content: summary,
      usage: { inputTokens: 100, outputTokens: 50 },
    }),
  } as unknown as LLMClient;
}

function makePromptPort(): PromptPort {
  return {
    render: vi.fn().mockResolvedValue('system prompt body'),
  } as unknown as PromptPort;
}

describe('compactFeatureContext — threshold gating', () => {
  it('no-op when userTurns ≤ windowSize', async () => {
    const ctx = makeCtx([makeTurn(1), makeTurn(2)]);
    const llm = makeLLM();
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 10, windowSize: 6 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('no-op when token estimate is under threshold', async () => {
    // 8 turns × 20 chars / 2.8 ≈ 57 tokens → well under 100_000
    const ctx = makeCtx(Array.from({ length: 8 }, (_, i) => makeTurn(i, 20)));
    const llm = makeLLM();
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 100_000, windowSize: 6 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(llm.invoke).not.toHaveBeenCalled();
  });
});

describe('compactFeatureContext — active compaction', () => {
  it('keeps the most recent windowSize entries and populates summary', async () => {
    // 12 turns × 10_000 chars → far above a 12_000-token threshold
    const turns = Array.from({ length: 12 }, (_, i) => makeTurn(i, 10_000));
    const ctx = makeCtx(turns);
    const llm = makeLLM('older-entries-digest');
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 12_000, windowSize: 6 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.summary).toBe('older-entries-digest');
    expect(result.userTurns).toHaveLength(6);
    expect(result.userTurns.map((t) => t.turnId)).toEqual([
      't-6', 't-7', 't-8', 't-9', 't-10', 't-11',
    ]);
    expect(promptPort.render).toHaveBeenCalledWith(
      'infra/compaction/system',
      expect.objectContaining({ conversation: expect.any(String) }),
    );
  });

  it('preserves breadcrumbs untouched during compaction', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(i, 10_000));
    const breadcrumbs = [
      {
        type: 'breadcrumb' as const,
        ts: '2026-04-19T00:10:00.000Z',
        jobId: 'job-9',
        turnId: 't-9',
        jobType: 'code' as const,
        scope: 'modification' as const,
        anchors: { files: ['a.ts'] },
        summary: 'file changed',
        stats: { touched: 1 },
      },
    ];
    const ctx: FeatureContext = { breadcrumbs, userTurns: turns };
    const llm = makeLLM();
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result.wasCompacted).toBe(true);
    expect(result.breadcrumbs).toBe(breadcrumbs);
    expect(result.userTurns).toHaveLength(4);
  });

  it('returns original ctx on LLM failure (graceful degradation)', async () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(i, 10_000));
    const ctx = makeCtx(turns);
    const failingLLM = {
      invoke: vi.fn().mockRejectedValue(new Error('llm down')),
      invokeWithUsage: vi.fn().mockRejectedValue(new Error('llm down')),
    } as unknown as LLMClient;
    const promptPort = makePromptPort();

    const result = await compactFeatureContext(
      ctx,
      { llm: failingLLM, promptPort },
      { threshold: 12_000, windowSize: 4 },
    );

    expect(result).toBe(ctx);
    expect(result.wasCompacted).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.userTurns).toHaveLength(10);
  });
});
