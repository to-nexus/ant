/**
 * Regression test: design-ui detect must populate `figmaFileKey` /
 * `figmaStartNodeId` once the Figma MCP is reachable.
 *
 * Background — `487cfeab refactor(design-tools): remove state proxies and
 * unify figma flow` moved every figma_* tool handler onto a `ctx`-pure
 * surface that reads `ctx.figmaFileKey` directly and rejects with
 * "Figma fileKey not configured" when the key is missing. The earlier
 * implementation parsed the URL on the fly inside the design-specific
 * handler, which masked the fact that `state.figmaFileKey` was never
 * being seeded for the `design-ui` pipeline. After the refactor, every
 * worker `figma_get_metadata` / `figma_get_design_context` /
 * `figma_get_screenshot` call in a design-ui job started failing with
 * the missing-key error (job `even-getting-knave`, chat.jsonl ll. 12-19).
 *
 * `design-spec` already seeds the key via `checkSpecFigma()`. This test
 * pins the equivalent contract for `design-ui`: detect, after MCP
 * reachability passes, must extract fileKey/startNodeId from
 * `state.figmaConfig.file` and forward them on `stateUpdates` so the
 * worker tool node's `buildContext` can hand them off to ctx.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { extractFigmaUrlParts } from '@ant/shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Module mocks — ChatAPIClient (sends fake LLM events to the chat) and
// MCPTransport (figma reachability probe). Both are imported dynamically
// inside the strategy, so vi.mock by spec string is sufficient.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

vi.mock('../src/core/adapters/ChatAPIClient', async () => {
  return {
    getChatAPIClient: () => ({
      showChatStatus: async () => {},
      sendLLMEvent: async () => {},
      finalizeMessage: async () => {},
    }),
  };
});

const mockCheckLocalMCPAvailability = vi.fn(async () => true);

vi.mock('../src/periphery/adapters/figma/MCPTransport', async () => {
  const actual = await vi.importActual<any>('../src/periphery/adapters/figma/MCPTransport');
  return {
    ...actual,
    checkLocalMCPAvailability: () => mockCheckLocalMCPAvailability(),
  };
});

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mockCheckLocalMCPAvailability.mockClear();
  mockCheckLocalMCPAvailability.mockImplementation(async () => true);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function* makeStream(response: string) {
  yield { type: 'text', text: response };
  yield { type: 'done' };
}

function buildState(opts: { figmaUrl: string; llmResponse: string }) {
  const llm = {
    stream: () => makeStream(opts.llmResponse),
  };
  const promptBuilder = {
    render: async () => '(rendered detect prompt)',
  };

  return {
    directive: '디자인 작업을 수행하라',
    context: {
      project: 'p',
      featureFolder: 'f',
      // Non-existent featurePath — scanInputs / fileExistsInAntDir wrap
      // every fs read in try/catch and degrade gracefully when the
      // directory is missing, so this keeps the test hermetic.
      workingDir: '/tmp/ant-detect-figma-filekey-test',
      featurePath: '/tmp/ant-detect-figma-filekey-test',
      userId: 'u-1',
      organizationId: 'org-1',
      userLanguage: 'ko',
    },
    workspaceState: {
      systemDesignFileNames: [],
    },
    figmaConfig: { file: opts.figmaUrl },
    deps: { llm, promptBuilder, redis: { __mock: 'redis' } },
    conversations: {},
    planText: '',
  } as any;
}

const designUiDetectResponse = `<detect>
{
  "intentGroup": "design-ui",
  "intentGroupReasoning": "Figma URL provided and assets present.",
  "jobMode": "generate",
  "jobModeReasoning": "Generate UI documents from scratch."
}
</detect>`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('designDetectStrategy — figmaFileKey propagation (design-ui)', () => {
  it('extracts fileKey and startNodeId from figmaConfig.file when MCP is reachable (regression: figma_* tools rejected with "fileKey not configured")', async () => {
    const { designDetectStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/detect/strategy'
    );

    const figmaUrl =
      'https://www.figma.com/design/z08MukCkkOSGXiITeSRj5V/-%EB%94%94%EC%9E%90%EC%9D%B8?node-id=5087-4505';
    const expected = extractFigmaUrlParts(figmaUrl);
    expect(expected.fileKey).toBe('z08MukCkkOSGXiITeSRj5V');
    expect(expected.nodeId).toBe('5087:4505');

    const state = buildState({ figmaUrl, llmResponse: designUiDetectResponse });
    const result = await designDetectStrategy.run(state);

    expect(mockCheckLocalMCPAvailability).toHaveBeenCalled();
    expect(result.inferred?.intentId).toBeTruthy();
    expect(result.stateUpdates?.designError).toBeUndefined();

    // The contract: detect MUST seed both keys so the worker subgraph's
    // `buildContext` can hand them off to `ctx.figmaFileKey` /
    // `ctx.figmaStartNodeId`. Without these, the common figma handler's
    // ctx-only check rejects every tool call.
    expect(result.stateUpdates?.figmaFileKey).toBe(expected.fileKey);
    expect(result.stateUpdates?.figmaStartNodeId).toBe(expected.nodeId);
  });

  it('seeds figmaFileKey alone when the URL has no node-id (startNodeId is optional)', async () => {
    const { designDetectStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/detect/strategy'
    );

    const figmaUrl = 'https://www.figma.com/design/abcDEF123/My-Design';
    const state = buildState({ figmaUrl, llmResponse: designUiDetectResponse });
    const result = await designDetectStrategy.run(state);

    expect(result.stateUpdates?.figmaFileKey).toBe('abcDEF123');
    expect(result.stateUpdates?.figmaStartNodeId).toBeUndefined();
    expect(result.stateUpdates?.designError).toBeUndefined();
  });

  it('does not seed figmaFileKey when MCP is unreachable (detect short-circuits with designError before URL parsing)', async () => {
    mockCheckLocalMCPAvailability.mockImplementationOnce(async () => false);

    const { designDetectStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/detect/strategy'
    );

    const figmaUrl =
      'https://www.figma.com/design/unreachable123/Test?node-id=1-2';
    const state = buildState({ figmaUrl, llmResponse: designUiDetectResponse });
    const result = await designDetectStrategy.run(state);

    expect(result.stateUpdates?.designError?.type).toBe('figma_mcp_unavailable');
    expect(result.stateUpdates?.figmaFileKey).toBeUndefined();
    expect(result.stateUpdates?.figmaStartNodeId).toBeUndefined();
  });
});
