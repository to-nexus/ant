/**
 * Detect slot-inference budget + failure recovery (lapis-oaring-drain RCA).
 *
 * The detect tool loop granted the global 64K DEFAULT to rounds whose
 * legitimate output is a few-hundred-token <slots> block; on GLM/OpenAI-compat
 * providers (reasoning shares max_tokens, no server-side cap) a degenerate
 * forced-final round ran ~8 minutes to truncation, and the verbatim retry
 * reproduced the identical failure. Locks in:
 *   1. per-round cap = DETECT_TOOL_LOOP (round-shape budget principle,
 *      gentle-leaping-lathe parity)
 *   2. corrective retry — appended framing note + shrunken round budget,
 *      original messages untouched
 *   3. directive-capable structural fallback — after two empty parses,
 *      proceed with matrix-default slots instead of killing the job
 *   4. `deriveChatNeedsRefs` as the directive-capability SSOT — the legacy
 *      raw read (`slots.chatRequiresRefs ?? true`) mislabeled implicit
 *      directive intents (gen-code-directive) as refs-required in the prompt
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/common/llm/callLLMWithToolLoop', () => ({
  callLLMWithToolLoop: vi.fn(),
}));

import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import { inferRacWithTools } from '../../src/agents/common/graph/nodes/detect/inferRacWithTools';
import { LLM_MAX_TOKENS } from '../../src/agents/common/graph/llmConfig';

const loopMock = callLLMWithToolLoop as unknown as ReturnType<typeof vi.fn>;

const directiveInput = () =>
  ({
    intentId: 'gen-code-directive',
    domain: 'service',
    workspaceState: { hasCodebase: true },
    fileSystem: {},
    llm: {} as any,
    promptBuilder: { render: vi.fn(async () => 'prompt') } as any,
  }) as any;

const refsRequiredInput = () =>
  ({
    intentId: 'rev-spec',
    domain: 'service',
    workspaceState: { hasArchitectureSpec: true, specDocNames: ['spec.md'], hasCodebase: false },
    fileSystem: {},
    llm: {} as any,
    promptBuilder: { render: vi.fn(async () => 'prompt') } as any,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inferRacWithTools — round-shape output budget', () => {
  it('runs the tool loop with DETECT_TOOL_LOOP, never DEFAULT', async () => {
    loopMock.mockResolvedValue({ response: '<slots><context>codebase/src</context></slots>' });
    await inferRacWithTools(directiveInput());

    expect(loopMock).toHaveBeenCalledTimes(1);
    const options = loopMock.mock.calls[0][4];
    expect(options.maxTokens).toBe(LLM_MAX_TOKENS.DETECT_TOOL_LOOP);
    expect(options.maxTokens).not.toBe(LLM_MAX_TOKENS.DEFAULT);
    expect(options.maxRounds).toBe(8);
  });
});

describe('inferRacWithTools — corrective retry (no verbatim replay)', () => {
  it('retries with an appended corrective note and a shrunken round budget', async () => {
    loopMock
      .mockResolvedValueOnce({ response: 'degenerate exploration monologue', stopReason: 'max_tokens', exhausted: true })
      .mockResolvedValueOnce({ response: '<slots><context>codebase/src</context></slots>' });

    const result = await inferRacWithTools(directiveInput());
    expect(result.status).toBe('proceed');
    expect(loopMock).toHaveBeenCalledTimes(2);

    const firstMessages = loopMock.mock.calls[0][1];
    const retryMessages = loopMock.mock.calls[1][1];
    const retryOptions = loopMock.mock.calls[1][4];

    // Retry framing: same system prompt, user prompt + corrective note.
    expect(retryMessages[1].content).toContain(firstMessages[1].content);
    expect(retryMessages[1].content).toContain('previous attempt failed');
    expect(retryOptions.maxRounds).toBe(4);
    // First-attempt messages stay untouched (no note leaked in).
    expect(firstMessages[1].content).not.toContain('previous attempt failed');
  });
});

describe('inferRacWithTools — bare <slots></slots> acceptance (directive-capable)', () => {
  it('accepts an empty-but-present <slots> tag without retrying (prompt-legal output)', async () => {
    loopMock.mockResolvedValue({ response: 'Directive-only run.\n<slots></slots>' });

    const result = await inferRacWithTools(directiveInput());
    expect(loopMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('proceed');
    expect(result.resolvedAction?.hasExplicitFields).toBe(false);
  });

  it('still treats an empty <slots> tag as unusable for refs-required intents', async () => {
    loopMock.mockResolvedValue({ response: '<slots></slots>' });

    await expect(inferRacWithTools(refsRequiredInput())).rejects.toThrow(
      /no parseable <slots> or <missingPrereq>/,
    );
    expect(loopMock).toHaveBeenCalledTimes(2);
  });
});

describe('inferRacWithTools — structural fallback after two empty parses', () => {
  it('directive-capable intent proceeds with matrix-default slots instead of throwing', async () => {
    loopMock.mockResolvedValue({ response: 'no tags at all', stopReason: 'max_tokens', exhausted: true });

    const result = await inferRacWithTools(directiveInput());
    expect(loopMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('proceed');
    expect(result.resolvedAction?.intent).toBe('gen-code-directive');
    expect(result.resolvedAction?.hasExplicitFields).toBe(false);
    expect(result.artifacts).toEqual([]);
  });

  it('refs-required intent still throws after two empty parses', async () => {
    loopMock.mockResolvedValue({ response: 'no tags at all' });

    await expect(inferRacWithTools(refsRequiredInput())).rejects.toThrow(
      /no parseable <slots> or <missingPrereq>/,
    );
    expect(loopMock).toHaveBeenCalledTimes(2);
  });
});

describe('inferRacWithTools — directive-capability prompt gate (deriveChatNeedsRefs SSOT)', () => {
  it('gen-code-directive (implicit, refs=[emptyRef()]) renders the directive-capable branch', async () => {
    loopMock.mockResolvedValue({ response: '<slots></slots>' });
    const input = directiveInput();
    await inferRacWithTools(input);

    const renderedVars = (input.promptBuilder.render as any).mock.calls[0][1];
    expect(renderedVars.chatRequiresRefs).toBe(false);
  });

  it('rev-spec (real ref slots) renders the refs-required branch', async () => {
    loopMock.mockResolvedValue({ response: '<slots><target>architecture/spec/spec.md</target></slots>' });
    const input = refsRequiredInput();
    await inferRacWithTools(input);

    const renderedVars = (input.promptBuilder.render as any).mock.calls[0][1];
    expect(renderedVars.chatRequiresRefs).toBe(true);
  });

  it('bypasses <missingPrereq> for implicit directive-capable intents', async () => {
    loopMock.mockResolvedValue({
      response: '<slots><context>codebase/src</context></slots><missingPrereq required="spec"/>',
    });

    const result = await inferRacWithTools(directiveInput());
    expect(result.status).toBe('proceed');
    expect(result.missingPrerequisites).toBeUndefined();
  });
});
