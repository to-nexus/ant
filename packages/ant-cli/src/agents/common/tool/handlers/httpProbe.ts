/**
 * http_request handler — runtime route verification.
 *
 * Issues a single HTTP request against a running dev server (started earlier
 * via `run_command keep_running:true`) and returns a structured FACT report —
 * status / latency / curated headers / bounded body / redirect chain — with NO
 * verdict. The LLM judges, consistent with the dev-server fact-report
 * philosophy in `runCommand.ts handleLongRunningCommand`.
 *
 * Gating: only available where persistent processes are unlocked (error tasks
 * / runtime-error verification). The selectors hide the tool; this handler
 * hard-rejects as defence-in-depth (mirrors `allowShellExecution`).
 *
 * Auto-port: a relative `url` (path beginning with `/`) resolves against the
 * most-recently-started tracked dev server's port, so the LLM never has to
 * discover the random port the server bound (the 3000→3001 failure mode).
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { httpRequestDetailed } from '../../../../infrastructure/ide/readiness';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function mostRecentServerPort(ctx: ToolExecutionContext): number | undefined {
  const withPort = (ctx.runningServers ?? []).filter(s => typeof s.port === 'number');
  if (!withPort.length) return undefined;
  return withPort.reduce((a, b) => (b.startedAt > a.startedAt ? b : a)).port;
}

export async function handleHttpRequest(
  ctx: ToolExecutionContext,
  args: { url?: string; method?: string; headers?: Record<string, string>; body?: string; port?: number; follow_redirects?: boolean },
): Promise<ToolResult> {
  // 1. Defence-in-depth gate.
  if (ctx.allowPersistentProcesses !== true) {
    return {
      content:
        '[Policy] http_request is only available in error tasks or runtime-error verification cycles. ' +
        'If a runtime reproducer is needed, the task should be an error task or the directive should describe a runtime error scenario.',
      sideEffects: [],
    };
  }

  const rawUrl = (args.url ?? '').trim();
  if (!rawUrl) {
    return { content: '[http_request] `url` is required (an absolute URL, or a path like "/api/...").', sideEffects: [] };
  }

  const method = (args.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { content: `[http_request] Unsupported method "${args.method}". Allowed: ${[...ALLOWED_METHODS].join(', ')}.`, sideEffects: [] };
  }

  // 2. Resolve target URL. Absolute url wins; otherwise treat as a path against
  //    the running dev server.
  let url: string;
  const isAbsolute = /^https?:\/\//i.test(rawUrl);
  if (isAbsolute) {
    url = rawUrl;
  } else {
    const port = args.port ?? mostRecentServerPort(ctx);
    if (!port) {
      return {
        content:
          '[http_request] No running dev server to target. Start one first with `run_command keep_running:true` ' +
          '(its server_url/port is reported back), or pass an absolute `url` or an explicit `port`.',
        sideEffects: [],
      };
    }
    const path = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    url = `http://localhost:${port}${path}`;
  }

  console.log(`   🌐 [http_request] ${method} ${url}`);

  // 3. One-shot request (bounded — cannot hang).
  const r = await httpRequestDetailed(url, {
    method,
    body: args.body,
    headers: args.headers,
    followRedirects: args.follow_redirects === true,
  });

  // 4. Fact report — no verdict.
  const lines = [
    `method: ${method}`,
    `url: ${url}`,
  ];
  if (r.ok) {
    lines.push(`status: ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`);
  } else {
    lines.push(`status: error`);
    lines.push(`error: ${r.error}`);
  }
  lines.push(`latency_ms: ${r.latencyMs}`);
  if (r.redirectChain?.length) {
    lines.push(`redirect_chain: ${r.redirectChain.map(h => `${h.status} -> ${h.location}`).join(', ')}`);
  }
  if (r.headers && Object.keys(r.headers).length) {
    lines.push('headers:');
    for (const [k, v] of Object.entries(r.headers)) lines.push(`  ${k}: ${v}`);
  }
  if (r.bodySnippet !== undefined) {
    lines.push(`body${r.bodyTruncated ? ' (truncated)' : ''}:`);
    lines.push(r.bodySnippet);
  }

  // 5. Read-only — no side effects.
  return { content: lines.join('\n'), sideEffects: [] };
}
