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
import type { McpToolInfo, McpCallResult } from '../../src/core/customAgents/McpConnectionManager';
import { McpConnectionManager, STDIO_EXEC_ENV_KEYS, buildStdioChildEnv } from '../../src/core/customAgents/McpConnectionManager';
import { isMcpConfigError } from '../../src/core/customAgents/McpConfigError';
import { validateMcpServers } from '@ant/shared';
import type { McpCredentialResolver } from '../../src/core/customAgents/McpCredentialResolver';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';
import {
  buildUniversalRegistry,
  getUniversalRegistry,
  _resetUniversalRuntimeForTests,
  MCP_SPOOL_THRESHOLD_BYTES,
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
 * MCP result spooling — the cross-tool data plane. An oversized result must
 * flow tool→file without the model re-typing it: the handler writes the full
 * text to the artifacts sandbox and returns only path + shape + head preview.
 * Spool writes go straight through ctx.fileSystem and emit NO side effects,
 * so they never fold into `_turnToolWrites` — neither the artifact manifest
 * nor an artifact stop hook can be satisfied by a spool.
 */
describe('universal MCP result spooling', () => {
  beforeEach(() => {
    _resetUniversalRuntimeForTests();
  });

  function spoolCtx(opts: { failWrite?: boolean } = {}): {
    ctx: ToolExecutionContext;
    writes: Array<{ path: string; content: string }>;
  } {
    const writes: Array<{ path: string; content: string }> = [];
    const ctx = {
      fileSystem: {
        writeFile: async (p: string, c: string) => {
          if (opts.failWrite) throw new Error('disk full');
          writes.push({ path: p, content: c });
        },
      },
    } as unknown as ToolExecutionContext;
    return { ctx, writes };
  }

  it('a result at the threshold passes inline without touching the filesystem', async () => {
    const text = 'a'.repeat(MCP_SPOOL_THRESHOLD_BYTES);
    buildUniversalRegistry(fakeMcp({ text }).mcp);

    // Bare ctx: an inline return must never dereference ctx.fileSystem.
    const result = await getUniversalRegistry().get(READ_TOOL)!({} as ToolExecutionContext, {});

    expect(result.content).toBe(text);
    expect(result.error).toBeUndefined();
  });

  it('an oversized result is spooled: full text on disk, only path + shape + preview in context', async () => {
    const text = 'row-data\n'.repeat(Math.ceil(MCP_SPOOL_THRESHOLD_BYTES / 9) + 10);
    buildUniversalRegistry(fakeMcp({ text }).mcp);
    const { ctx, writes } = spoolCtx();

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe('mcp-results/ops-db/list_incidents-1.txt');
    expect(writes[0].content).toBe(text);
    const content = result.content as string;
    expect(content).toContain('mcp-results/ops-db/list_incidents-1.txt');
    expect(content).toContain(`${Buffer.byteLength(text, 'utf-8')} bytes`);
    expect(content).toContain('row-data'); // head preview
    expect(content.length).toBeLessThan(text.length / 4); // not the payload itself
    expect(result.error).toBeUndefined();
    expect(result.sideEffects).toBeUndefined(); // never folds into _turnToolWrites
  });

  it('error results are never spooled, however large', async () => {
    const text = 'boom '.repeat(MCP_SPOOL_THRESHOLD_BYTES);
    buildUniversalRegistry(fakeMcp({ text, isError: true }).mcp);
    const { ctx, writes } = spoolCtx();

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(writes).toHaveLength(0);
    expect(result.error).toBe(text);
  });

  it('a failed spool write falls back to the inline result instead of failing the call', async () => {
    const text = 'b'.repeat(MCP_SPOOL_THRESHOLD_BYTES + 1);
    buildUniversalRegistry(fakeMcp({ text }).mcp);
    const { ctx } = spoolCtx({ failWrite: true });

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(result.content).toBe(text);
    expect(result.error).toBeUndefined();
  });

  it('the spool sequence increments per call and resets with the runtime', async () => {
    const text = 'c'.repeat(MCP_SPOOL_THRESHOLD_BYTES + 1);
    buildUniversalRegistry(fakeMcp({ text }).mcp);
    const { ctx, writes } = spoolCtx();
    const handler = getUniversalRegistry().get(READ_TOOL)!;

    await handler(ctx, {});
    await handler(ctx, {});
    expect(writes.map((w) => w.path)).toEqual([
      'mcp-results/ops-db/list_incidents-1.txt',
      'mcp-results/ops-db/list_incidents-2.txt',
    ]);

    _resetUniversalRuntimeForTests();
    buildUniversalRegistry(fakeMcp({ text }).mcp);
    const fresh = spoolCtx();
    await getUniversalRegistry().get(READ_TOOL)!(fresh.ctx, {});
    expect(fresh.writes[0].path).toBe('mcp-results/ops-db/list_incidents-1.txt');
  });
});

/**
 * A third-party MCP server is arbitrary code execution. Passing `...process.env`
 * to it handed over every host secret at once — provider keys, JWT secret, Redis
 * URL — so the child env is an explicit allowlist and this is its gate.
 * Since A16 the declared values arrive ALREADY RESOLVED from the encrypted
 * store; buildStdioChildEnv only composes baseline + resolved values.
 */
describe('universal MCP runtime — stdio child env isolation', () => {
  const HOST_SECRETS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'JWT_SECRET', 'REDIS_URL', 'ANT_ENCRYPTION_KEY'];
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of [...HOST_SECRETS, 'PATH']) saved.set(key, process.env[key]);
    for (const key of HOST_SECRETS) process.env[key] = `secret-${key}`;
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
    expect(buildStdioChildEnv({ DB_URL: 'postgres://resolved' })[key]).toBeUndefined();
  });

  it('forwards resolved values under their child-side key', () => {
    expect(buildStdioChildEnv({ DB_URL: 'postgres://resolved' }).DB_URL).toBe('postgres://resolved');
  });

  it('keeps the exec baseline so the child can actually run', () => {
    expect(buildStdioChildEnv(undefined).PATH).toBe('/usr/bin');
  });

  it('with nothing declared, the child env is the exec baseline and nothing more', () => {
    expect(Object.keys(buildStdioChildEnv(undefined)).every((k) => STDIO_EXEC_ENV_KEYS.includes(k as any))).toBe(true);
  });

  // H-014: a tenant-declared loader/interpreter var must never reach the child
  // env, because the UID-drop launcher (setpriv) runs as the SERVICE UID until
  // it drops and would honor LD_PRELOAD etc. before the drop.
  it.each(['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'BASH_ENV'])(
    'strips loader/interpreter var %s from the child env',
    (key) => {
      expect(buildStdioChildEnv({ [key]: '/tmp/evil', DB_URL: 'ok' })[key]).toBeUndefined();
      // legitimate declared values still pass
      expect(buildStdioChildEnv({ [key]: '/tmp/evil', DB_URL: 'ok' }).DB_URL).toBe('ok');
    },
  );
});

/**
 * H-014 authoring-time gate: a tenant must not be able to declare a
 * loader/interpreter env KEY on an MCP server (it would hijack the pre-drop
 * launcher). validateMcpServers is the single rule set behind the editor write,
 * the file upload, and the whole-agent import.
 */
describe('validateMcpServers — MCP env key denylist (H-014)', () => {
  const base = { transport: 'stdio' as const, command: 'npx' };

  it.each(['LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'BASH_ENV', 'GCONV_PATH'])(
    'rejects env key %s',
    (key) => {
      const errors = validateMcpServers({ s: { ...base, env: { [key]: 'x' } } });
      expect(errors.some((e) => e.includes(key))).toBe(true);
    },
  );

  it('rejects a malformed env var name', () => {
    const errors = validateMcpServers({ s: { ...base, env: { 'bad name': 'x' } } });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts an ordinary declared env key', () => {
    const errors = validateMcpServers({ s: { ...base, env: { DB_URL: 'postgres://x' } } });
    expect(errors).toEqual([]);
  });
});

/**
 * A16 credential resolution — store-only, never process.env. The connect()
 * boundary is where an unregistered key must fail loud (typed McpConfigError →
 * `config_invalid` classification), and where a definition naming one of Ant's
 * own env vars must resolve to a store MISS rather than the host secret.
 */
describe('universal MCP runtime — credential resolution is store-only', () => {
  const stubResolver = (entries: Record<string, string>): McpCredentialResolver => ({
    resolve: async (key) => entries[key],
  });

  const savedKey = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-host-secret';
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  });

  it.each([
    ['stdio env', { s: { transport: 'stdio' as const, command: 'npx', env: { TOKEN: '${secret:UNREGISTERED_KEY}' } } }],
    ['http headers', { s: { transport: 'http' as const, url: 'http://localhost:9', headers: { Authorization: '${secret:UNREGISTERED_KEY}' } } }],
  ])('an unregistered %s reference rejects with a typed McpConfigError before any connect', async (_label, servers) => {
    const mcp = new McpConnectionManager(servers, stubResolver({}));
    const err = await mcp.connect().then(
      () => null,
      (e) => e,
    );
    expect(isMcpConfigError(err)).toBe(true);
    expect(String(err.message)).toMatch(/not registered/);
  });

  it("a definition referencing one of Ant's own env vars gets a store miss, not the host secret", async () => {
    // ANTHROPIC_API_KEY is set on the host (beforeEach). Store-only resolution
    // means the exfiltration attempt dies as an unregistered-key config error.
    const mcp = new McpConnectionManager(
      { s: { transport: 'http', url: 'http://localhost:9', headers: { X: '${secret:ANTHROPIC_API_KEY}' } } },
      stubResolver({}),
    );
    await expect(mcp.connect()).rejects.toMatchObject({ isMcpConfigError: true });
  });

  it('a plain-text value passes through without touching the store — only ${secret:…} resolves', async () => {
    // Header value is NOT a reference, so credential resolution must pass it
    // verbatim and proceed to the (unreachable) connect — the failure is a
    // network error, never a typed McpConfigError.
    const mcp = new McpConnectionManager(
      { s: { transport: 'http', url: 'http://127.0.0.1:9', headers: { 'X-Workspace-Id': 'ws-abc' } } },
      stubResolver({}),
    );
    const err = await mcp.connect().then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(isMcpConfigError(err)).toBe(false);
  });
});
