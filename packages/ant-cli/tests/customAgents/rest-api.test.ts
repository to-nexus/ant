/**
 * Declared REST API channel (`apis`) — one axis file for the executor's
 * mechanical rules and the validator grammar:
 *
 *   1. scope — a call can only reach the declared origin under the declared
 *      path prefix; redirects are never followed (auth header must not leak
 *      to an off-origin Location).
 *   2. allow — method+path admission is enforced before any request; GET
 *      implies HEAD; `*` is one segment, `**` any suffix.
 *   3. auth — declared headers win, per-call collisions are rejected, and
 *      resolved secret values never appear in tool args, results, or errors.
 *   4. framing — 2xx/3xx are success results; 4xx/5xx are errors WITH the
 *      body (an API-rejected write must not satisfy an action stop hook);
 *      network failures and policy rejections are errors.
 *   5. self — the second entry form declares neither URL nor credential; the
 *      runtime resolves both from the env, and every way that resolution can
 *      be wrong is loud at connect time rather than a 401 mid-turn.
 */

import { describe, it, expect } from 'vitest';
import { parseRestAllowLine, validateApiServers } from '@ant/shared';
import {
  buildRestToolInfos,
  compileRestServer,
  executeRestCall,
  isAllowedByRules,
  parseApiToolName,
  resolveRestConnectivity,
  resolveSelfApiConfig,
  REST_BODY_CAP_BYTES,
  REST_ERROR_HTML_EXTRACT_BYTES,
  SELF_API_LABEL,
  type CompiledRestServer,
} from '../../src/core/customAgents/restApi';
import { McpConnectionManager } from '../../src/core/customAgents/McpConnectionManager';
import { isMcpConfigError } from '../../src/core/customAgents/McpConfigError';
import type { McpCredentialResolver } from '../../src/core/customAgents/McpCredentialResolver';
import { requiresApproval } from '../../src/core/customAgents/universalToolPolicy';

const stubResolver = (entries: Record<string, string>): McpCredentialResolver => ({
  resolve: async (key) => entries[key],
});

function compiled(over: Partial<CompiledRestServer> = {}): CompiledRestServer {
  const baseUrl = 'https://erp.example.com/api';
  return compileRestServer(
    'douzone',
    { baseUrl },
    { baseUrl, headers: { Authorization: 'Bearer sk-live-XYZ', ...(over.headers ?? {}) }, label: baseUrl },
  );
}

/** fetch stub that records the request and returns a canned Response. */
function fetchStub(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return response();
  }) as typeof fetch;
  return { impl, calls };
}

const ok = (body = '{"ok":true}', status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  () => new Response(body, { status, headers });

describe('validateApiServers / parseRestAllowLine — grammar', () => {
  it.each([
    ['GET *', { method: 'GET', pattern: '*' }],
    ['post /vouchers/**', { method: 'POST', pattern: '/vouchers/**' }],
    ['* /health', { method: '*', pattern: '/health' }],
    ['GET /a/*/b', { method: 'GET', pattern: '/a/*/b' }],
  ])('accepts %s', (line, rule) => {
    expect(parseRestAllowLine(line)).toEqual(rule);
  });

  it.each(['GET', 'FETCH /x', 'GET vouchers', 'GET //x', 'GET /a//b', 'GET /a/../b', 'GET /v*part', ''])(
    'rejects %s',
    (line) => {
      expect(typeof parseRestAllowLine(line)).toBe('string');
    },
  );

  it.each([
    ['baseUrl required', { d: {} }, /"baseUrl" is required/],
    ['baseUrl must be absolute', { d: { baseUrl: '/api' } }, /not a valid absolute URL/],
    ['baseUrl http(s) only', { d: { baseUrl: 'ftp://x/api' } }, /must be http\(s\)/],
    ['no query on baseUrl', { d: { baseUrl: 'https://x/api?a=1' } }, /query string or fragment/],
    ['mcp keys rejected', { d: { baseUrl: 'https://x/api', transport: 'rest' } }, /belongs to mcp\.servers/],
    ['url rejected', { d: { baseUrl: 'https://x/api', url: 'https://y' } }, /belongs to mcp\.servers/],
    ['env rejected', { d: { baseUrl: 'https://x/api', env: { A: 'b' } } }, /belongs to mcp\.servers/],
    ['malformed secret ref', { d: { baseUrl: 'https://x/api', headers: { A: '${secret:bad-key}' } } }, /malformed/],
    ['bad header name', { d: { baseUrl: 'https://x/api', headers: { 'bad name': 'v' } } }, /not a valid HTTP header name/],
    ['empty allow', { d: { baseUrl: 'https://x/api', allow: [] } }, /non-empty list/],
    ['bad allow line', { d: { baseUrl: 'https://x/api', allow: ['GET'] } }, /allow rule/],
    ['bad name', { 'Bad_Name': { baseUrl: 'https://x/api' } }, /must be/],
  ])('%s', (_label, servers, pattern) => {
    expect(validateApiServers(servers as any).join('\n')).toMatch(pattern);
  });

  it('a valid entry with ${secret:KEY} headers and allow rules passes', () => {
    expect(
      validateApiServers({
        douzone: {
          baseUrl: 'https://erp.example.com/api',
          headers: { Authorization: '${secret:DOUZONE_TOKEN}', 'X-Company': '1000' },
          allow: ['GET *', 'POST /vouchers/**'],
        },
      }),
    ).toEqual([]);
  });
});

describe('tool synthesis', () => {
  it('exactly two tools per server — get readOnly, request not', () => {
    const infos = buildRestToolInfos('douzone', { baseUrl: 'https://erp.example.com/api' });
    expect(infos.map((i) => [i.name, i.readOnlyHint])).toEqual([
      ['api__douzone__get', true],
      ['api__douzone__request', false],
    ]);
    // The write tool's method enum excludes GET — a write can't ride the exempt tool.
    const request = infos[1].definition.input_schema as any;
    expect(request.properties.method.enum).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
    const get = infos[0].definition.input_schema as any;
    expect(get.properties.method.enum).toEqual(['GET', 'HEAD']);
  });

  it('parseApiToolName round-trips and rejects foreign names', () => {
    expect(parseApiToolName('api__douzone__get')).toEqual({ serverName: 'douzone', toolName: 'get' });
    expect(parseApiToolName('api__douzone__request')).toEqual({ serverName: 'douzone', toolName: 'request' });
    expect(parseApiToolName('api__douzone__other')).toBeNull();
    expect(parseApiToolName('mcp__douzone__get')).toBeNull();
  });

  it('approval mechanics: get exempt, request fail-closed, author never opt-out', () => {
    expect(requiresApproval('api__douzone__get', {}, { mcpReadOnlyHint: true })).toBe(false);
    expect(requiresApproval('api__douzone__request', {}, { mcpReadOnlyHint: false })).toBe(true);
    expect(requiresApproval('api__douzone__request', { api__douzone__request: 'never' }, { mcpReadOnlyHint: false })).toBe(false);
  });
});

describe('executor — path scope', () => {
  it.each([
    ['absolute URL', 'https://evil.example.com/x'],
    ['protocol-relative', '//evil.example.com/x'],
    ['not /-rooted', 'vouchers'],
    ['whitespace', '/vouchers /x'],
    ['backslash', '/vouchers\\x'],
  ])('rejects %s as a policy error before any request', async (_label, path) => {
    const { impl, calls } = fetchStub(ok());
    const res = await executeRestCall(compiled(), 'get', { path }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Policy/);
    expect(calls).toHaveLength(0);
  });

  it('a ../ escape normalizes out of the base path and fails closed', async () => {
    const { impl, calls } = fetchStub(ok());
    const res = await executeRestCall(compiled(), 'get', { path: '/../admin' }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/escapes the declared base URL/);
    expect(calls).toHaveLength(0);
  });

  it('resolves under baseUrl and appends query params', async () => {
    const { impl, calls } = fetchStub(ok());
    await executeRestCall(compiled(), 'get', { path: '/vouchers/2026', query: { month: '08' } }, impl);
    expect(calls[0].url).toBe('https://erp.example.com/api/vouchers/2026?month=08');
    expect(calls[0].init.redirect).toBe('manual');
  });
});

describe('executor — allow rules', () => {
  const rules = (lines: string[]) =>
    lines.map((l) => parseRestAllowLine(l)).filter((r): r is Exclude<typeof r, string> => typeof r !== 'string');

  it.each([
    [['GET *'], 'GET', '/anything/deep', true],
    [['GET *'], 'HEAD', '/anything', true], // GET implies HEAD
    [['GET *'], 'POST', '/anything', false],
    [['* /health'], 'DELETE', '/health', true],
    [['POST /vouchers/**'], 'POST', '/vouchers', true], // ** admits the empty suffix
    [['POST /vouchers/**'], 'POST', '/vouchers/a/b', true],
    [['POST /vouchers/**'], 'POST', '/orders', false],
    [['GET /a/*/c'], 'GET', '/a/b/c', true],
    [['GET /a/*/c'], 'GET', '/a/b/d/c', false], // * is exactly one segment
  ])('%j %s %s → %s', (lines, method, path, expected) => {
    expect(isAllowedByRules(rules(lines), method, path)).toBe(expected);
  });

  it('undefined allow admits everything; a violation is an actionable policy error', async () => {
    expect(isAllowedByRules(undefined, 'DELETE', '/x')).toBe(true);
    const server = compileRestServer(
      'douzone',
      { baseUrl: 'https://erp.example.com/api', allow: ['GET *', 'POST /vouchers/**'] },
      { baseUrl: 'https://erp.example.com/api', headers: {}, label: 'https://erp.example.com/api' },
    );
    const { impl, calls } = fetchStub(ok());
    const res = await executeRestCall(server, 'request', { method: 'DELETE', path: '/vouchers/1' }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not permitted .*allowed: GET \*, POST \/vouchers\/\*\*/);
    expect(calls).toHaveLength(0);
  });
});

describe('executor — auth boundary', () => {
  it('declared headers ride every request; a per-call override is rejected (case-insensitive)', async () => {
    const { impl, calls } = fetchStub(ok());
    await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-live-XYZ');

    const res = await executeRestCall(compiled(), 'get', { path: '/x', headers: { authorization: 'Bearer mine' } }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/declared by the server definition/);
  });

  it('the resolved secret value never appears in results or errors', async () => {
    const { impl } = fetchStub(() => new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } }));
    const failing = await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    const network = await executeRestCall(compiled(), 'get', { path: '/x' }, (async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:9');
    }) as typeof fetch);
    for (const r of [failing, network]) {
      expect(r.text).not.toContain('sk-live-XYZ');
    }
  });
});

describe('executor — result framing', () => {
  it('2xx returns status + content-type + body as success', async () => {
    const { impl } = fetchStub(ok('{"rows":[1]}'));
    const res = await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/^HTTP 200/);
    expect(res.text).toContain('{"rows":[1]}');
  });

  it('4xx is an ERROR carrying the body — a rejected write must not evidence a stop hook', async () => {
    const { impl } = fetchStub(() => new Response('{"error":"closed month"}', { status: 422, headers: { 'content-type': 'application/json' } }));
    const res = await executeRestCall(compiled(), 'request', { method: 'POST', path: '/vouchers', body: { amount: 1 } }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('closed month');
  });

  it('3xx is returned, never followed', async () => {
    const { impl, calls } = fetchStub(() => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } }));
    const res = await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/HTTP 302/);
    expect(res.text).toContain('https://evil.example.com/steal');
    expect(res.text).toMatch(/redirect not followed/);
    expect(calls).toHaveLength(1);
  });

  it('an object body serializes with JSON Content-Type; a string body needs an explicit non-JSON Content-Type', async () => {
    const { impl, calls } = fetchStub(ok());
    await executeRestCall(compiled(), 'request', { method: 'POST', path: '/v', body: { a: 1 } }, impl);
    expect(calls[0].init.body).toBe('{"a":1}');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    await executeRestCall(compiled(), 'request', { method: 'POST', path: '/v', body: 'a=1&b=2', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, impl);
    expect(calls[1].init.body).toBe('a=1&b=2');
    expect((calls[1].init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded');

    // A pre-serialized JSON string is refused before any network call — a
    // hand-escaped string is where corrupt \u escapes come from, and the
    // upstream body-parser answers them with an HTML stack page.
    const rejected = await executeRestCall(compiled(), 'request', { method: 'PUT', path: '/v', body: '{"a":1}' }, impl);
    expect(rejected.isError).toBe(true);
    expect(rejected.text).toMatch(/pass the structure itself/);
    expect(calls).toHaveLength(2);
  });

  it('an HTML error body is sanitized: tags stripped, local paths redacted, URL routes kept, capped', async () => {
    const stack = `<html><body><pre>SyntaxError: Bad Unicode escape in JSON at position 7695<br> at JSON.parse (&lt;anonymous&gt;)<br> at parse (/Users/probe/dev/ant/node_modules/.pnpm/body-parser@2.3.0/lib/types/json.js:92:19)<br>Cannot PUT /definitions/agents/x/file</pre>${'<p>pad</p>'.repeat(300)}</body></html>`;
    const { impl } = fetchStub(() => new Response(stack, { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const res = await executeRestCall(compiled(), 'request', { method: 'POST', path: '/v', body: { a: 1 } }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/^HTTP 400/);
    expect(res.text).not.toContain('<pre>');
    expect(res.text).not.toContain('/Users/');
    expect(res.text).not.toContain('node_modules');
    expect(res.text).toContain('Cannot PUT /definitions/agents/x/file');
    expect(res.text).toMatch(/HTML error page reduced/);
    expect(res.text.length).toBeLessThan(REST_ERROR_HTML_EXTRACT_BYTES + 400);
  });

  it('a JSON error body stays verbatim — it is recovery data', async () => {
    const { impl } = fetchStub(() => new Response('{"error":"Path is outside the definition whitelist"}', { status: 400, headers: { 'content-type': 'application/json' } }));
    const res = await executeRestCall(compiled(), 'request', { method: 'POST', path: '/v', body: { a: 1 } }, impl);
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Path is outside the definition whitelist');
  });

  it('a write method can never ride the get tool', async () => {
    const { impl, calls } = fetchStub(ok());
    const res = await executeRestCall(compiled(), 'get', { path: '/x', method: 'POST' }, impl);
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('oversized bodies truncate with an explicit note', async () => {
    const big = 'x'.repeat(REST_BODY_CAP_BYTES + 10);
    const { impl } = fetchStub(() => new Response(big, { status: 200, headers: { 'content-type': 'text/plain' } }));
    const res = await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    expect(res.isError).toBe(false);
    expect(res.text).toMatch(/truncated/);
    expect(res.text.length).toBeLessThan(REST_BODY_CAP_BYTES + 500);
  });

  it('binary content is summarized, not inlined', async () => {
    const { impl } = fetchStub(() => new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const res = await executeRestCall(compiled(), 'get', { path: '/x' }, impl);
    expect(res.text).toMatch(/binary body, 3 bytes/);
  });

  it('network failure is an error naming the request, not a throw', async () => {
    const res = await executeRestCall(compiled(), 'get', { path: '/x' }, (async () => {
      throw new Error('getaddrinfo ENOTFOUND erp.example.com');
    }) as typeof fetch);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Network error calling GET \/x/);
  });
});

describe('connection manager — apis channel', () => {
  it('connect compiles apis with resolved secrets and lists 2 tools per server, no Client involved', async () => {
    const mcp = new McpConnectionManager(
      {},
      stubResolver({ DOUZONE_TOKEN: 'Bearer tok' }),
      { douzone: { baseUrl: 'https://erp.example.com/api', headers: { Authorization: '${secret:DOUZONE_TOKEN}' } } },
    );
    await mcp.connect();
    expect(mcp.listToolInfos().map((t) => t.name)).toEqual(['api__douzone__get', 'api__douzone__request']);
    // Dispatch bypasses the MCP Client entirely: the failure is a network
    // error result, never an "MCP server not connected" throw.
    const res = await mcp.callTool('api__douzone__get', { path: '/x', timeout_ms: 1000 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/Network error/);
    await mcp.close();
  });

  it('an unregistered ${secret:KEY} in apis headers fails connect as McpConfigError (config_invalid funnel)', async () => {
    const mcp = new McpConnectionManager(
      {},
      stubResolver({}),
      { douzone: { baseUrl: 'https://erp.example.com/api', headers: { Authorization: '${secret:MISSING}' } } },
    );
    const err = await mcp.connect().then(() => null, (e) => e);
    expect(isMcpConfigError(err)).toBe(true);
    expect(String(err.message)).toMatch(/API server "douzone"/);
  });

  it('an invalid baseUrl fails connect as McpConfigError', async () => {
    const mcp = new McpConnectionManager({}, stubResolver({}), { d: { baseUrl: 'not-a-url' } });
    const err = await mcp.connect().then(() => null, (e) => e);
    expect(isMcpConfigError(err)).toBe(true);
  });
});

describe('self entry — connectivity resolved by the runtime', () => {
  const LOCAL = { ANT_API_URL: 'http://localhost:4100' } as NodeJS.ProcessEnv;
  const CLOUD = {
    ANT_API_URL: 'https://api.example.com',
    ANT_SERVER_MODE: 'cloud',
    ANT_SELF_API_TOKEN: 'ey.job.bearer',
  } as NodeJS.ProcessEnv;

  it('resolves the API mount under the injected origin', () => {
    expect(resolveSelfApiConfig('ant', LOCAL).baseUrl).toBe('http://localhost:4100/api');
    expect(resolveSelfApiConfig('ant', { ANT_API_URL: 'http://localhost:4100/' }).baseUrl).toBe('http://localhost:4100/api');
    expect(resolveSelfApiConfig('ant', CLOUD).baseUrl).toBe('https://api.example.com/api');
  });

  it('attaches the job bearer in cloud and nothing in local (no auth gate there)', () => {
    expect(resolveSelfApiConfig('ant', CLOUD).headers).toEqual({ Authorization: 'Bearer ey.job.bearer' });
    expect(resolveSelfApiConfig('ant', LOCAL).headers).toEqual({});
  });

  it('never puts the internal origin in the model-facing description', () => {
    const infos = buildRestToolInfos('ant', { self: true }, resolveSelfApiConfig('ant', CLOUD).label);
    expect(infos[0].definition.description).toContain(SELF_API_LABEL);
    for (const info of infos) {
      expect(info.definition.description).not.toContain('api.example.com');
    }
  });

  it('a missing or unusable origin fails loud at connect, not as a 401 mid-turn', () => {
    expect(() => resolveSelfApiConfig('ant', {})).toThrow(/ANT_API_URL is not set/);
    expect(() => resolveSelfApiConfig('ant', { ANT_API_URL: 'not-a-url' })).toThrow(/not a valid absolute URL/);
    expect(() => resolveSelfApiConfig('ant', { ANT_API_URL: 'ftp://x/y' })).toThrow(/must be http/);
    expect(isMcpConfigError(catchOf(() => resolveSelfApiConfig('ant', {})))).toBe(true);
  });

  it('cloud without a minted token is a wiring fault, not a silent 401', () => {
    expect(() =>
      resolveSelfApiConfig('ant', { ANT_API_URL: 'https://api.example.com', ANT_SERVER_MODE: 'cloud' }),
    ).toThrow(/carries no ANT_SELF_API_TOKEN/);
  });

  it('a self entry never consumes the credential resolver', () => {
    const conn = resolveRestConnectivity('ant', { self: true }, { Authorization: 'must-be-ignored' }, CLOUD);
    expect(conn.headers).toEqual({ Authorization: 'Bearer ey.job.bearer' });
  });

  it('an external entry keeps its own connectivity', () => {
    const conn = resolveRestConnectivity(
      'erp',
      { baseUrl: 'https://erp.example.com/api' },
      { Authorization: 'Bearer sk' },
      CLOUD,
    );
    expect(conn).toEqual({
      baseUrl: 'https://erp.example.com/api',
      headers: { Authorization: 'Bearer sk' },
      label: 'https://erp.example.com/api',
    });
  });

  it('the resolved path prefix still bounds every call', async () => {
    const server = compileRestServer('ant', { self: true }, resolveSelfApiConfig('ant', CLOUD));
    const { impl, calls } = fetchStub(ok());
    const escaped = await executeRestCall(server, 'get', { path: '/../auth/me' }, impl);
    expect(escaped.isError).toBe(true);
    expect(calls).toHaveLength(0);
    const inside = await executeRestCall(server, 'get', { path: '/definitions/agents' }, impl);
    expect(inside.isError).toBe(false);
    expect(calls[0].url).toBe('https://api.example.com/api/definitions/agents');
  });
});

describe('validator — the two entry forms are mutually exclusive', () => {
  it('accepts a self entry with only allow rules', () => {
    expect(validateApiServers({ ant: { self: true, allow: ['GET /definitions/agents/**'] } })).toEqual([]);
  });

  it('refuses connectivity keys alongside self', () => {
    expect(validateApiServers({ ant: { self: true, baseUrl: 'https://x/y' } as never })[0]).toMatch(/remove "baseUrl"/);
    expect(validateApiServers({ ant: { self: true, headers: { A: 'b' } } as never })[0]).toMatch(/remove "headers"/);
  });

  it('refuses a truthy string in place of the literal true', () => {
    expect(validateApiServers({ ant: { self: 'true' } as never })[0]).toMatch(/must be the literal boolean true/);
    expect(validateApiServers({ ant: { self: false } as never })[0]).toMatch(/must be the literal boolean true/);
  });

  it('an entry that is neither form still names baseUrl as the fix', () => {
    expect(validateApiServers({ ant: {} as never })[0]).toMatch(/"baseUrl" is required.*or declare "self: true"/);
  });
});

function catchOf(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}
