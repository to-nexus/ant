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
  UNIVERSAL_RESULT_LIMITS,
  toolErrorCardSummary,
} from '../../src/agents/universal/graph/runtime';
import { ToolResultManager } from '../../src/core/utils/toolResultManager';
import { TokenBudgetManager } from '../../src/core/utils/tokenBudget';
import {
  buildRuntimeFailureNote,
  failedServerNamesOf,
  formatCapabilityStatusLines,
  formatConnectionWarningForChat,
} from '../../src/core/customAgents/connectionReport';
import { buildUniversalErrorSealState } from '../../src/agents/universal/graph/session/sealConversation';

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

  // Failed api__/mcp__ calls get a terminal error status line — without it the
  // pre-flight tool_action card is the only chat.jsonl trace and a 404/400 is
  // invisible to the user (major-loading-floor RCA).
  function statusCapturingCtx(): { ctx: ToolExecutionContext; shown: Array<{ key: string; data: Record<string, any> }> } {
    const shown: Array<{ key: string; data: Record<string, any> }> = [];
    const ctx = {
      chatStatus: {
        showStatus: async (key: string, data: Record<string, any>) => {
          shown.push({ key, data });
          return undefined;
        },
      },
    } as unknown as ToolExecutionContext;
    return { ctx, shown };
  }

  it('an isError result emits ONE failed tool_action status carrying the status line AND the reason', async () => {
    // major-loading-floor gave the card the head line; oak-leaping-latch showed
    // the head line alone is `HTTP 400 Bad Request` — a refusal naming no rule.
    buildUniversalRegistry(
      fakeMcp({
        text: 'HTTP 400 Bad Request\ncontent-type: application/json\n\n{"error":"path is required"}',
        isError: true,
      }).mcp,
    );
    const { ctx, shown } = statusCapturingCtx();

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(result.error).toBeTruthy();
    expect(shown).toHaveLength(1);
    expect(shown[0].key).toBe('tool_action');
    expect(shown[0].data.status).toBe('failed');
    expect(shown[0].data.content).toContain(READ_TOOL);
    expect(shown[0].data.content).toContain('HTTP 400 Bad Request');
    expect(shown[0].data.content).toContain('path is required');
    expect(shown[0].data.content).not.toContain('content-type');
  });

  it.each([
    ['single-line error text stays as-is', 'Unknown tool', 'Unknown tool'],
    ['a blank result yields no summary', '', ''],
    ['the summary is capped', `HTTP 500 x\n\n${'z'.repeat(400)}`, `HTTP 500 x — ${'z'.repeat(400)}`.slice(0, 200)],
  ])('toolErrorCardSummary: %s', (_label, text, expected) => {
    expect(toolErrorCardSummary(text)).toBe(expected);
  });

  it('a success result emits no status card', async () => {
    buildUniversalRegistry(fakeMcp({ text: 'ok', isError: false }).mcp);
    const { ctx, shown } = statusCapturingCtx();

    await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(shown).toEqual([]);
  });

  it('a chatStatus throw does not change the error result', async () => {
    buildUniversalRegistry(fakeMcp({ text: 'quota exceeded', isError: true }).mcp);
    const ctx = {
      chatStatus: { showStatus: async () => { throw new Error('SSE down'); } },
    } as unknown as ToolExecutionContext;

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    expect(result.error).toBe('quota exceeded');
    expect(result.content).toBe('quota exceeded');
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

  it('single-owner invariant: a result inline (not spooled) is never cut by the generic truncator', () => {
    // The spool threshold DERIVES from maxTokensPerResult, so the band where a
    // result was neither spooled nor recoverable after truncateGeneric cannot
    // exist. Red under two independent magic numbers (32 KiB vs a 5000-token cap).
    const manager = new ToolResultManager(new TokenBudgetManager(), UNIVERSAL_RESULT_LIMITS);
    const inlineMax = 'x'.repeat(MCP_SPOOL_THRESHOLD_BYTES);

    const truncation = manager.truncateResult(READ_TOOL, inlineMax);

    expect(truncation.wasTruncated).toBe(false);
    expect(truncation.content).toBe(inlineMax);
  });

  it('the spool instruction points at real read_file params (startLine/endLine, not offset/limit)', async () => {
    const text = 'd'.repeat(MCP_SPOOL_THRESHOLD_BYTES + 1);
    buildUniversalRegistry(fakeMcp({ text }).mcp);
    const { ctx } = spoolCtx();

    const result = await getUniversalRegistry().get(READ_TOOL)!(ctx, {});

    const content = result.content as string;
    expect(content).toContain('startLine');
    expect(content).not.toContain('offset');
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
 * A16 credential resolution — store-only, never process.env — across the TWO
 * connect lanes. Unattended (`failFast: true`) keeps the legacy fail-loud
 * contract: the first failure rejects with a typed McpConfigError →
 * `config_invalid`. Attended (`failFast: false`) degrades per server: the same
 * failure becomes a `failed` attempt in the connection report (the fact the
 * agent explains), and the host secret still never leaks either way.
 */
describe('universal MCP runtime — credential resolution is store-only (two lanes)', () => {
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
  ])('fail-fast: an unregistered %s reference rejects with a typed McpConfigError before any connect', async (_label, servers) => {
    const mcp = new McpConnectionManager(servers, stubResolver({}));
    const err = await mcp.connect({ failFast: true }).then(
      () => null,
      (e) => e,
    );
    expect(isMcpConfigError(err)).toBe(true);
    expect(String(err.message)).toMatch(/not registered/);
  });

  it.each([
    ['stdio env', { s: { transport: 'stdio' as const, command: 'npx', env: { TOKEN: '${secret:UNREGISTERED_KEY}' } } }],
    ['http headers', { s: { transport: 'http' as const, url: 'http://localhost:9', headers: { Authorization: '${secret:UNREGISTERED_KEY}' } } }],
  ])('attended: an unregistered %s reference degrades to a config-kind report fact', async (_label, servers) => {
    const mcp = new McpConnectionManager(servers, stubResolver({}));
    await mcp.connect({ failFast: false });
    expect(mcp.getConnectionReport()).toEqual([
      expect.objectContaining({ server: 's', channel: 'mcp', status: 'failed', errorKind: 'config' }),
    ]);
    expect(mcp.getConnectionReport()[0].error).toMatch(/not registered/);
    expect(mcp.listToolInfos()).toEqual([]);
  });

  it.each([[true], [false]] as const)(
    "a definition referencing one of Ant's own env vars gets a store miss, not the host secret (failFast: %s)",
    async (failFast) => {
      // ANTHROPIC_API_KEY is set on the host (beforeEach). Store-only resolution
      // means the exfiltration attempt dies as an unregistered-key config error
      // on both lanes — and the report never carries the host value.
      const mcp = new McpConnectionManager(
        { s: { transport: 'http', url: 'http://localhost:9', headers: { X: '${secret:ANTHROPIC_API_KEY}' } } },
        stubResolver({}),
      );
      if (failFast) {
        await expect(mcp.connect({ failFast })).rejects.toMatchObject({ isMcpConfigError: true });
      } else {
        await mcp.connect({ failFast });
        const [attempt] = mcp.getConnectionReport();
        expect(attempt.status).toBe('failed');
        expect(attempt.errorKind).toBe('config');
        expect(attempt.error).not.toContain('sk-host-secret');
      }
    },
  );

  it('a plain-text value passes through without touching the store — only ${secret:…} resolves', async () => {
    // Header value is NOT a reference, so credential resolution must pass it
    // verbatim and proceed to the (unreachable) connect — the failure is a
    // network error, never a typed McpConfigError; the attended lane records
    // it as a connect-kind fact.
    const servers = { s: { transport: 'http' as const, url: 'http://127.0.0.1:9', headers: { 'X-Workspace-Id': 'ws-abc' } } };
    const fatal = await new McpConnectionManager(servers, stubResolver({})).connect({ failFast: true }).then(
      () => null,
      (e) => e,
    );
    expect(fatal).not.toBeNull();
    expect(isMcpConfigError(fatal)).toBe(false);

    const mcp = new McpConnectionManager(servers, stubResolver({}));
    await mcp.connect({ failFast: false });
    expect(mcp.getConnectionReport()).toEqual([
      expect.objectContaining({ server: 's', status: 'failed', errorKind: 'connect' }),
    ]);
  });

  it('attended: a failing MCP server does not take a connected sibling down — its tools survive', async () => {
    // A declared REST API compiles with no network I/O, so it stands in for
    // the "connected sibling"; the MCP server on a dead port fails.
    const mcp = new McpConnectionManager(
      { bad: { transport: 'http', url: 'http://127.0.0.1:9' } },
      stubResolver({}),
      { good: { baseUrl: 'http://127.0.0.1:9', headers: { 'X-K': 'v' } } as any },
    );
    await mcp.connect({ failFast: false });
    const report = mcp.getConnectionReport();
    expect(report).toEqual([
      expect.objectContaining({ server: 'good', channel: 'api', status: 'connected', toolCount: 2 }),
      expect.objectContaining({ server: 'bad', channel: 'mcp', status: 'failed' }),
    ]);
    expect(mcp.listToolInfos().map((t) => t.name).sort()).toEqual(['api__good__get', 'api__good__request']);
  });

  it('attended: a server named in knownBad reports repeated: true when it fails again', async () => {
    const mcp = new McpConnectionManager(
      { s: { transport: 'http', url: 'http://127.0.0.1:9' } },
      stubResolver({}),
    );
    await mcp.connect({ failFast: false, knownBad: new Set(['s']) });
    expect(mcp.getConnectionReport()[0]).toMatchObject({ status: 'failed', repeated: true });
  });
});

/**
 * Connection report — single owner of the degrade fact and its renderings
 * (prompt band, chat warning, runtime failure note, fast-retry set). Gates
 * only: presence/absence and structural content, never pinned prose.
 */
describe('connectionReport — renderers and the fast-retry set', () => {
  const failed = {
    server: 'jira', channel: 'mcp' as const, status: 'failed' as const,
    error: 'credential key "JIRA_TOKEN" is not registered', errorKind: 'config' as const,
  };
  const ok = { server: 'ant', channel: 'api' as const, status: 'connected' as const, toolCount: 2 };

  it('failedServerNamesOf: failures only — the next turn retries exactly these fast', () => {
    expect(failedServerNamesOf([ok, failed])).toEqual(['jira']);
    expect(failedServerNamesOf([ok])).toEqual([]);
    expect(failedServerNamesOf(undefined)).toEqual([]);
  });

  it('capability-status lines: head count + one row per failure, naming server and error; empty without failures', () => {
    const lines = formatCapabilityStatusLines([ok, failed]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1 of 2');
    expect(lines[1]).toContain('jira');
    expect(lines[1]).toContain('JIRA_TOKEN');
    expect(formatCapabilityStatusLines([ok])).toEqual([]);
  });

  it('repeated failure is marked on the row (fast-retry visibility)', () => {
    const lines = formatCapabilityStatusLines([{ ...failed, repeated: true }]);
    expect(lines[1]).toMatch(/again/);
  });

  it('chat warning: null without failures; names each failed server with its error when present', () => {
    expect(formatConnectionWarningForChat([ok], 'en')).toBeNull();
    expect(formatConnectionWarningForChat(undefined, 'ko')).toBeNull();
    const text = formatConnectionWarningForChat([ok, failed], 'ko');
    expect(text).toContain('jira');
    expect(text).toContain('JIRA_TOKEN');
  });

  it('runtime failure note: user-role, [runtime]-prefixed, carries the bounded error message', () => {
    const note = buildRuntimeFailureNote(new Error('MCP server connect failed: 403 access blocked'));
    expect(note.role).toBe('user');
    expect(note.content).toMatch(/^\[runtime\]/);
    expect(note.content).toContain('403 access blocked');
    const long = buildRuntimeFailureNote(new Error('x'.repeat(5000)));
    expect(long.content.length).toBeLessThan(2000);
  });

  it('error-path seal carries lastConnectionReport only when failures exist (self-clear on healthy turns)', () => {
    const base = { main: [], customJobRef: 'a/j' };
    const withFailures = buildUniversalErrorSealState({ ...base, connectionReport: [ok, failed] });
    expect(withFailures.lastConnectionReport).toEqual([ok, failed]);
    const healthy = buildUniversalErrorSealState({ ...base, connectionReport: [ok] });
    expect(healthy).not.toHaveProperty('lastConnectionReport');
  });
});
