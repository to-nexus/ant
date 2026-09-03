/**
 * Declared REST API executor — the in-process counterpart of an MCP server
 * for systems that speak plain HTTP and have no MCP surface (`apis` entries).
 *
 * The declaration carries connectivity only (baseUrl + auth headers + optional
 * method/path allow-list); the runtime synthesizes two generic tools per entry
 * and executes calls itself with fetch. The API's knowledge (endpoints,
 * fields, sequences) is prose the model reads — intent prompt.md and
 * `on-demand/` files — never per-endpoint tool schemas.
 *
 * Boundary rules (each mechanical, not advisory):
 *  - `get` carries GET/HEAD only (readOnlyHint: true → approval-exempt);
 *    `request` carries writes only (fail-closed approval). The method enums
 *    are disjoint so a write can never ride the exempt tool.
 *  - `path` is a /-rooted relative path resolved under baseUrl; origin and
 *    path-prefix are asserted post-normalization (no absolute URLs, no
 *    `//host`, no `..` escapes).
 *  - Redirects are never followed (`redirect: 'manual'`) — a 3xx returns to
 *    the model as data, so an off-origin Location can't exfiltrate the auth
 *    header.
 *  - Declared headers (resolved `${secret:KEY}` values) win; a per-call
 *    header naming a declared one is rejected. Secret values never appear in
 *    tool args, results, or error text.
 *  - A 2xx/3xx response is a SUCCESS result (isError: false); 4xx/5xx return
 *    isError: true WITH the response body (a legacy API's error body is data
 *    the model must read), alongside network failures, timeouts, and policy
 *    rejections. The error framing matters beyond wording: action stop-hook
 *    evidence counts successful calls only, so an API-rejected write must
 *    never satisfy an `api__{server}__request` hook.
 *  - A string `body` rides only under an explicit caller Content-Type
 *    (form-encoded, plain text); without one it is refused before any network
 *    call — a pre-serialized JSON string is where corrupt `\u` escapes come
 *    from, and the upstream parser answers them with an HTML stack page.
 *  - An HTML 4xx/5xx body is reduced to a short sanitized extract (tags
 *    stripped, local filesystem paths redacted, hard byte cap): an error PAGE
 *    is not recovery data. JSON/text error bodies stay verbatim.
 *  - `McpConfigError` is thrown at compile (connect) time only — bad baseUrl
 *    — so job-runner keeps classifying definition mistakes as config_invalid.
 */

import {
  parseRestAllowLine,
  isSelfApiConfig,
  type RestAllowRule,
  type RestApiServerConfig,
  type ApiToolVerb,
  API_TOOL_PREFIX,
  API_TOOL_VERBS,
} from '@ant/shared';
import { CHILD_PROCESS_ENV } from '../types/processEnv';
import { McpConfigError } from './McpConfigError';
import type { McpCallResult, McpToolInfo } from './McpConnectionManager';
import type { ToolDefinition } from '../ports/llm';

export const REST_CALL_TIMEOUT_DEFAULT_MS = 30_000;
export const REST_CALL_TIMEOUT_MIN_MS = 1_000;
export const REST_CALL_TIMEOUT_MAX_MS = 60_000;
/** Response-body read cap — beyond this the text is truncated with a note. */
export const REST_BODY_CAP_BYTES = 2 * 1024 * 1024;
/** Sanitized extract cap for HTML error pages fed back to the model. */
export const REST_ERROR_HTML_EXTRACT_BYTES = 512;

const GET_METHODS = ['GET', 'HEAD'] as const;
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

export interface CompiledRestServer {
  serverName: string;
  /** Parsed baseUrl; pathname normalized without a trailing slash ('' for root). */
  baseUrl: URL;
  basePath: string;
  /** Declared headers with `${secret:KEY}` references already resolved. */
  headers: Record<string, string>;
  /** Compiled allow rules; undefined = every method+path under baseUrl. */
  allow?: RestAllowRule[];
}

export function buildApiToolName(serverName: string, tool: ApiToolVerb): string {
  return `${API_TOOL_PREFIX}${serverName}__${tool}`;
}

/** Split `api__{server}__{get|request}`; null if not api-shaped. */
export function parseApiToolName(prefixed: string): { serverName: string; toolName: ApiToolVerb } | null {
  if (!prefixed.startsWith(API_TOOL_PREFIX)) return null;
  const rest = prefixed.slice(API_TOOL_PREFIX.length);
  const sep = rest.lastIndexOf('__');
  if (sep <= 0) return null;
  const toolName = rest.slice(sep + 2);
  if (!(API_TOOL_VERBS as readonly string[]).includes(toolName)) return null;
  return { serverName: rest.slice(0, sep), toolName: toolName as ApiToolVerb };
}

/** Path prefix every Ant HTTP route is mounted under. */
const SELF_API_BASE_PATH = '/api';

/** What the tool descriptions call a self entry — never the internal origin. */
export const SELF_API_LABEL = 'this Ant server';

/**
 * Connectivity for one entry: where to call and as whom. An external entry
 * carries its own; a self entry has it resolved from the process env.
 */
export interface ResolvedRestConnectivity {
  baseUrl: string;
  headers: Record<string, string>;
  /** Shown to the model in place of a raw origin. */
  label: string;
}

/**
 * Resolve a `self: true` entry against the env the parent already injects.
 *
 * The author declares neither URL nor credential, so both failures are
 * definition-independent misconfiguration and must be loud: they surface as
 * McpConfigError at connect time (→ `config_invalid`), never as a mysterious
 * 401 mid-turn. Local mode legitimately has no token — it runs no auth gate.
 */
export function resolveSelfApiConfig(
  serverName: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRestConnectivity {
  const apiUrl = env[CHILD_PROCESS_ENV.API_URL]?.trim();
  if (!apiUrl) {
    throw new McpConfigError(
      `API server "${serverName}" declares "self: true" but ${CHILD_PROCESS_ENV.API_URL} is not set on this process — ` +
        'the runtime cannot resolve this Ant server\'s own origin',
      { serverName },
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new McpConfigError(
      `API server "${serverName}": ${CHILD_PROCESS_ENV.API_URL} ("${apiUrl}") is not a valid absolute URL`,
      { serverName },
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpConfigError(`API server "${serverName}": ${CHILD_PROCESS_ENV.API_URL} must be http(s)`, { serverName });
  }

  const token = env[CHILD_PROCESS_ENV.SELF_API_TOKEN]?.trim();
  const isCloud = env[CHILD_PROCESS_ENV.SERVER_MODE] === 'cloud';
  if (isCloud && !token) {
    // The mint is unconditional whenever a self entry is declared, so an
    // absent token in cloud is a wiring fault — every call would 401.
    throw new McpConfigError(
      `API server "${serverName}" declares "self: true" but this job carries no ${CHILD_PROCESS_ENV.SELF_API_TOKEN} — ` +
        'the API would refuse every call',
      { serverName },
    );
  }

  const base = parsed.href.replace(/\/+$/, '') + SELF_API_BASE_PATH;
  return {
    baseUrl: base,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    label: SELF_API_LABEL,
  };
}

/** Connectivity for either entry form. External entries need their headers already resolved. */
export function resolveRestConnectivity(
  serverName: string,
  cfg: RestApiServerConfig,
  resolvedHeaders: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedRestConnectivity {
  if (isSelfApiConfig(cfg)) return resolveSelfApiConfig(serverName, env);
  return { baseUrl: cfg.baseUrl, headers: resolvedHeaders, label: cfg.baseUrl };
}

/**
 * Compile one declared API server. Connectivity arrives ALREADY RESOLVED via
 * {@link resolveRestConnectivity} — external headers through the credential
 * resolver (single credential rule with MCP), a self entry through the process
 * env. Throws McpConfigError on a bad baseUrl; performs no network I/O.
 */
export function compileRestServer(
  serverName: string,
  cfg: RestApiServerConfig,
  connectivity: ResolvedRestConnectivity,
): CompiledRestServer {
  let baseUrl: URL;
  try {
    baseUrl = new URL(connectivity.baseUrl);
  } catch {
    throw new McpConfigError(`API server "${serverName}": baseUrl "${connectivity.baseUrl}" is not a valid absolute URL`, { serverName });
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new McpConfigError(`API server "${serverName}": baseUrl must be http(s)`, { serverName });
  }
  let allow: RestAllowRule[] | undefined;
  if (cfg.allow !== undefined) {
    allow = [];
    for (const line of cfg.allow) {
      const rule = parseRestAllowLine(line);
      if (typeof rule === 'string') {
        throw new McpConfigError(`API server "${serverName}": ${rule}`, { serverName });
      }
      allow.push(rule);
    }
  }
  return {
    serverName,
    baseUrl,
    basePath: baseUrl.pathname.replace(/\/+$/, ''),
    headers: connectivity.headers,
    allow,
  };
}

function describeAllow(cfg: RestApiServerConfig): string {
  return cfg.allow && cfg.allow.length > 0 ? cfg.allow.join(', ') : 'every path under the base URL';
}

const PATH_PROP = {
  type: 'string',
  description: "Path relative to the base URL, starting with '/'. Never an absolute URL.",
};
const QUERY_PROP = {
  type: 'object',
  additionalProperties: { type: 'string' },
  description: 'Query parameters, appended URL-encoded.',
};
const HEADERS_PROP = {
  type: 'object',
  additionalProperties: { type: 'string' },
  description: 'Extra request headers (e.g. Accept, Content-Type). Declared server headers (auth) cannot be overridden.',
};
const TIMEOUT_PROP = {
  type: 'integer',
  minimum: REST_CALL_TIMEOUT_MIN_MS,
  maximum: REST_CALL_TIMEOUT_MAX_MS,
  description: `Request timeout in milliseconds (default ${REST_CALL_TIMEOUT_DEFAULT_MS}).`,
};

/**
 * The two synthesized tool definitions for one declared API server. The
 * descriptions point the model at the prose knowledge channel — endpoint
 * discovery means reading the documented files, not probing paths.
 */
export function buildRestToolInfos(
  serverName: string,
  cfg: RestApiServerConfig,
  baseLabel: string = isSelfApiConfig(cfg) ? SELF_API_LABEL : cfg.baseUrl,
): McpToolInfo[] {
  const docsPointer =
    'For endpoint documentation (paths, fields, call sequences) consult this job\'s instructions and on-demand documents — do not guess paths.';
  const getName = buildApiToolName(serverName, 'get');
  const requestName = buildApiToolName(serverName, 'request');
  return [
    {
      name: getName,
      serverName,
      toolName: 'get',
      readOnlyHint: true,
      definition: {
        name: getName,
        description:
          `HTTP GET/HEAD against the "${serverName}" REST API (base: ${baseLabel}). Read-only. ` +
          `Allowed: ${describeAllow(cfg)}. ${docsPointer}`,
        input_schema: {
          type: 'object',
          properties: {
            path: PATH_PROP,
            method: { type: 'string', enum: [...GET_METHODS], description: 'Defaults to GET.' },
            query: QUERY_PROP,
            headers: HEADERS_PROP,
            timeout_ms: TIMEOUT_PROP,
          },
          required: ['path'],
        } as ToolDefinition['input_schema'],
      },
    },
    {
      name: requestName,
      serverName,
      toolName: 'request',
      readOnlyHint: false,
      definition: {
        name: requestName,
        description:
          `HTTP write (POST/PUT/PATCH/DELETE) against the "${serverName}" REST API (base: ${baseLabel}). ` +
          `Allowed: ${describeAllow(cfg)}. ${docsPointer}`,
        input_schema: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: [...WRITE_METHODS] },
            path: PATH_PROP,
            query: QUERY_PROP,
            body: {
              description:
                'Request body. Pass the JSON structure itself (object/array) — the runtime serializes it and sets Content-Type: application/json. A pre-serialized JSON string is rejected; a string body is accepted only alongside an explicit non-JSON Content-Type header (form-encoded, plain text).',
            },
            headers: HEADERS_PROP,
            timeout_ms: TIMEOUT_PROP,
          },
          required: ['method', 'path'],
          // `body` deliberately omits `type` (object OR string) — wider than
          // the narrowed TS schema shape, same escape hatch as MCP-listed schemas.
        } as unknown as ToolDefinition['input_schema'],
      },
    },
  ];
}

function policyError(text: string): McpCallResult {
  return { text, isError: true };
}

/**
 * Reduce an HTML error page to a short plain-text extract: tags and entities
 * stripped, local filesystem paths (stack-trace frames) redacted — URL routes
 * like "Cannot PUT /definitions/…" survive, they ARE the signal — and hard
 * byte cap applied.
 */
function sanitizeHtmlErrorBody(html: string): string {
  const stripped = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/(?:[A-Za-z]:\\|\/(?:Users|home|var|tmp|opt|usr|private|srv|etc)\/)[^\s)"']+/g, '<local-path>')
    .replace(/\S*node_modules\S*/g, '<local-path>')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > REST_ERROR_HTML_EXTRACT_BYTES
    ? `${stripped.slice(0, REST_ERROR_HTML_EXTRACT_BYTES)} …`
    : stripped;
}

function matchSegments(patternSegs: string[], pathSegs: string[]): boolean {
  let pi = 0;
  let si = 0;
  while (pi < patternSegs.length) {
    const p = patternSegs[pi];
    if (p === '**') return true; // any suffix, including empty
    if (si >= pathSegs.length) return false;
    if (p !== '*' && p !== pathSegs[si]) return false;
    pi++;
    si++;
  }
  return si === pathSegs.length;
}

/** Method+path admission against the compiled allow rules (GET implies HEAD). */
export function isAllowedByRules(allow: RestAllowRule[] | undefined, method: string, relPath: string): boolean {
  if (!allow) return true;
  const pathSegs = relPath.replace(/^\/+/, '').split('/').filter((s) => s !== '');
  return allow.some((rule) => {
    const methodOk = rule.method === '*' || rule.method === method || (rule.method === 'GET' && method === 'HEAD');
    if (!methodOk) return false;
    if (rule.pattern === '*') return true;
    return matchSegments(rule.pattern.replace(/^\//, '').split('/'), pathSegs);
  });
}

function isTextLike(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('x-www-form-urlencoded') ||
    ct.includes('javascript') ||
    ct === ''
  );
}

/**
 * Execute one synthesized-tool call. Returns an McpCallResult so the shared
 * registry handler (spooling, error framing) applies unchanged. Never throws
 * on request failure; `fetchImpl` is injectable for tests.
 */
export async function executeRestCall(
  compiled: CompiledRestServer,
  toolName: 'get' | 'request',
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<McpCallResult> {
  // method — bounded by the tool's own enum, defense-in-depth re-checked here.
  const legalMethods: readonly string[] = toolName === 'get' ? GET_METHODS : WRITE_METHODS;
  const method = typeof args.method === 'string' ? args.method.toUpperCase() : toolName === 'get' ? 'GET' : '';
  if (!legalMethods.includes(method)) {
    return policyError(`Policy: method must be one of ${legalMethods.join(', ')} for this tool (got: ${String(args.method)}).`);
  }

  // path — /-rooted relative only; resolve and assert it stays under baseUrl.
  const rawPath = args.path;
  if (typeof rawPath !== 'string' || !/^\/(?!\/)/.test(rawPath) || rawPath.includes('\\') || /\s/.test(rawPath)) {
    return policyError(`Policy: "path" must be a /-rooted path relative to the base URL (got: ${String(rawPath)}).`);
  }
  const baseHref = compiled.baseUrl.href.replace(/\/+$/, '') + '/';
  let resolved: URL;
  try {
    resolved = new URL('.' + rawPath, baseHref);
  } catch {
    return policyError(`Policy: "path" could not be resolved under the base URL (got: ${rawPath}).`);
  }
  if (
    resolved.origin !== compiled.baseUrl.origin ||
    (resolved.pathname !== compiled.basePath && !resolved.pathname.startsWith(compiled.basePath + '/'))
  ) {
    return policyError(`Policy: resolved path escapes the declared base URL (${compiled.baseUrl.href}).`);
  }
  const relPath = resolved.pathname.slice(compiled.basePath.length) || '/';

  // allow-list — mechanical scope, checked before any request is sent.
  if (!isAllowedByRules(compiled.allow, method, relPath)) {
    const allowText = compiled.allow?.map((r) => `${r.method} ${r.pattern}`).join(', ') ?? '';
    return policyError(
      `Policy: ${method} ${relPath} is not permitted by API server "${compiled.serverName}" (allowed: ${allowText}). ` +
        'Adjust the call, or ask the job author to extend "allow" in the definition.',
    );
  }

  // query
  if (args.query !== undefined) {
    if (typeof args.query !== 'object' || args.query === null || Array.isArray(args.query)) {
      return policyError('Policy: "query" must be an object of string values.');
    }
    for (const [k, v] of Object.entries(args.query as Record<string, unknown>)) {
      resolved.searchParams.append(k, String(v));
    }
  }

  // headers — declared (auth) win; a per-call collision is rejected, so the
  // model can neither replace nor read back a resolved secret.
  const declaredNames = new Set(Object.keys(compiled.headers).map((k) => k.toLowerCase()));
  const headers: Record<string, string> = {};
  if (args.headers !== undefined) {
    if (typeof args.headers !== 'object' || args.headers === null || Array.isArray(args.headers)) {
      return policyError('Policy: "headers" must be an object of string values.');
    }
    for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
      if (declaredNames.has(k.toLowerCase())) {
        return policyError(`Policy: header "${k}" is declared by the server definition and cannot be overridden per call.`);
      }
      headers[k] = String(v);
    }
  }

  // body (write tool only) — the structure itself, serialized by the runtime.
  // A pre-serialized JSON string without an explicit Content-Type is refused
  // locally: hand-escaped strings are where corrupt `\u` escapes come from,
  // and the upstream body-parser's answer is an HTML stack page the model
  // cannot recover from. Form-encoded / plain-text bodies declare their
  // Content-Type and ride verbatim.
  let body: string | undefined;
  if (toolName === 'request' && args.body !== undefined && args.body !== null) {
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (typeof args.body === 'string' && !hasContentType) {
      return policyError(
        'Policy: "body" must be a JSON object or array — pass the structure itself, not a pre-serialized JSON string; the runtime serializes it and sets Content-Type: application/json. For a form-encoded or plain-text body, set an explicit Content-Type header.',
      );
    }
    body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
    if (!hasContentType) headers['Content-Type'] = 'application/json';
  }
  Object.assign(headers, compiled.headers);

  const timeoutRaw = typeof args.timeout_ms === 'number' ? args.timeout_ms : REST_CALL_TIMEOUT_DEFAULT_MS;
  const timeoutMs = Math.min(REST_CALL_TIMEOUT_MAX_MS, Math.max(REST_CALL_TIMEOUT_MIN_MS, timeoutRaw));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(resolved.href, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') ?? '';
    const head = `HTTP ${res.status} ${res.statusText}`.trimEnd();
    if (res.status >= 300 && res.status < 400) {
      // Never followed — an off-origin Location must not receive the auth header.
      const location = res.headers.get('location') ?? '(no Location header)';
      return { text: `${head}\nlocation: ${location}\n\n(redirect not followed by policy)`, isError: false };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isTextLike(contentType)) {
      return {
        text: `${head}\ncontent-type: ${contentType}\n\n(binary body, ${buf.byteLength} bytes — not returned inline)`,
        isError: res.status >= 400,
      };
    }
    let text = buf.toString('utf-8');
    let note = '';
    if (res.status >= 400 && /html/i.test(contentType)) {
      // An upstream error PAGE (Express default handler, a proxy) is not
      // recovery data: strip tags, redact local filesystem paths (stack
      // traces), cap hard. JSON/text error bodies stay verbatim below.
      text = sanitizeHtmlErrorBody(text);
      note = `\n\n[HTML error page reduced: ${buf.byteLength} bytes → sanitized extract (cap ${REST_ERROR_HTML_EXTRACT_BYTES}) — the status line is the signal; the request may not have reached the API handler]`;
    } else if (buf.byteLength > REST_BODY_CAP_BYTES) {
      text = buf.subarray(0, REST_BODY_CAP_BYTES).toString('utf-8');
      note = `\n\n[... truncated: body is ${buf.byteLength} bytes, cap is ${REST_BODY_CAP_BYTES} ...]`;
    }
    // 4xx/5xx are errors (stop-hook evidence must not count a rejected write),
    // but the body rides along — it is what the model plans recovery from.
    return { text: `${head}\ncontent-type: ${contentType}\n\n${text}${note}`, isError: res.status >= 400 };
  } catch (e) {
    const reason = (e as Error)?.name === 'AbortError'
      ? `request timed out after ${timeoutMs}ms`
      : `${(e as Error)?.message ?? String(e)}`;
    return { text: `Network error calling ${method} ${relPath} on API server "${compiled.serverName}": ${reason}`, isError: true };
  } finally {
    clearTimeout(timer);
  }
}
