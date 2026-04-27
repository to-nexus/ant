/**
 * Regression tests: design-job `figmaFileKey` / `figmaStartNodeId`
 * propagation must survive every state-entry path (new-job explicit,
 * new-job infer, resume).
 *
 * Background timeline:
 *   - `487cfeab refactor(design-tools): remove state proxies and unify
 *     figma flow` moved every figma_* tool handler onto a `ctx`-pure
 *     surface that reads `ctx.figmaFileKey` directly. The unified handler
 *     rejects with "Figma fileKey not configured" the moment the key is
 *     missing.
 *   - `b808153b fix(design-detect): seed figma fileKey for design-ui
 *     pipeline` added URL parsing inside `designDetectStrategy.run()` —
 *     covered the **infer** path only.
 *   - `840c718d test(design): cover resume figma fileKey rehydrate path`
 *     added rehydration to `designResolveStrategy.onResume` for resumed
 *     checkpoints — covered the **resume** path only.
 *   - `azure-keeping-cairn` (gen-ui-figma, `actionMetadata.explicit=true`)
 *     hit the **explicit** detect branch in `common/graph/nodes/detect/
 *     index.ts` which short-circuits before `strategy.run()` runs, so the
 *     b808153b fix never executed and every worker `figma_*` call fell
 *     back to "Figma fileKey not configured". This was the exact
 *     coverage gap the b808153b/840c718d patches left open.
 *
 * Fix: centralise `figmaConfig.file` → `figmaFileKey/figmaStartNodeId`
 * derivation inside `designResolveStrategy` (the SSOT — resolve is the
 * single point where `figmaConfig` enters state on both new-job and
 * resume). `loadArtifacts` covers new-job (explicit + infer); `onResume`
 * covers resumed checkpoints. `designDetectStrategy` no longer parses
 * the URL — its sole figma responsibility is MCP reachability.
 *
 * The tests below pin that contract:
 *   - `loadArtifacts` always seeds figma keys when `figma.json` carries
 *     a parseable URL — independent of actionMetadata, so explicit and
 *     infer paths converge.
 *   - `onResume` rehydrates from `state.figmaConfig.file` (legacy
 *     checkpoints predate the seeding fix).
 *   - `designDetectStrategy` still surfaces `designError` when MCP is
 *     unreachable, but no longer claims ownership over the keys.
 */

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest';
import { extractFigmaUrlParts, FIGMA_CONFIG_PATH } from '@ant/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

const designUiDetectResponse = `<detect>
{
  "intentGroup": "design-ui",
  "intentGroupReasoning": "Figma URL provided and assets present.",
  "jobMode": "generate",
  "jobModeReasoning": "Generate UI documents from scratch."
}
</detect>`;

function buildDetectState(opts: { figmaUrl: string; llmResponse: string }) {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// loadArtifacts harness — minimal real-fs scaffolding so the figma.json
// read path executes end-to-end. fileSystem/gitPort stubs return empty
// for everything else (sources, directives, system docs) so the test
// stays focused on the SSOT contract this file pins.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface LoadArtifactsHarness {
  featurePath: string;
  cleanup: () => void;
  buildState: (opts: {
    figmaUrl?: string;
    actionMetadataExplicit?: boolean;
    resolvedActionMode?: 'generate' | 'modify' | 'refactor' | undefined;
  }) => any;
}

function makeLoadArtifactsHarness(): LoadArtifactsHarness {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-design-resolve-figma-'));
  const projectName = 'p';
  const featureFolder = 'f';
  const projectPath = path.join(tmpRoot, projectName);
  const featurePath = path.join(projectPath, 'features', featureFolder);
  fs.mkdirSync(featurePath, { recursive: true });

  const fileSystemStub = {
    readFile: async () => null,
    writeFile: async () => {},
    fileExists: async () => false,
    deleteFile: async () => {},
    readDirectory: async () => [],
    createDirectory: async () => {},
    listFiles: async () => [],
    isDirectory: async () => false,
    copyFile: async () => {},
    moveFile: async () => {},
    copyDirectory: async () => {},
    moveDirectory: async () => {},
    getRootPath: () => featurePath,
    getWorkspaceRoot: () => featurePath,
  };

  const gitPortStub = {} as any;

  const workspaceResolver = {
    getProjectPath: () => projectPath,
    getFeaturePath: () => featurePath,
  };

  return {
    featurePath,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
    buildState({ figmaUrl, actionMetadataExplicit, resolvedActionMode }) {
      // Seed the canonical figma.json on disk. `loadArtifacts` reads from
      // `<feature>/outputs/design/ui/figma/figma.json` — the same path the
      // checkout-time figma sync writes to.
      const figmaJsonPath = path.join(featurePath, FIGMA_CONFIG_PATH);
      fs.mkdirSync(path.dirname(figmaJsonPath), { recursive: true });
      if (figmaUrl) {
        fs.writeFileSync(
          figmaJsonPath,
          JSON.stringify({ file: figmaUrl }, null, 2),
          'utf-8',
        );
      } else if (fs.existsSync(figmaJsonPath)) {
        fs.unlinkSync(figmaJsonPath);
      }

      return {
        context: {
          project: projectName,
          featureFolder,
          // featurePath is intentionally LEFT BLANK so `validateWorkspace
          // AndFeature` runs the resolver and writes the resolved path
          // back onto context — mirrors the production call site.
          featurePath: '',
          workingDir: featurePath,
          userId: 'u-1',
          organizationId: 'org-1',
          userLanguage: 'ko',
        },
        // No actionMetadata/explicit handling lives in `loadArtifacts`;
        // it is included here purely as scenario documentation — when set
        // to `true` the regression-flow comment in the test body marks
        // the equivalent of the production `azure-keeping-cairn` job.
        actionMetadata: actionMetadataExplicit
          ? { explicit: true, intent: 'gen-ui-figma' }
          : undefined,
        resolvedAction: resolvedActionMode
          ? { intent: 'gen-ui-figma', mode: resolvedActionMode, slots: {} }
          : undefined,
        deps: {
          git: gitPortStub,
          fileSystem: fileSystemStub,
          workspaceResolver,
        },
        conversations: {},
        planText: '',
      } as any;
    },
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// loadArtifacts — figma key seeding (SSOT). Covers new-job paths
// (explicit AND infer), since neither path mutates figmaConfig before
// resolve runs.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('designResolveStrategy.loadArtifacts — figmaFileKey seeding (SSOT)', () => {
  let harness: LoadArtifactsHarness;

  beforeEach(() => { harness = makeLoadArtifactsHarness(); });
  afterEach(() => { harness.cleanup(); });

  it('extracts fileKey and startNodeId from figma.json on disk (new-job path covers explicit + infer)', async () => {
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    const figmaUrl =
      'https://www.figma.com/design/z08MukCkkOSGXiITeSRj5V/-%EB%94%94%EC%9E%90%EC%9D%B8?node-id=5087-4505';
    const expected = extractFigmaUrlParts(figmaUrl);
    expect(expected.fileKey).toBe('z08MukCkkOSGXiITeSRj5V');
    expect(expected.nodeId).toBe('5087:4505');

    const state = harness.buildState({ figmaUrl, resolvedActionMode: 'modify' });
    const result = await designResolveStrategy.loadArtifacts(state);

    expect(result.figmaFileKey).toBe(expected.fileKey);
    expect(result.figmaStartNodeId).toBe(expected.nodeId);
    // Sanity: figmaConfig itself is also returned as before.
    expect(result.figmaConfig?.file).toBe(figmaUrl);
  });

  it('seeds figmaFileKey alone when the URL has no node-id (startNodeId is optional)', async () => {
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    const figmaUrl = 'https://www.figma.com/design/abcDEF123/My-Design';
    const state = harness.buildState({ figmaUrl, resolvedActionMode: 'modify' });
    const result = await designResolveStrategy.loadArtifacts(state);

    expect(result.figmaFileKey).toBe('abcDEF123');
    expect(result.figmaStartNodeId).toBeUndefined();
  });

  it('seeds figmaFileKey for explicit=true gen-ui-figma jobs (regression: `azure-keeping-cairn`)', async () => {
    // Exact reproduction of the regression: a new job submitted with
    // `actionMetadata.explicit=true, intent='gen-ui-figma'`. In production
    // this short-circuits common detect (`detect/index.ts:113`) so
    // `designDetectStrategy.run()` never executes and the b808153b fix —
    // which seeded the keys *inside* strategy.run — was bypassed entirely.
    // After the SSOT move into resolve, this scenario MUST surface
    // `figmaFileKey` regardless of what detect chooses to do downstream.
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    const figmaUrl =
      'https://www.figma.com/design/explicit42/AzureKeepingCairn?node-id=10-20';
    const state = harness.buildState({
      figmaUrl,
      actionMetadataExplicit: true,
      resolvedActionMode: 'modify',
    });
    const result = await designResolveStrategy.loadArtifacts(state);

    expect(result.figmaFileKey).toBe('explicit42');
    expect(result.figmaStartNodeId).toBe('10:20');
  });

  it('omits figma key fields when figma.json is empty (no Figma file configured)', async () => {
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    // No URL provided — harness leaves figma.json absent so loadArtifacts
    // creates an empty figma config (createEmptyFigmaData), which has no
    // `file` field. Seeding must skip in this branch.
    const state = harness.buildState({ figmaUrl: undefined, resolvedActionMode: 'modify' });
    const result = await designResolveStrategy.loadArtifacts(state);

    expect(result.figmaFileKey).toBeUndefined();
    expect(result.figmaStartNodeId).toBeUndefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// designDetectStrategy — MCP reachability is detect's only figma
// concern. URL parsing has moved to resolve (SSOT), so detect must
// neither claim nor mutate fileKey/startNodeId.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('designDetectStrategy — figma MCP reachability (no key seeding)', () => {
  it('does not re-seed figma keys when MCP is reachable (resolve owns the SSOT)', async () => {
    const { designDetectStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/detect/strategy'
    );

    const figmaUrl =
      'https://www.figma.com/design/z08MukCkkOSGXiITeSRj5V/-%EB%94%94%EC%9E%90%EC%9D%B8?node-id=5087-4505';
    const state = buildDetectState({ figmaUrl, llmResponse: designUiDetectResponse });
    const result = await designDetectStrategy.run(state);

    expect(mockCheckLocalMCPAvailability).toHaveBeenCalled();
    expect(result.inferred?.intentId).toBeTruthy();
    expect(result.stateUpdates?.designError).toBeUndefined();

    // Detect's responsibility is MCP reachability. Seeding lives in
    // resolve, so detect MUST NOT clobber or re-derive these keys —
    // doing so would re-introduce the b808153b coverage gap by
    // splitting ownership across two nodes.
    expect(result.stateUpdates?.figmaFileKey).toBeUndefined();
    expect(result.stateUpdates?.figmaStartNodeId).toBeUndefined();
  });

  it('surfaces designError when MCP is unreachable (figma key concerns are independent)', async () => {
    mockCheckLocalMCPAvailability.mockImplementationOnce(async () => false);

    const { designDetectStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/detect/strategy'
    );

    const figmaUrl =
      'https://www.figma.com/design/unreachable123/Test?node-id=1-2';
    const state = buildDetectState({ figmaUrl, llmResponse: designUiDetectResponse });
    const result = await designDetectStrategy.run(state);

    expect(result.stateUpdates?.designError?.type).toBe('figma_mcp_unavailable');
    // Detect never touches figma keys regardless of MCP outcome —
    // resolve already populated them upstream from figma.json.
    expect(result.stateUpdates?.figmaFileKey).toBeUndefined();
    expect(result.stateUpdates?.figmaStartNodeId).toBeUndefined();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Resume path — designResolveStrategy.onResume must rehydrate fileKey/
// startNodeId from figmaConfig.file. The graph routing in graph.ts:817-823
// skips detect on resume, so without this rehydrate every legacy
// checkpoint (saved before the resolve-side fix when state.figmaFileKey
// was undefined and JSON.stringify dropped it) keeps resurrecting the
// same "Figma fileKey not configured" failure forever.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('designResolveStrategy.onResume — figmaFileKey rehydrate', () => {
  function buildResumeState(opts: { figmaUrl?: string }) {
    return {
      context: {
        project: 'p',
        featureFolder: 'f',
        // Empty featurePath skips disk reloads (existingDesignDocs scan,
        // loadResolvedArtifacts) — keeps the test hermetic.
        featurePath: '',
        workingDir: '',
        userId: 'u-1',
        organizationId: 'org-1',
        userLanguage: 'ko',
      },
      // No deps.session → hydrateFeatureContext returns
      // { featureContext: undefined, turnId: undefined }.
      deps: {},
      figmaConfig: opts.figmaUrl ? { file: opts.figmaUrl } : undefined,
      conversations: {},
      planText: '',
    } as any;
  }

  it('rehydrates figmaFileKey/figmaStartNodeId from figmaConfig.file (legacy checkpoint with figmaConfig but missing fileKey)', async () => {
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    const figmaUrl =
      'https://www.figma.com/design/z08MukCkkOSGXiITeSRj5V/-PoSA?node-id=5087-4505';
    const state = buildResumeState({ figmaUrl });

    const result = await designResolveStrategy.onResume!(state);

    expect(result.figmaFileKey).toBe('z08MukCkkOSGXiITeSRj5V');
    expect(result.figmaStartNodeId).toBe('5087:4505');
  });

  it('omits figma fields when figmaConfig is absent (non-figma resume jobs unaffected)', async () => {
    const { designResolveStrategy } = await import(
      '../src/agents/architect/graph/design/nodes/resolve'
    );

    const state = buildResumeState({});
    const result = await designResolveStrategy.onResume!(state);

    expect(result.figmaFileKey).toBeUndefined();
    expect(result.figmaStartNodeId).toBeUndefined();
  });
});
