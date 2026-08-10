/**
 * Universal MCP runtime axis — the seam between a connected MCP server and the
 * tool loop. Two invariants, one owner file (this surface had zero tests, which
 * is why the dispatch break below shipped):
 *
 *   1. dispatch — the registry instance the tool node captures at module load
 *      must be the one MCP handlers land on.
 *   2. isolation — a stdio child gets the declared env plus an exec baseline,
 *      never the host's full environment.
 *
 * On (1):
 * The regression this guards: `nodes/tool.ts` resolves `getUniversalRegistry()`
 * at MODULE LOAD (its `createToolNode({...})` call is module-top-level, reached
 * through runner → graph → nodes/tool static imports) and `createToolNode`
 * captures that object immediately inside `new ToolOrchestrator({ registry })`.
 * `buildUniversalRegistry` then runs at job start, long after. If it builds a
 * fresh instance instead of registering into the captured one, every `mcp__*`
 * call resolves to `undefined` and fails "Unknown tool" — while the subagent
 * seam (which resolves the registry per call, inside `buildContext`) keeps
 * working, so the failure looks like an MCP problem rather than a wiring one.
 *
 * Instance identity is therefore a contract, and these rows are its gate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { McpConnectionManager, McpToolInfo, McpCallResult } from '../../src/core/customAgents/McpConnectionManager';
import { STDIO_EXEC_ENV_KEYS, buildStdioChildEnv } from '../../src/core/customAgents/McpConnectionManager';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';
import {
  buildUniversalRegistry,
  getUniversalRegistry,
  _resetUniversalRuntimeForTests,
} from '../../src/agents/universal/graph/runtime';

const READ_TOOL = 'mcp__ops-db__list_incidents';
const WRITE_TOOL = 'mcp__ops-db__push';

function toolInfo(name: string, readOnlyHint?: boolean): McpToolInfo {
  const [, serverName, toolName] = name.split('__');
  return {
    name,
    serverName,
    toolName,
    readOnlyHint,
    definition: { name, description: `fake ${name}`, input_schema: { type: 'object', properties: {} } as any },
  };
}

/** Minimal stand-in — only the two members `buildUniversalRegistry` touches. */
function fakeMcp(result: Partial<McpCallResult> = {}): {
  mcp: McpConnectionManager;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const mcp = {
    listToolInfos: () => [toolInfo(READ_TOOL, true), toolInfo(WRITE_TOOL)],
    callTool: async (name: string, args: Record<string, unknown>): Promise<McpCallResult> => {
      calls.push({ name, args });
      return { text: 'ok', isError: false, ...result };
    },
  } as unknown as McpConnectionManager;
  return { mcp, calls };
}

describe('universal MCP dispatch — registry instance identity', () => {
  beforeEach(() => {
    _resetUniversalRuntimeForTests();
  });

  it('buildUniversalRegistry populates the pre-existing singleton, never replaces it', () => {
    // Stands in for nodes/tool.ts capturing the registry at module load.
    const capturedAtModuleLoad = getUniversalRegistry();

    const returned = buildUniversalRegistry(fakeMcp().mcp);

    expect(returned).toBe(capturedAtModuleLoad);
    expect(getUniversalRegistry()).toBe(capturedAtModuleLoad);
  });

  it.each([[READ_TOOL], [WRITE_TOOL]])(
    'the module-load-captured registry resolves %s after job-start build',
    (toolName) => {
      const capturedAtModuleLoad = getUniversalRegistry();
      expect(capturedAtModuleLoad.get(toolName)).toBeUndefined();

      buildUniversalRegistry(fakeMcp().mcp);

      expect(capturedAtModuleLoad.get(toolName)).toBeDefined();
    },
  );

  it('a null mcp leaves the captured instance intact with builtins and no mcp__ handlers', () => {
    const capturedAtModuleLoad = getUniversalRegistry();

    expect(buildUniversalRegistry(null)).toBe(capturedAtModuleLoad);
    expect(capturedAtModuleLoad.get('read_file')).toBeDefined();
    expect(capturedAtModuleLoad.names().filter((n) => n.startsWith('mcp__'))).toEqual([]);
  });

  it('the registered handler forwards to callTool and passes the result through', async () => {
    const { mcp, calls } = fakeMcp({ text: 'incident-1' });
    buildUniversalRegistry(mcp);

    const handler = getUniversalRegistry().get(READ_TOOL)!;
    const result = await handler({} as ToolExecutionContext, { since: '7d' });

    expect(calls).toEqual([{ name: READ_TOOL, args: { since: '7d' } }]);
    expect(result.content).toBe('incident-1');
    expect(result.error).toBeUndefined();
  });

  it.each([
    ['isError with text', { text: 'quota exceeded', isError: true }, 'quota exceeded'],
    ['isError without text', { text: '', isError: true }, 'MCP tool returned an error'],
  ] as const)('surfaces %s as ToolResult.error', async (_label, callResult, expectedError) => {
    buildUniversalRegistry(fakeMcp(callResult).mcp);

    const result = await getUniversalRegistry().get(READ_TOOL)!({} as ToolExecutionContext, {});

    expect(result.error).toBe(expectedError);
  });

  it('empty non-error results get a placeholder rather than an empty string', async () => {
    buildUniversalRegistry(fakeMcp({ text: '', isError: false }).mcp);

    const result = await getUniversalRegistry().get(READ_TOOL)!({} as ToolExecutionContext, {});

    expect(result.content).toBe('(empty MCP result)');
    expect(result.error).toBeUndefined();
  });
});

/**
 * A third-party MCP server is arbitrary code execution. Passing `...process.env`
 * to it handed over every host secret at once — provider keys, JWT secret, Redis
 * URL — so the child env is an explicit allowlist and this is its gate.
 */
describe('universal MCP runtime — stdio child env isolation', () => {
  const HOST_SECRETS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'JWT_SECRET', 'REDIS_URL'];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of [...HOST_SECRETS, 'OPS_DB_URL', 'PATH']) saved.set(key, process.env[key]);
    for (const key of HOST_SECRETS) process.env[key] = `secret-${key}`;
    process.env.OPS_DB_URL = 'postgres://declared';
    process.env.PATH = '/usr/bin';
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it.each(HOST_SECRETS)('undeclared host secret %s never reaches the child', (key) => {
    expect(buildStdioChildEnv({ DB_URL: 'OPS_DB_URL' })[key]).toBeUndefined();
  });

  it('forwards declared vars under their child-side key, resolved from the host', () => {
    expect(buildStdioChildEnv({ DB_URL: 'OPS_DB_URL' }).DB_URL).toBe('postgres://declared');
  });

  it('keeps the exec baseline so the child can actually run', () => {
    expect(buildStdioChildEnv(undefined).PATH).toBe('/usr/bin');
  });

  it('with nothing declared, the child env is the exec baseline and nothing more', () => {
    expect(Object.keys(buildStdioChildEnv(undefined)).every((k) => STDIO_EXEC_ENV_KEYS.includes(k as any))).toBe(true);
  });

  it('a declared var missing from the host fails loud instead of silently empty', () => {
    delete process.env.OPS_DB_URL;
    expect(() => buildStdioChildEnv({ DB_URL: 'OPS_DB_URL' })).toThrow(/which is not set/);
  });
});
