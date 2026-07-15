/**
 * Detect `<targetMismatch>` escape hatch (sharp-choking-glove RCA).
 *
 * Infer-only, user-mediated: detect never re-classifies the intent — when the
 * revise-candidate document's CONTENT is unrelated to the directive, it
 * reports evidence and the orchestrator surfaces the existing
 * redirect-suggested choice card offering the gen-* sibling. The hatch is
 * offered only for revise-kind intents with a deterministic sibling
 * (suggestReviseFallback — reuses the suggestAlternatives RULES rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/common/llm/callLLMWithToolLoop', () => ({
  callLLMWithToolLoop: vi.fn(),
}));

import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import { inferRacWithTools } from '../../src/agents/common/graph/nodes/detect/inferRacWithTools';
import { parseDetectResponse, isEmptyDetectResponse } from '../../src/agents/common/graph/nodes/detect/parseDetectResponse';
import { suggestReviseFallback } from '../../src/agents/common/graph/nodes/detect/suggestAlternatives';

const llmRespond = (text: string) => {
  (callLLMWithToolLoop as any).mockResolvedValue({ response: text });
};

const baseInput = () =>
  ({
    intentId: 'rev-spec',
    domain: 'service',
    workspaceState: {
      hasArchitectureSpec: true,
      specDocNames: ['defect-fixes.md'],
      hasCodebase: false,
    },
    fileSystem: {},
    llm: {} as any,
    promptBuilder: { render: vi.fn(async () => 'prompt') } as any,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseDetectResponse — <targetMismatch>', () => {
  it('parses the self-closing tag with a reason attribute', () => {
    const p = parseDetectResponse('<targetMismatch reason="doc covers other defects"/>');
    expect(p.targetMismatch).toEqual({ reason: 'doc covers other defects' });
    expect(isEmptyDetectResponse(p)).toBe(false);
  });

  it('parses the tag without a reason', () => {
    const p = parseDetectResponse('<targetMismatch/>');
    expect(p.targetMismatch).toEqual({});
    expect(isEmptyDetectResponse(p)).toBe(false);
  });
});

describe('suggestReviseFallback — rev→gen sibling mapping (single owner)', () => {
  it('maps rev-spec → gen-spec regardless of workspace state', () => {
    expect(suggestReviseFallback('rev-spec' as any).map(a => a.intentId)).toEqual(['gen-spec']);
  });

  it('returns [] for non-revise intents and for rev-code (no doc sibling)', () => {
    expect(suggestReviseFallback('gen-spec' as any)).toEqual([]);
    expect(suggestReviseFallback('rev-code' as any)).toEqual([]);
  });
});

describe('inferRacWithTools — hatch gating', () => {
  it('rev-spec + <targetMismatch> → redirect-suggested with the gen-spec sibling card', async () => {
    llmRespond('<targetMismatch reason="existing spec covers different defects"/>');
    const result = await inferRacWithTools(baseInput());

    expect(result.status).toBe('redirect-suggested');
    expect(result.suggestedAlternatives?.[0]?.intentId).toBe('gen-spec');
    expect(result.choiceOptions?.positive?.action).toBe('redirect');
    expect(result.displayMessage).toContain('defect-fixes.md');
  });

  it('offers allowTargetMismatch only for revise-kind intents (template gate var)', async () => {
    llmRespond('<targetMismatch reason="x"/>');
    const input = baseInput();
    await inferRacWithTools(input);
    const renderedVars = (input.promptBuilder.render as any).mock.calls[0][1];
    expect(renderedVars.allowTargetMismatch).toBe(true);
  });

  it('ignores an ungated <targetMismatch> from a generate-kind intent and proceeds with slots', async () => {
    llmRespond('<slots><target>architecture/spec/new-defects.md</target></slots>\n<targetMismatch reason="invented"/>');
    const input = { ...baseInput(), intentId: 'gen-spec' };
    const result = await inferRacWithTools(input);

    expect((input.promptBuilder.render as any).mock.calls[0][1].allowTargetMismatch).toBe(false);
    expect(result.status).toBe('proceed');
    expect(result.resolvedAction?.intent).toBe('gen-spec');
  });
});
