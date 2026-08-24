/**
 * Detect infer path — user-supplied `actionMetadata` slots survive.
 *
 * Axis file for "whose selection wins". `createInferDetectNode` routes a turn
 * with no explicit `actionMetadata.intent` to `inferRacWithTools`, which never
 * received `actionMetadata` — so every `refs` / `context` / `target` the user
 * picked was silently discarded and replaced by whatever the detect LLM
 * inferred (`near-loading-brace`: two attached screenshots became
 * `context: ['codebase/README.md']`, and the job shipped placeholders for
 * images it was never told existed).
 *
 * Absent `intent` means "the user did not pick an action", NOT "the user
 * selected no files". Inference may ADD; it must never REPLACE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/agents/common/llm/callLLMWithToolLoop', () => ({
  callLLMWithToolLoop: vi.fn(),
}));

import { callLLMWithToolLoop } from '../../src/agents/common/llm/callLLMWithToolLoop';
import { inferRacWithTools } from '../../src/agents/common/graph/nodes/detect/inferRacWithTools';

const loopMock = callLLMWithToolLoop as unknown as ReturnType<typeof vi.fn>;

/** Captured render vars, so prompt assertions test the GATE, not the prose. */
let renderedVars: Record<string, any>[] = [];

const input = (over: Record<string, any> = {}) =>
  ({
    intentId: 'gen-code-directive',
    domain: 'service',
    workspaceState: { hasCodebase: true },
    fileSystem: {},
    llm: {} as any,
    promptBuilder: {
      render: vi.fn(async (_p: string, vars: Record<string, any>) => {
        renderedVars.push(vars);
        return 'prompt';
      }),
    } as any,
    ...over,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  renderedVars = [];
});

describe('inferRacWithTools — user attachments survive the infer path', () => {
  it('carries attached context the LLM did not echo (the near-loading-brace case)', async () => {
    // What the detect LLM came back with: the auto codebase slot only.
    loopMock.mockResolvedValue({
      response: '<slots><context>codebase/README.md</context></slots>',
    });

    const result = await inferRacWithTools(
      input({
        metadata: {
          refs: ['architecture/spec/report.md'],
          context: [
            'visual/ui/handoff/shot-1.png',
            'visual/ui/handoff/shot-2.png',
          ],
        },
      }),
    );

    expect(result.status).toBe('proceed');
    // Additive: the inferred slot survives alongside the user's selection.
    expect(result.resolvedAction?.context).toContain('codebase/README.md');
    expect(result.resolvedAction?.refs).toContain('architecture/spec/report.md');
    // Handoff entries widen to the bundle dir (documented handoff contract).
    expect(result.resolvedAction?.context).toContain('visual/ui/handoff');
  });

  it('leaves `source` at infer — an attachment adds to a RAC, it does not pin it', async () => {
    loopMock.mockResolvedValue({ response: '<slots><context>codebase/src</context></slots>' });

    const result = await inferRacWithTools(
      input({ metadata: { context: ['plan/prd.md'] } }),
    );

    // `computeRacScope` gates every downstream read on source==='explicit';
    // promoting it here would RAC-whitelist a job that was discovering freely.
    expect(result.resolvedAction?.source).toBe('infer');
    expect(result.resolvedAction?.hasExplicitFields).toBe(true);
  });

  it('seeds the tool whitelist with the attached paths', async () => {
    loopMock.mockResolvedValue({ response: '<slots></slots>' });

    await inferRacWithTools(
      input({ metadata: { context: ['visual/ui/handoff/shot-1.png'] } }),
    );

    // Without this the LLM is DENIED the file the user just handed it.
    const vars = renderedVars.at(-1)!;
    expect(vars.whitelistPaths).toContain('visual/ui/handoff/shot-1.png');
  });

  it('states the attachments in the prompt (gate, not prose)', async () => {
    loopMock.mockResolvedValue({ response: '<slots></slots>' });

    await inferRacWithTools(
      input({
        metadata: {
          refs: ['architecture/spec/report.md'],
          context: ['visual/ui/handoff/shot-1.png'],
        },
      }),
    );

    const vars = renderedVars.at(-1)!;
    expect(vars.attachedRefs).toEqual(['architecture/spec/report.md']);
    expect(vars.attachedContext).toEqual(['visual/ui/handoff/shot-1.png']);
  });

  it('does not inject the attachment block when nothing was attached', async () => {
    loopMock.mockResolvedValue({ response: '<slots></slots>' });

    await inferRacWithTools(input());

    const vars = renderedVars.at(-1)!;
    expect(vars.attachedRefs).toEqual([]);
    expect(vars.attachedContext).toEqual([]);
  });

  it('a user-attached ref is not a missing prerequisite', async () => {
    // refs-required intent + the LLM blocking anyway. A hard block ends the
    // turn with nothing, so this is enforced deterministically rather than
    // trusted to the prompt.
    loopMock.mockResolvedValue({ response: '<missingPrereq required="spec"/>' });

    const result = await inferRacWithTools(
      input({
        intentId: 'rev-spec',
        workspaceState: { hasArchitectureSpec: true, specDocNames: ['spec.md'], hasCodebase: false },
        metadata: { refs: ['architecture/spec/spec.md'] },
      }),
    );

    expect(result.status).toBe('proceed');
    expect(result.resolvedAction?.refs).toContain('architecture/spec/spec.md');
  });

  it('still blocks when the user attached nothing', async () => {
    loopMock.mockResolvedValue({ response: '<missingPrereq required="spec"/>' });

    const result = await inferRacWithTools(
      input({
        intentId: 'rev-spec',
        workspaceState: { hasArchitectureSpec: false, hasCodebase: false },
      }),
    );

    expect(result.status).not.toBe('proceed');
  });

  it('an attached UiSource outranks an inferred one (no silent drop)', async () => {
    // handoff is LAST in the static ant>figma>handoff priority, so a blind
    // merge deletes exactly the file the user picked.
    loopMock.mockResolvedValue({
      response: '<slots><context>visual/ui/ant/ui-tokens.json</context></slots>',
    });

    const result = await inferRacWithTools(
      input({ metadata: { context: ['visual/ui/handoff/shot-1.png'] } }),
    );

    const ctx = result.resolvedAction?.context ?? [];
    expect(ctx).toContain('visual/ui/handoff');
    expect(ctx).not.toContain('visual/ui/ant/ui-tokens.json');
  });

  it('a user-supplied target replaces the inferred one', async () => {
    loopMock.mockResolvedValue({
      response: '<slots><target>codebase/wrong.ts</target></slots>',
    });

    const result = await inferRacWithTools(
      input({ metadata: { target: ['codebase/right.ts'] } }),
    );

    expect(result.resolvedAction?.target).toEqual(['codebase/right.ts']);
  });
});
