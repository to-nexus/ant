/**
 * buildLlmBreadcrumbSummary — LLM path with timeout/fallback contract.
 *
 * job-context-bridge T4. Verifies:
 *   - LLM success path returns trimmed LLM output
 *   - Missing llm or promptPort → fallback to directive paraphrase
 *   - Template render failure → fallback
 *   - LLM throws → fallback
 *   - LLM returns empty / whitespace → fallback
 *   - LLM exceeds timeout → fallback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildLlmBreadcrumbSummary,
  BREADCRUMB_SUMMARY_TIMEOUT_MS,
} from '../../../src/core/context/breadcrumbSummary';
import type { LLMClient } from '../../../src/core/ports/llm';
import type { PromptPort } from '../../../src/core/ports/prompt';

function makePromptPort(): PromptPort {
  return {
    render: vi.fn().mockResolvedValue('rendered system prompt'),
  };
}

function makeLLM(content: string | (() => Promise<string>)): LLMClient {
  return {
    provider: 'test',
    modelName: 'test-model',
    invoke: vi.fn().mockImplementation(async () =>
      typeof content === 'function' ? content() : content,
    ),
    invokeStructured: vi.fn() as any,
    stream: vi.fn() as any,
  };
}

const baseInput = {
  directive: 'OAuth 로그인 추가해줘',
  mode: 'generate' as const,
  created: ['apps/web/auth/login.tsx'],
  modified: ['packages/auth/session.ts'],
  deleted: [] as string[],
  touchedCount: 2,
};

describe('buildLlmBreadcrumbSummary', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns trimmed LLM output on success', async () => {
    const llm = makeLLM('  OAuth 로그인 플로우 추가  ');
    const promptPort = makePromptPort();
    const result = await buildLlmBreadcrumbSummary({
      ...baseInput,
      llm,
      promptPort,
    });
    expect(result).toBe('OAuth 로그인 플로우 추가');
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    expect(promptPort.render).toHaveBeenCalledWith(
      'infra/breadcrumb-summary/system',
      expect.objectContaining({ directive: 'OAuth 로그인 추가해줘', mode: 'generate' }),
    );
  });

  it('passes the rendered system prompt as a system role message (adapter contract)', async () => {
    // Regression: every adapter (Anthropic / OpenAI / Gemini) extracts the
    // system prompt from `messages.find(m => m.role === 'system')` and
    // ignores any `options.system` field. Passing the system body via
    // options used to silently strip the entire context, leaving only
    // the bare "Produce the breadcrumb summary." user line — the LLM
    // then politely answered "what would you like me to summarize?" and
    // that text got persisted as the BC summary verbatim.
    const llm = makeLLM('summary text');
    const promptPort: PromptPort = {
      render: vi.fn().mockResolvedValue('rendered system prompt'),
    };
    await buildLlmBreadcrumbSummary({ ...baseInput, llm, promptPort });

    expect(llm.invoke).toHaveBeenCalledTimes(1);
    const [messagesArg, optsArg] = (llm.invoke as any).mock.calls[0];

    expect(messagesArg).toEqual([
      { role: 'system', content: 'rendered system prompt' },
      { role: 'user', content: 'Produce the breadcrumb summary.' },
    ]);
    // System content must NOT be smuggled through options — adapters
    // ignore that path entirely.
    expect(optsArg).toBeDefined();
    expect((optsArg as any).system).toBeUndefined();
    expect((optsArg as any).maxTokens).toBeGreaterThan(0);
  });

  it('falls back to paraphrase when llm is missing', async () => {
    const result = await buildLlmBreadcrumbSummary({ ...baseInput, promptPort: makePromptPort() });
    expect(result).toContain('OAuth 로그인 추가해줘');
    expect(result).toContain('2 files');
  });

  it('falls back to paraphrase when promptPort is missing', async () => {
    const llm = makeLLM('should not be called');
    const result = await buildLlmBreadcrumbSummary({ ...baseInput, llm });
    expect(result).toContain('OAuth 로그인 추가해줘');
    expect(llm.invoke).not.toHaveBeenCalled();
  });

  it('falls back when promptPort.render throws', async () => {
    const llm = makeLLM('should not be reached');
    const promptPort: PromptPort = {
      render: vi.fn().mockRejectedValue(new Error('template missing')),
    };
    const result = await buildLlmBreadcrumbSummary({ ...baseInput, llm, promptPort });
    expect(result).toContain('OAuth 로그인 추가해줘');
    expect(llm.invoke).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('template render failed'),
      expect.anything(),
    );
  });

  it('falls back when llm.invoke throws', async () => {
    const llm = makeLLM(async () => {
      throw new Error('rate limited');
    });
    const result = await buildLlmBreadcrumbSummary({
      ...baseInput,
      llm,
      promptPort: makePromptPort(),
    });
    expect(result).toContain('OAuth 로그인 추가해줘');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM call failed'),
      expect.anything(),
    );
  });

  it('falls back when llm returns empty content', async () => {
    const llm = makeLLM('   ');
    const result = await buildLlmBreadcrumbSummary({
      ...baseInput,
      llm,
      promptPort: makePromptPort(),
    });
    expect(result).toContain('OAuth 로그인 추가해줘');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM returned empty content'),
    );
  });

  it('falls back when llm exceeds the timeout', async () => {
    vi.useFakeTimers();
    try {
      const slowInvoke = new Promise<string>(() => {
        /* never resolves */
      });
      const llm: LLMClient = {
        provider: 'test',
        modelName: 'slow',
        invoke: vi.fn().mockReturnValue(slowInvoke),
        invokeStructured: vi.fn() as any,
        stream: vi.fn() as any,
      };
      const promise = buildLlmBreadcrumbSummary({
        ...baseInput,
        llm,
        promptPort: makePromptPort(),
      });
      // Drive the timer past the timeout cap so the fallback path runs.
      await vi.advanceTimersByTimeAsync(BREADCRUMB_SUMMARY_TIMEOUT_MS + 100);
      const result = await promise;
      expect(result).toContain('OAuth 로그인 추가해줘');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('LLM call failed'),
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
