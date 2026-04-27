/**
 * Regression tests for the design-job figma worker bug where cloud-mode
 * worker calls failed with `BridgeMCPTransport requires userId and redis`.
 *
 * Coverage:
 * - common figma handler propagates `ctx.userId` / `ctx.redis` / `ctx.taskId`
 *   to `callFigmaMCPTool` (the user-visible bug fix).
 * - common figma handler enriches chat-status meta with `nodeName` when
 *   `ctx.figmaExplorationResult.nodeSummary` is present (UX preservation).
 * - design root-call guidance pre-check short-circuits without an MCP
 *   call when `nodeId` is the root frame and a nodeSummary is loaded.
 * - design tool node `applyFigmaSideEffects` correctly accumulates
 *   `_figmaConsecutiveErrors` and flips `_figmaConnectionLost` once the
 *   threshold is crossed (Gate 1.5 wiring).
 * - design ctx-pure `download_asset` handler routes through the cloud
 *   bridge when `ctx.userId` / `ctx.redis` are present.
 * - design ctx-pure `read_source_doc` handler reads from the artifact
 *   pool injected via `ctx.sourceDocuments`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNoopChatStatusReporter } from '../src/agents/common/tool/chatStatusAdapter';
import type { ToolExecutionContext, ToolSideEffect } from '../src/agents/common/tool/types';
import { applyFigmaSideEffects } from '../src/agents/architect/graph/design/nodes/tool/index';
import { maybeRootCallGuidance } from '../src/agents/architect/graph/design/nodes/tool/rootCallGuidance';
import { createDesignToolHandlers } from '../src/agents/architect/graph/design/nodes/tool/designToolAdapters';
import type { DesignGraphState } from '../src/agents/architect/graph/design/state';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Mocks
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const mockCallFigmaMCPTool = vi.fn();
const mockProxyAssetDownload = vi.fn();

vi.mock('../src/periphery/adapters/figma/figmaMCPHandler', async () => {
  const actual = await vi.importActual<any>('../src/periphery/adapters/figma/figmaMCPHandler');
  return {
    ...actual,
    callFigmaMCPTool: (...args: any[]) => mockCallFigmaMCPTool(...args),
    saveFigmaScreenshot: vi.fn(async () => 'sessions/architect/runtime/design/figma/screenshots/0-1.png'),
  };
});

vi.mock('../src/periphery/adapters/figma/MCPTransport', async () => {
  const actual = await vi.importActual<any>('../src/periphery/adapters/figma/MCPTransport');
  return {
    ...actual,
    proxyAssetDownload: (...args: any[]) => mockProxyAssetDownload(...args),
    isFigmaLocalAssetUrl: (url: string) => url.startsWith('http://localhost:3845') || url.startsWith('http://127.0.0.1:3845'),
  };
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildCtx(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    fileSystem: {} as any,
    chatStatus: createNoopChatStatusReporter(),
    workingDir: '/tmp/feature',
    featurePath: '/tmp/feature',
    project: 'posa',
    featureFolder: 'base',
    redis: { __mock: 'redis' } as any,
    figmaFileKey: 'fkey-1',
    figmaConfig: { file: 'https://www.figma.com/design/fkey-1/Test?node-id=0-1' },
    figmaExplorationResult: undefined,
    figmaAvailable: true,
    userId: 'u-1',
    organizationId: 'org-1',
    taskId: 'ui-tokens-ch1',
    assetsRoot: 'inputs/assets/service',
    ...overrides,
  };
}

function getDesignFigmaHandler(name: string) {
  const handlers = createDesignToolHandlers();
  const h = handlers.get(name);
  if (!h) throw new Error(`Handler not registered: ${name}`);
  return h;
}

beforeEach(() => {
  mockCallFigmaMCPTool.mockReset();
  mockProxyAssetDownload.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. userId / redis / taskId propagation through the design figma path
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design figma adapter — userId/redis/taskId propagation', () => {
  it('forwards ctx.userId and ctx.redis to callFigmaMCPTool (regression: BridgeMCPTransport requires userId and redis)', async () => {
    mockCallFigmaMCPTool.mockResolvedValue('<some>data</some>');
    const handler = getDesignFigmaHandler('figma_get_metadata');
    const ctx = buildCtx();

    await handler(ctx, { nodeId: '5087:4505' });

    expect(mockCallFigmaMCPTool).toHaveBeenCalledTimes(1);
    const opts = mockCallFigmaMCPTool.mock.calls[0][0];
    expect(opts.userId).toBe('u-1');
    expect(opts.redis).toBe(ctx.redis);
    expect(opts.taskId).toBe('ui-tokens-ch1');
  });

  it('forwards distinct taskIds across worker invocations', async () => {
    mockCallFigmaMCPTool.mockResolvedValue('<some>data</some>');
    const handler = getDesignFigmaHandler('figma_get_design_context');

    await handler(buildCtx({ taskId: 'ui-tokens-ch1' }), { nodeId: 'a' });
    await handler(buildCtx({ taskId: 'ui-assets-ch1' }), { nodeId: 'b' });

    expect(mockCallFigmaMCPTool.mock.calls[0][0].taskId).toBe('ui-tokens-ch1');
    expect(mockCallFigmaMCPTool.mock.calls[1][0].taskId).toBe('ui-assets-ch1');
  });

  it('returns figmaSuccess sideEffect on ok call (drives counter reset in afterExecution)', async () => {
    mockCallFigmaMCPTool.mockResolvedValue('<some>data</some>');
    const handler = getDesignFigmaHandler('figma_get_metadata');

    const result = await handler(buildCtx(), { nodeId: '5087:4505' });
    expect(result.sideEffects).toEqual([{ type: 'figmaSuccess' }]);
  });

  it('returns figmaError(category=connection) sideEffect when callFigmaMCPTool rejects with a transport error', async () => {
    mockCallFigmaMCPTool.mockRejectedValue(new Error('Bridge MCP request timed out after 30000ms'));
    const handler = getDesignFigmaHandler('figma_get_metadata');

    const result = await handler(buildCtx(), { nodeId: '5087:4505' });
    expect(result.error).toBeTruthy();
    expect(result.sideEffects).toEqual([{ type: 'figmaError', category: 'connection' }]);
  });

  it('returns figmaError(category=data) sideEffect for per-request errors that should not bump connection counter', async () => {
    mockCallFigmaMCPTool.mockRejectedValue(new Error('Node not found: 9999:0'));
    const handler = getDesignFigmaHandler('figma_get_metadata');

    const result = await handler(buildCtx(), { nodeId: '9999:0' });
    expect(result.sideEffects).toEqual([{ type: 'figmaError', category: 'data' }]);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. nodeName lookup in chat status meta (UX preservation)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('common figma handler — nodeName chat status enrichment', () => {
  it('attaches nodeName from figmaExplorationResult.nodeSummary to figma_calling/figma_called meta', async () => {
    mockCallFigmaMCPTool.mockResolvedValue('<ok/>');
    const showStatus = vi.fn(async () => 'merge-1');
    const ctx = buildCtx({
      chatStatus: { ...createNoopChatStatusReporter(), showStatus } as any,
      figmaExplorationResult: {
        nodeSummary: [
          { nodeId: '3038:19035', name: 'phase1', type: 'SECTION', depth: 1, childCount: 12 },
          { nodeId: '5087:4505', name: '디자인에셋', type: 'FRAME', depth: 1, childCount: 8 },
        ],
      },
    });
    const handler = getDesignFigmaHandler('figma_get_design_context');

    await handler(ctx, { nodeId: '3038:19035' });

    expect(showStatus).toHaveBeenCalled();
    const callingCall = showStatus.mock.calls.find(([key]) => key === 'figma_calling');
    expect(callingCall?.[1]).toMatchObject({ nodeId: '3038:19035', nodeName: 'phase1' });
  });

  it('falls back to nodeId-only meta when nodeSummary is absent (code job behaviour preserved)', async () => {
    mockCallFigmaMCPTool.mockResolvedValue('<ok/>');
    const showStatus = vi.fn(async () => 'merge-1');
    const ctx = buildCtx({
      chatStatus: { ...createNoopChatStatusReporter(), showStatus } as any,
      figmaExplorationResult: undefined,
    });
    const handler = getDesignFigmaHandler('figma_get_metadata');

    await handler(ctx, { nodeId: '3038:19035' });

    const callingCall = showStatus.mock.calls.find(([key]) => key === 'figma_calling');
    expect(callingCall?.[1]).toMatchObject({ nodeId: '3038:19035' });
    expect(callingCall?.[1]?.nodeName).toBeUndefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. Root-call guidance pre-check (design wrapper)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('maybeRootCallGuidance', () => {
  const nodeSummary = [
    { nodeId: '3038:19035', name: 'phase1', type: 'SECTION', depth: 1, childCount: 5 },
    { nodeId: '5087:4505', name: 'assets', type: 'FRAME', depth: 1, childCount: 3 },
    { nodeId: '5087:4506', name: 'deep', type: 'TEXT', depth: 3, childCount: 0 },
  ];

  it('returns guidance JSON for non-screenshot tools when nodeId is root and nodeSummary is loaded', () => {
    const ctx = buildCtx({ figmaExplorationResult: { nodeSummary } });
    const out = maybeRootCallGuidance(ctx, { nodeId: '0:1' }, 'figma_get_metadata');
    expect(out).toBeTruthy();
    const parsed = JSON.parse(out!);
    expect(parsed.tool).toBe('figma_get_metadata');
    expect(parsed.guidance).toContain('phase1');
    expect(parsed.guidance).toContain('assets');
    // Deep text node not promoted as a top-level frame.
    expect(parsed.guidance).not.toContain('deep');
  });

  it('also handles 0-1 form (Figma URL parsed normalisation)', () => {
    const ctx = buildCtx({ figmaExplorationResult: { nodeSummary } });
    expect(maybeRootCallGuidance(ctx, { nodeId: '0-1' }, 'figma_get_design_context')).toBeTruthy();
  });

  it('does not redirect figma_get_screenshot calls (image of the root is legitimate)', () => {
    const ctx = buildCtx({ figmaExplorationResult: { nodeSummary } });
    expect(maybeRootCallGuidance(ctx, { nodeId: '0:1' }, 'figma_get_screenshot')).toBeNull();
  });

  it('does nothing when nodeId is not root', () => {
    const ctx = buildCtx({ figmaExplorationResult: { nodeSummary } });
    expect(maybeRootCallGuidance(ctx, { nodeId: '3038:19035' }, 'figma_get_metadata')).toBeNull();
  });

  it('does nothing when nodeSummary is absent (code job: no figmaExplore result)', () => {
    const ctx = buildCtx({ figmaExplorationResult: undefined });
    expect(maybeRootCallGuidance(ctx, { nodeId: '0:1' }, 'figma_get_metadata')).toBeNull();
  });

  it('design adapter short-circuits the root call (no MCP fetch)', async () => {
    const handler = getDesignFigmaHandler('figma_get_metadata');
    const ctx = buildCtx({ figmaExplorationResult: { nodeSummary } });

    const result = await handler(ctx, { nodeId: '0:1' });

    expect(mockCallFigmaMCPTool).not.toHaveBeenCalled();
    expect(typeof result.content).toBe('string');
    const parsed = JSON.parse(result.content as string);
    expect(parsed.tool).toBe('figma_get_metadata');
    // Pure redirection hint — no figma sideEffect emitted.
    expect(result.sideEffects ?? []).toEqual([]);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. applyFigmaSideEffects — Gate 1.5 wiring
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('applyFigmaSideEffects', () => {
  function figmaPipelineState(): DesignGraphState {
    return {
      planText: '',
      conversations: {},
      context: { project: 'p', featureFolder: 'f', workingDir: '/tmp', featurePath: '/tmp', userLanguage: 'en' as const, userId: 'u', organizationId: 'o' },
      resolvedAction: { intent: 'gen-ui-figma', intentGroup: 'design-ui', mode: 'generate' as any, target: [], refs: [], context: [], packages: [], basis: {} as any, source: 'inferred' as any, intentDescription: '' },
      figmaConfig: { file: 'https://figma.com/design/k/n?node-id=0-1' },
      figmaAvailable: true,
    } as any;
  }

  it('resets _figmaConsecutiveErrors on figmaSuccess', () => {
    const state = figmaPipelineState();
    state._figmaConsecutiveErrors = 2;
    applyFigmaSideEffects(state, [{ type: 'figmaSuccess' }]);
    expect(state._figmaConsecutiveErrors).toBe(0);
    expect(state._figmaConnectionLost).toBeFalsy();
  });

  it('increments _figmaConsecutiveErrors and flips _figmaConnectionLost at threshold (3) for connection errors', () => {
    const state = figmaPipelineState();
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    expect(state._figmaConsecutiveErrors).toBe(1);
    expect(state._figmaConnectionLost).toBeFalsy();
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    expect(state._figmaConsecutiveErrors).toBe(2);
    expect(state._figmaConnectionLost).toBeFalsy();
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    expect(state._figmaConsecutiveErrors).toBe(3);
    expect(state._figmaConnectionLost).toBe(true);
  });

  it('also accumulates for environment errors (Figma window not open)', () => {
    const state = figmaPipelineState();
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'environment' }]);
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'environment' }]);
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'environment' }]);
    expect(state._figmaConnectionLost).toBe(true);
  });

  it('does NOT accumulate for data / rate_limit categories (per-request issues)', () => {
    const state = figmaPipelineState();
    for (let i = 0; i < 5; i++) {
      applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'data' }]);
    }
    for (let i = 0; i < 5; i++) {
      applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'rate_limit' }]);
    }
    expect(state._figmaConsecutiveErrors ?? 0).toBe(0);
    expect(state._figmaConnectionLost).toBeFalsy();
  });

  it('does NOT flip _figmaConnectionLost outside the figma pipeline (figmaAvailable=false, intent not figma)', () => {
    const state = figmaPipelineState();
    state.figmaAvailable = false;
    state.resolvedAction = { ...state.resolvedAction!, intent: 'gen-ui-desc' as any };
    state.figmaConfig = undefined;
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    applyFigmaSideEffects(state, [{ type: 'figmaError', category: 'connection' }]);
    // Counter still moves so callers can observe pressure, but the global
    // interrupt flag stays off because no figma pipeline is active.
    expect(state._figmaConsecutiveErrors).toBe(3);
    expect(state._figmaConnectionLost).toBeFalsy();
  });

  it('handles missing sideEffects array gracefully', () => {
    const state = figmaPipelineState();
    expect(() => applyFigmaSideEffects(state, undefined)).not.toThrow();
    expect(() => applyFigmaSideEffects(state, [])).not.toThrow();
  });

  it('mixed sideEffects in one event are applied in order (success after errors resets counter)', () => {
    const state = figmaPipelineState();
    state._figmaConsecutiveErrors = 2;
    const effects: ToolSideEffect[] = [
      { type: 'figmaError', category: 'connection' },
      { type: 'figmaSuccess' },
    ];
    applyFigmaSideEffects(state, effects);
    expect(state._figmaConsecutiveErrors).toBe(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. download_asset — ctx-pure path (cloud-bridge proxy + direct fetch fallback)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design download_asset (ctx-pure)', () => {
  it('routes through proxyAssetDownload when ANT_SERVER_MODE=cloud and ctx carries userId+redis (regression: stateFromCtx userId loss)', async () => {
    vi.stubEnv('ANT_SERVER_MODE', 'cloud');
    mockProxyAssetDownload.mockResolvedValue(Buffer.from([1, 2, 3]));

    const handlers = createDesignToolHandlers();
    const downloadAsset = handlers.get('download_asset');
    expect(downloadAsset).toBeDefined();

    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs/promises');
    const featurePath = await fs.mkdtemp(path.join(os.tmpdir(), 'ant-figma-download-'));

    try {
      const ctx = buildCtx({
        featurePath,
        workingDir: featurePath,
      });

      const result = await downloadAsset!(ctx, {
        url: 'http://127.0.0.1:3845/asset.png',
        filename: 'logo.png',
        category: 'icons',
      });

      expect(mockProxyAssetDownload).toHaveBeenCalledTimes(1);
      const [calledUserId, calledRedis, calledUrl] = mockProxyAssetDownload.mock.calls[0];
      expect(calledUserId).toBe('u-1');
      expect(calledRedis).toBe(ctx.redis);
      expect(calledUrl).toBe('http://127.0.0.1:3845/asset.png');
      expect(result.error).toBeUndefined();
    } finally {
      await fs.rm(featurePath, { recursive: true, force: true });
    }
  });

  it('returns clear error when ctx.assetsRoot is missing (buildContext misconfigured)', async () => {
    const handlers = createDesignToolHandlers();
    const downloadAsset = handlers.get('download_asset')!;
    const ctx = buildCtx({ assetsRoot: undefined });
    const result = await downloadAsset(ctx, { url: 'http://example.com/x.png', filename: 'x.png' });
    expect(result.error).toContain('assetsRoot');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. read_source_doc — ctx.sourceDocuments is the SSOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('design read_source_doc (ctx-pure)', () => {
  // ArtifactPoolView.sourcesAsRecord strips the `inputs/sources/` prefix —
  // filename is the bare basename ('prd.md'), matching how the design LLM
  // refers to source docs in prompts.
  it('returns the matching artifact body from ctx.sourceDocuments', async () => {
    const handlers = createDesignToolHandlers();
    const readSourceDoc = handlers.get('read_source_doc')!;
    const ctx = buildCtx({
      sourceDocuments: [
        {
          path: 'inputs/sources/prd.md',
          content: 'line 1\nline 2\nline 3',
          role: 'context',
          kind: 'sources',
        },
      ],
    });
    const result = await readSourceDoc(ctx, { filename: 'prd.md' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('line 1');
    expect(result.content).toContain('line 3');
  });

  it('returns explicit error with available files when filename misses', async () => {
    const handlers = createDesignToolHandlers();
    const readSourceDoc = handlers.get('read_source_doc')!;
    const ctx = buildCtx({
      sourceDocuments: [
        { path: 'inputs/sources/prd.md', content: 'x', role: 'context', kind: 'sources' },
      ],
    });
    const result = await readSourceDoc(ctx, { filename: 'missing.md' });
    expect(result.error).toBeTruthy();
    expect(result.content).toContain('prd.md');
  });

  it('honours startLine/endLine slicing', async () => {
    const handlers = createDesignToolHandlers();
    const readSourceDoc = handlers.get('read_source_doc')!;
    const ctx = buildCtx({
      sourceDocuments: [
        {
          path: 'inputs/sources/prd.md',
          content: 'a\nb\nc\nd\ne',
          role: 'context',
          kind: 'sources',
        },
      ],
    });
    const result = await readSourceDoc(ctx, { filename: 'prd.md', startLine: 2, endLine: 4 });
    expect(result.content).toContain('Lines 2-4 of 5');
    expect(result.content).toContain('b\nc\nd');
  });
});
