/**
 * Tool Catalog, Registry & Orchestrator unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/agents/common/tool/registry';
import { createNoopChatStatusReporter } from '../../src/agents/common/tool/chatStatusAdapter';
import { buildToolResultMessage } from '../../src/agents/common/tool/messageBuilder';
import {
  ToolName,
  JobType,
  JOB_TOOL_MATRIX,
  TOOL_HANDLERS,
  TOOL_DISPLAY_NAMES,
  CACHEABLE_TOOLS,
  FIGMA_TOOLS,
  resolveToolName,
  isFigmaTool,
  getToolsForJob,
  getAllToolNames,
} from '../../src/agents/common/tool/toolCatalog';
import type { ToolHandler, ToolExecutionContext, ToolExecutionEvent } from '../../src/agents/common/tool/types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolName enum completeness
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ToolName enum', () => {
  it('should have a display name for every enum value', () => {
    const allNames = Object.values(ToolName);
    for (const name of allNames) {
      expect(TOOL_DISPLAY_NAMES[name]).toBeDefined();
      expect(typeof TOOL_DISPLAY_NAMES[name]).toBe('string');
    }
  });

  it('every tool in JOB_TOOL_MATRIX must be a valid ToolName', () => {
    const allEnumValues = new Set(Object.values(ToolName));
    for (const [job, tools] of Object.entries(JOB_TOOL_MATRIX)) {
      for (const tool of tools) {
        expect(allEnumValues.has(tool)).toBe(true);
      }
    }
  });

  it('every tool in TOOL_HANDLERS must be a valid ToolName', () => {
    const allEnumValues = new Set(Object.values(ToolName));
    for (const key of TOOL_HANDLERS.keys()) {
      expect(allEnumValues.has(key)).toBe(true);
    }
  });

  it('cacheable tools must be valid ToolNames', () => {
    const allEnumValues = new Set(Object.values(ToolName));
    for (const tool of CACHEABLE_TOOLS) {
      expect(allEnumValues.has(tool)).toBe(true);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// JOB_TOOL_MATRIX
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('JOB_TOOL_MATRIX', () => {
  it('should define tools for all job types', () => {
    for (const job of Object.values(JobType)) {
      expect(JOB_TOOL_MATRIX[job]).toBeDefined();
      expect(JOB_TOOL_MATRIX[job].length).toBeGreaterThan(0);
    }
  });

  it('Code job should include RUN_COMMAND and Figma tools', () => {
    const codeTools = JOB_TOOL_MATRIX[JobType.CODE];
    expect(codeTools).toContain(ToolName.RUN_COMMAND);
    expect(codeTools).toContain(ToolName.FIGMA_DESIGN_CTX);
    expect(codeTools).toContain(ToolName.SEARCH_REFERENCE);
  });

  it('Design job should include Figma and the reference-codebase tools', () => {
    const designTools = JOB_TOOL_MATRIX[JobType.DESIGN];
    expect(designTools).toContain(ToolName.FIGMA_DESIGN_CTX);
    expect(designTools).toContain(ToolName.READ_SOURCE_DOC);
    // Cross-project code exploration (read-only) is now available to design
    // jobs (gen-spec / rev-spec / system-design) — discovery-driven gating.
    expect(designTools).toContain(ToolName.REGISTER_REFERENCE);
    expect(designTools).toContain(ToolName.SEARCH_REFERENCE);
  });

  // Regression: `codebaseGate.rejectRunCommand` unconditionally rejects
  // `run_command` in design plan + execute phases. Advertising the tool
  // produced "unavailable in this phase" turns and token waste (see
  // `spare-keeping-metal` RCA). Code exploration is covered by
  // SEARCH_CODE + READ_FILE + LIST_FILES in those phases.
  it('Design job should NOT include RUN_COMMAND (reserved for code/execute)', () => {
    const designTools = JOB_TOOL_MATRIX[JobType.DESIGN];
    expect(designTools).not.toContain(ToolName.RUN_COMMAND);
    expect(designTools).toContain(ToolName.SEARCH_CODE);
    expect(designTools).toContain(ToolName.READ_FILE);
    expect(designTools).toContain(ToolName.LIST_FILES);
  });

  it('Plan job should not include RUN_COMMAND or DELETE_FILE', () => {
    const planTools = JOB_TOOL_MATRIX[JobType.PLAN];
    expect(planTools).not.toContain(ToolName.RUN_COMMAND);
    expect(planTools).not.toContain(ToolName.DELETE_FILE);
    expect(planTools).toContain(ToolName.EDIT_FILE);
    expect(planTools).toContain(ToolName.SEARCH_WEB);
  });

  it('Ask job should only have Ask-specific tools', () => {
    const askTools = JOB_TOOL_MATRIX[JobType.ASK];
    expect(askTools).toContain(ToolName.READ_ANT_SOURCE);
    expect(askTools).toContain(ToolName.LIST_WORKSPACE_FILES);
    expect(askTools).not.toContain(ToolName.READ_FILE);
    expect(askTools).not.toContain(ToolName.RUN_COMMAND);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Catalog helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Catalog helpers', () => {
  it('resolveToolName should resolve direct names', () => {
    expect(resolveToolName('read_file')).toBe(ToolName.READ_FILE);
    expect(resolveToolName('run_command')).toBe(ToolName.RUN_COMMAND);
  });

  it('resolveToolName should return undefined for unknown tools (retired shadow aliases included)', () => {
    expect(resolveToolName('nonexistent_tool')).toBeUndefined();
    // `file` / `write_file` were shadow aliases for CREATE_FILE before it was
    // advertised as a first-class tool; they are gone and must stay gone.
    expect(resolveToolName('file')).toBeUndefined();
    expect(resolveToolName('write_file')).toBeUndefined();
  });

  it('isFigmaTool should identify Figma tools', () => {
    expect(isFigmaTool(ToolName.FIGMA_DESIGN_CTX)).toBe(true);
    expect(isFigmaTool(ToolName.FIGMA_SCREENSHOT)).toBe(true);
    expect(isFigmaTool(ToolName.READ_FILE)).toBe(false);
  });

  it('getToolsForJob should return the matrix entry', () => {
    expect(getToolsForJob(JobType.CODE)).toBe(JOB_TOOL_MATRIX[JobType.CODE]);
  });

  it('getAllToolNames should return deduplicated union', () => {
    const all = getAllToolNames();
    const unique = new Set(all);
    expect(all.length).toBe(unique.size);
    expect(all.length).toBeGreaterThan(10);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// create_file / append_file advertisement matrix
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// Under the tool-call authoring protocol, create_file/append_file are THE
// document-writing channel (the `<file>`/`<append>` streaming tags are
// retired), so every AUTHORING set — code execute AND design/plan execute —
// must advertise both. Read-only surfaces (plan exploration, explain modes,
// planner observe, explore-subagent children) must advertise neither: they
// produce no artifacts by contract.

describe('create_file/append_file advertisement matrix', () => {
  it('create_file and append_file have schemas (advertisable)', async () => {
    const { ARCHITECT_TOOLS } = await import('../../src/agents/common/tool/toolSchemas');
    expect((ARCHITECT_TOOLS as any).create_file).toBeDefined();
    expect((ARCHITECT_TOOLS as any).create_file.input_schema.required).toEqual(['path', 'content']);
    expect((ARCHITECT_TOOLS as any).append_file).toBeDefined();
    expect((ARCHITECT_TOOLS as any).append_file.input_schema.required).toEqual(['path', 'content']);
  });

  // set → [advertises create_file, advertises append_file]
  const MATRIX: Array<[string, boolean, boolean]> = [
    // Authoring sets — the write channel MUST be advertised.
    ['codeBasic', true, true],
    ['design', true, true],
    ['uiDesignBase', true, true],
    ['uiDesign', true, true],
    ['uiDesignFigma', true, true],
    ['specFigma', true, true],
    // Read-only exploration / explain / observe sets — neither.
    ['planExplore', false, false],
    ['designPlanExplore', false, false],
    ['designPlanFigma', false, false],
    ['codeExplain', false, false],
    ['designExplain', false, false],
    ['plannerObserve', false, false],
    // Explore-subagent children are strictly read-only (depth-1 contract).
    ['subagentCode', false, false],
    ['subagentDesign', false, false],
    ['subagentPlanner', false, false],
  ];

  for (const [setName, hasCreate, hasAppend] of MATRIX) {
    it(`${setName}: create_file=${hasCreate} append_file=${hasAppend}`, async () => {
      const { TOOL_SETS } = await import('../../src/agents/common/tool/toolSchemas');
      const set = (TOOL_SETS as any)[setName];
      expect(set, `${setName} missing from TOOL_SETS`).toBeDefined();
      expect(set.includes(ToolName.CREATE_FILE)).toBe(hasCreate);
      expect(set.includes(ToolName.APPEND_FILE)).toBe(hasAppend);
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ToolRegistry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ToolRegistry', () => {
  it('should register and retrieve handlers by ToolName', () => {
    const registry = new ToolRegistry();
    const handler: ToolHandler = async () => ({ content: 'ok' });
    registry.register(ToolName.READ_FILE, handler);

    expect(registry.has(ToolName.READ_FILE)).toBe(true);
    expect(registry.get(ToolName.READ_FILE)).toBe(handler);
    expect(registry.has('unknown')).toBe(false);
  });

  it('should return undefined for unregistered names', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('should wrap existing handler', () => {
    const registry = new ToolRegistry();
    const original: ToolHandler = async (_ctx, args) => ({ content: `original:${args.x}` });
    registry.register(ToolName.READ_FILE, original);

    registry.wrap(ToolName.READ_FILE, (orig) => async (ctx, args) => {
      if (args.blocked) return { content: 'blocked', error: 'blocked' };
      return orig(ctx, args);
    });

    const wrapped = registry.get(ToolName.READ_FILE)!;
    expect(wrapped).not.toBe(original);
  });

  it('should throw when wrapping unregistered tool', () => {
    const registry = new ToolRegistry();
    expect(() => {
      registry.wrap(ToolName.RUN_COMMAND, (orig) => orig);
    }).toThrow('Cannot wrap unregistered tool: run_command');
  });

  it('should merge registries', () => {
    const r1 = new ToolRegistry();
    const r2 = new ToolRegistry();

    const h1: ToolHandler = async () => ({ content: 'from-r1' });
    const h2: ToolHandler = async () => ({ content: 'from-r2' });
    const h3: ToolHandler = async () => ({ content: 'from-r2-new' });

    r1.register(ToolName.READ_FILE, h1);
    r2.register(ToolName.READ_FILE, h2);
    r2.register(ToolName.SEARCH_CODE, h3);

    r1.merge(r2);

    expect(r1.get(ToolName.READ_FILE)).toBe(h2);
    expect(r1.get(ToolName.SEARCH_CODE)).toBe(h3);
  });

  it('should list all names', () => {
    const registry = new ToolRegistry();
    registry.register(ToolName.READ_FILE, async () => ({ content: '' }));
    registry.register(ToolName.LIST_FILES, async () => ({ content: '' }));
    registry.register(ToolName.MKDIR, async () => ({ content: '' }));

    expect(registry.names().sort()).toEqual([ToolName.LIST_FILES, ToolName.MKDIR, ToolName.READ_FILE].sort());
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// buildToolResultMessage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('buildToolResultMessage', () => {
  it('should build tool_use and tool_result blocks', () => {
    const events: ToolExecutionEvent[] = [
      {
        toolCallId: 'call-1',
        toolName: ToolName.READ_FILE,
        args: { path: 'src/main.ts' },
        result: { content: 'file content here' },
        cached: false,
      },
      {
        toolCallId: 'call-2',
        toolName: ToolName.LIST_FILES,
        args: { directory: '.' },
        result: { content: 'file1\nfile2' },
        cached: true,
      },
    ];

    const { toolUseBlocks, toolResultBlocks } = buildToolResultMessage(events);

    expect(toolUseBlocks).toHaveLength(2);
    expect(toolUseBlocks[0]).toEqual({
      type: 'tool_use',
      id: 'call-1',
      name: ToolName.READ_FILE,
      input: { path: 'src/main.ts' },
    });

    expect(toolResultBlocks).toHaveLength(2);
    expect(toolResultBlocks[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'call-1',
      tool_name: ToolName.READ_FILE,
      content: 'file content here',
    });
  });

  it('should preserve handler-authored content on error results (trim-grinding-motif)', () => {
    // Handler content carries recovery guidance — replacing it with the bare
    // `error` field left the LLM retrying blind. Non-empty content is
    // delivered verbatim; the error field only flags failure.
    const events: ToolExecutionEvent[] = [
      {
        toolCallId: 'call-err',
        toolName: ToolName.READ_FILE,
        args: { path: 'nonexistent' },
        result: { content: 'File not found — use <file> to create it', error: 'File not found' },
        cached: false,
      },
    ];

    const { toolResultBlocks } = buildToolResultMessage(events);
    expect(toolResultBlocks[0].content).toBe('File not found — use <file> to create it');
  });

  it('should synthesize `Error:` only when an error result has no content', () => {
    const events: ToolExecutionEvent[] = [
      {
        toolCallId: 'call-err',
        toolName: ToolName.READ_FILE,
        args: { path: 'nonexistent' },
        result: { content: '', error: 'File not found' },
        cached: false,
      },
    ];

    const { toolResultBlocks } = buildToolResultMessage(events);
    expect(toolResultBlocks[0].content).toBe('Error: File not found');
  });

  it('should pass through array content (multimodal)', () => {
    const events: ToolExecutionEvent[] = [
      {
        toolCallId: 'call-img',
        toolName: ToolName.FIGMA_SCREENSHOT,
        args: { nodeId: '123' },
        result: {
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            { type: 'text', text: 'Screenshot captured' },
          ],
        },
        cached: false,
      },
    ];

    const { toolResultBlocks } = buildToolResultMessage(events);
    expect(Array.isArray(toolResultBlocks[0].content)).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CodeCommandPolicy
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('applyCodeCommandPolicy', () => {
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    ctx = {
      fileSystem: {} as any,
      chatStatus: createNoopChatStatusReporter(),
      workingDir: '/tmp',
    };
  });

  it('should block Go build in feature tasks', async () => {
    const { applyCodeCommandPolicy } = await import('../../src/agents/common/tool/handlers/codeCommandPolicy');
    ctx.currentTaskType = 'feature';
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result).not.toBeNull();
    expect(result!.content).toContain('BLOCKED');
  });

  it('should allow Go build during a verification cycle (verifyModeActive=true)', async () => {
    // Post plan §5.4: Go build is allowed when `ctx.verifyModeActive` is
    // `true` (verification responsibility holder + `_verifyEntered`).
    const { applyCodeCommandPolicy } = await import('../../src/agents/common/tool/handlers/codeCommandPolicy');
    ctx.currentTaskType = 'verification';
    (ctx as any).verifyModeActive = true;
    const result = applyCodeCommandPolicy(ctx, { command: 'go build ./...' });
    expect(result).toBeNull();
  });

  it('allows verifies-declared commands when verify-mode is active (no per-gate runtime guards left)', async () => {
    // The deterministic gate-ordering / already-passed guards retired with
    // the verification Session (plan §5.4). Verify-mode passes commands
    // through; runtime safety is delegated to LLM judgment + the
    // `batch_cycle_limit` fail-safe.
    const { applyCodeCommandPolicy } = await import('../../src/agents/common/tool/handlers/codeCommandPolicy');
    ctx.currentTaskType = 'verification';
    ctx.activePhase = 'execute';
    (ctx as any).verifyModeActive = true;
    const result = applyCodeCommandPolicy(ctx, { command: 'npm run build', verifies: 'build' });
    expect(result).toBeNull();
  });

  it('should pass through non-policy commands', async () => {
    const { applyCodeCommandPolicy } = await import('../../src/agents/common/tool/handlers/codeCommandPolicy');
    ctx.currentTaskType = 'feature';
    ctx.activePhase = 'execute';
    const result = applyCodeCommandPolicy(ctx, { command: 'ls -la' });
    expect(result).toBeNull();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Presets — derived from catalog
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Registry presets (catalog-driven)', () => {
  it('createCodeToolRegistry should include exactly the tools in JOB_TOOL_MATRIX[CODE]', async () => {
    const { createCodeToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createCodeToolRegistry();

    for (const toolName of JOB_TOOL_MATRIX[JobType.CODE]) {
      // Only check tools that have handlers in TOOL_HANDLERS (not Design/Ask-specific)
      if (TOOL_HANDLERS.has(toolName)) {
        expect(registry.has(toolName)).toBe(true);
      }
    }
  });

  it('createDesignToolRegistry includes reference tools but NOT RUN_COMMAND', async () => {
    const { createDesignToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createDesignToolRegistry();

    expect(registry.has(ToolName.READ_FILE)).toBe(true);
    // Cross-project code exploration (read-only) is available to design jobs.
    expect(registry.has(ToolName.REGISTER_REFERENCE)).toBe(true);
    expect(registry.has(ToolName.SEARCH_REFERENCE)).toBe(true);
    // RUN_COMMAND is reserved for code/execute — design plan + execute are
    // document-producing phases where `codebaseGate.rejectRunCommand`
    // unconditionally rejects shell execution.
    expect(registry.has(ToolName.RUN_COMMAND)).toBe(false);
    expect(registry.has(ToolName.FIGMA_DESIGN_CTX)).toBe(true);
  });

  it('createPlanToolRegistry should include EDIT_FILE but not RUN_COMMAND', async () => {
    const { createPlanToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createPlanToolRegistry();

    expect(registry.has(ToolName.EDIT_FILE)).toBe(true);
    expect(registry.has(ToolName.CREATE_FILE)).toBe(true);
    expect(registry.has(ToolName.RUN_COMMAND)).toBe(false);
    expect(registry.has(ToolName.SEARCH_WEB)).toBe(true);
  });

  it('createAskToolRegistry auto-registers ant-source handlers (shared catalog SSOT); workspace tools stay runtime-registered', async () => {
    const { createAskToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createAskToolRegistry();
    // ant-source read/list/search moved into the shared TOOL_HANDLERS (reused
    // by code/design self-diagnosis), so the ASK preset now auto-registers them
    // from the catalog matrix instead of being empty.
    expect(registry.has(ToolName.READ_ANT_SOURCE)).toBe(true);
    expect(registry.has(ToolName.LIST_ANT_FILES)).toBe(true);
    expect(registry.has(ToolName.SEARCH_ANT_CODE)).toBe(true);
    // Workspace-scope readers depend on runtime feature-path state → still
    // registered at runtime by the ask tool node, not in the catalog.
    expect(registry.has(ToolName.READ_WORKSPACE_FILE)).toBe(false);
    expect(registry.has(ToolName.LIST_WORKSPACE_FILES)).toBe(false);
  });
});
