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
  SHADOW_ALIASES,
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

  it('shadow aliases must point to tools that have handlers', () => {
    for (const [alias, canonical] of SHADOW_ALIASES) {
      expect(TOOL_HANDLERS.has(canonical)).toBe(true);
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

  it('Design job should include Figma but not SEARCH_REFERENCE', () => {
    const designTools = JOB_TOOL_MATRIX[JobType.DESIGN];
    expect(designTools).toContain(ToolName.FIGMA_DESIGN_CTX);
    expect(designTools).toContain(ToolName.READ_SOURCE_DOC);
    expect(designTools).not.toContain(ToolName.SEARCH_REFERENCE);
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

  it('resolveToolName should resolve shadow aliases', () => {
    expect(resolveToolName('file')).toBe(ToolName.CREATE_FILE);
    expect(resolveToolName('write_file')).toBe(ToolName.CREATE_FILE);
  });

  it('resolveToolName should return undefined for unknown tools', () => {
    expect(resolveToolName('nonexistent_tool')).toBeUndefined();
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
// ChatStatusReporter (noop)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('createNoopChatStatusReporter', () => {
  it('should create a reporter with all methods', () => {
    const reporter = createNoopChatStatusReporter();
    expect(reporter.showStatus).toBeInstanceOf(Function);
    expect(reporter.addReadingFile).toBeInstanceOf(Function);
    expect(reporter.commandStart).toBeInstanceOf(Function);
    expect(reporter.finalizeMessage).toBeInstanceOf(Function);
  });

  it('should return undefined from noop methods', async () => {
    const reporter = createNoopChatStatusReporter();
    expect(await reporter.showStatus('test')).toBeUndefined();
    expect(await reporter.addReadingFile('/path')).toBeUndefined();
    expect(await reporter.commandStart('ls')).toBeUndefined();
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

  it('should handle error results', () => {
    const events: ToolExecutionEvent[] = [
      {
        toolCallId: 'call-err',
        toolName: ToolName.READ_FILE,
        args: { path: 'nonexistent' },
        result: { content: 'File not found', error: 'File not found' },
        cached: false,
      },
    ];

    const { toolResultBlocks } = buildToolResultMessage(events);
    expect(toolResultBlocks[0].content).toContain('Error: File not found');
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
      const canonical = SHADOW_ALIASES.get(toolName) ?? toolName;
      if (TOOL_HANDLERS.has(canonical)) {
        expect(registry.has(toolName)).toBe(true);
      }
    }
  });

  it('createDesignToolRegistry should NOT include SEARCH_REFERENCE', async () => {
    const { createDesignToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createDesignToolRegistry();

    expect(registry.has(ToolName.READ_FILE)).toBe(true);
    expect(registry.has(ToolName.SEARCH_REFERENCE)).toBe(false);
    expect(registry.has(ToolName.RUN_COMMAND)).toBe(true);
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

  it('createAskToolRegistry should be empty (Ask tools registered at runtime)', async () => {
    const { createAskToolRegistry } = await import('../../src/agents/common/tool/presets');
    const registry = createAskToolRegistry();
    expect(registry.names().length).toBe(0);
  });
});
