/**
 * IDE readiness probes — shared between Docker and K8s orchestrators.
 *
 * Extracted from IDEService.ts so K8s entry points can reuse the same
 * polling shape (TCP socket + HTTP <500 status). Replaces ad-hoc loops
 * that previously diverged between local and cloud paths.
 */

import * as net from 'net';

const TCP_POLL_INTERVAL_MS = 300;
const TCP_CONNECT_TIMEOUT_MS = 800;
const HTTP_POLL_INTERVAL_MS = 300;
const HTTP_REQUEST_TIMEOUT_MS = 1000;

export async function waitForTcpReady(
  host: string,
  port: number,
  timeoutMs: number = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (result: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, TCP_POLL_INTERVAL_MS));
  }
  throw new Error(`TCP port not ready in ${timeoutMs}ms (host=${host}, port=${port})`);
}

/**
 * Poll an HTTP endpoint and return the structured result of the first
 * status < 500 response (or the last observed status / error on timeout).
 * Does not throw. Used by callers that need to embed the probe outcome
 * in their own report (e.g. dev-server fact reports) rather than just
 * "ready vs not".
 */
export async function probeHttp(
  host: string,
  port: number,
  path: string = '/',
  timeoutMs: number = 15_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const start = Date.now();
  const url = `http://${host}:${port}${path}`;
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  while (Date.now() - start < timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      lastStatus = res.status;
      if (res.status > 0 && res.status < 500) return { ok: true, status: res.status };
    } catch (err) {
      lastError = (err as Error).message;
    } finally {
      clearTimeout(t);
    }
    await new Promise(r => setTimeout(r, HTTP_POLL_INTERVAL_MS));
  }
  return {
    ok: false,
    status: lastStatus,
    error: lastError ?? `HTTP endpoint not ready in ${timeoutMs}ms (url=${url})`,
  };
}

export interface HttpRequestDetail {
  /** The fetch completed (any status) without a network/timeout error. */
  ok: boolean;
  status?: number;
  statusText?: string;
  latencyMs: number;
  /** Curated header allowlist only — never the full header set (no cookie/token dumps). */
  headers?: Record<string, string>;
  /** Bounded response body; `bodyTruncated` is true when it was cut. */
  bodySnippet?: string;
  bodyTruncated?: boolean;
  /** Captured 3xx hops when redirects are not followed. */
  redirectChain?: Array<{ status: number; location: string }>;
  /** Fetch-level cause (timeout / ECONNREFUSED / ...) when ok is false. */
  error?: string;
}

const PROBE_HEADER_ALLOWLIST = [
  'content-type',
  'location',
  'www-authenticate',
  'cache-control',
  'x-powered-by',
] as const;
const BODY_SNIPPET_LIMIT = 2000;

/**
 * One-shot HTTP request for runtime route verification (the `http_request`
 * tool). Unlike `probeHttp` (a poll-until-ready gate), this issues a single
 * request and returns the full structured outcome — status, latency, a
 * curated header subset, a bounded body snippet, and the redirect chain when
 * redirects are not followed. Never throws; a transport failure is encoded as
 * `{ ok: false, error }`. The caller (LLM) judges — no verdict here.
 *
 * Header exposure is allowlisted and `set-cookie` is reduced to presence only
 * so auth tokens / session cookies never land in the model context.
 */
export async function httpRequestDetailed(
  url: string,
  opts: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    followRedirects?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<HttpRequestDetail> {
  const { method = 'GET', body, headers, followRedirects = false, timeoutMs = 8_000 } = opts;
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: followRedirects ? 'follow' : 'manual',
      signal: controller.signal,
    });

    const pickedHeaders: Record<string, string> = {};
    for (const key of PROBE_HEADER_ALLOWLIST) {
      const v = res.headers.get(key);
      if (v) pickedHeaders[key] = v;
    }
    if (res.headers.has('set-cookie')) pickedHeaders['set-cookie'] = '<present>';

    const redirectChain =
      !followRedirects && res.status >= 300 && res.status < 400 && res.headers.get('location')
        ? [{ status: res.status, location: res.headers.get('location') as string }]
        : undefined;

    let bodySnippet: string | undefined;
    let bodyTruncated = false;
    try {
      const text = await res.text();
      if (text.length > BODY_SNIPPET_LIMIT) {
        bodySnippet = text.slice(0, BODY_SNIPPET_LIMIT);
        bodyTruncated = true;
      } else {
        bodySnippet = text;
      }
    } catch {
      /* body read failed — leave undefined */
    }

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      latencyMs: Date.now() - start,
      headers: Object.keys(pickedHeaders).length ? pickedHeaders : undefined,
      bodySnippet,
      bodyTruncated: bodyTruncated || undefined,
      redirectChain,
    };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Poll an HTTP endpoint until it returns any status < 500 (200/302/401 etc).
 * Throws on timeout. Used by IDE/K8s readiness gates that want a single
 * point of failure rather than a structured outcome.
 */
export async function waitForHttpReady(
  host: string,
  port: number,
  path: string = '/',
  timeoutMs: number = 15_000,
): Promise<void> {
  const result = await probeHttp(host, port, path, timeoutMs);
  if (!result.ok) {
    // Wait-gate semantics: the caller only cares that readiness was not
    // achieved within the budget. Always surface the timeout framing here
    // (probeHttp's `error` field carries the fetch-level cause for
    // structured consumers like the dev-server fact report).
    throw new Error(`HTTP endpoint not ready in ${timeoutMs}ms (url=http://${host}:${port}${path})`);
  }
}
