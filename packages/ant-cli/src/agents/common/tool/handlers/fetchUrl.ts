/**
 * fetch_url handler — Tavily Extract API (URL → page content)
 *
 * Sibling of `search_web` but a DIFFERENT capability:
 *   - search_web  → Tavily `/search`  : keyword → ranked result snippets
 *   - fetch_url   → Tavily `/extract` : a specific URL → that page's content
 *
 * Use when the directive names a concrete URL / live site / deployed page to
 * analyze. `search_web` cannot read a given URL — it only matches keywords.
 *
 * Reuses ANT_TAVILY_API_KEY. The fetch happens on Tavily's servers, so no
 * SSRF surface is introduced on the Ant side.
 */

import type { ToolExecutionContext, ToolResult } from '../types';

/** Extracted body is truncated to keep the tool result within budget. */
const MAX_CONTENT_CHARS = 8000;

/**
 * Low-level URL extraction via Tavily API.
 * Returns a formatted string. Usable without ToolExecutionContext.
 */
export async function executeFetchUrl(args: { url: string }): Promise<string> {
  const apiKey = process.env.ANT_TAVILY_API_KEY;

  if (!apiKey) {
    console.log(`🌐 [FetchUrl] No API key configured, using graceful fallback`);
    return `URL fetch is not configured (ANT_TAVILY_API_KEY not set). Proceed with available information about: "${args.url}"`;
  }

  console.log(`🌐 [FetchUrl] Fetching: ${args.url}`);

  try {
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        urls: [args.url],
        extract_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🌐 [FetchUrl] API error (${response.status}): ${errorText}`);
      return `URL fetch failed (HTTP ${response.status}) for "${args.url}". Proceed with available information, or try search_web with related keywords.`;
    }

    const data = await response.json() as {
      results?: Array<{ url: string; raw_content?: string }>;
      failed_results?: Array<{ url: string; error?: string }>;
    };

    const result = data.results?.[0];
    if (!result || !result.raw_content) {
      const failure = data.failed_results?.[0]?.error;
      console.log(`🌐 [FetchUrl] No content extracted${failure ? ` (${failure})` : ''}`);
      return `Could not extract page content from "${args.url}"${failure ? ` (${failure})` : ''}. The page may require authentication or render only client-side. Proceed with available information, or try search_web with related keywords.`;
    }

    const body = result.raw_content.length > MAX_CONTENT_CHARS
      ? result.raw_content.substring(0, MAX_CONTENT_CHARS) + '\n\n…[content truncated]'
      : result.raw_content;

    console.log(`🌐 [FetchUrl] Extracted ${result.raw_content.length} chars from ${result.url}`);
    return `## Page content: ${result.url}\n\n${body}`;
  } catch (error: any) {
    console.error(`🌐 [FetchUrl] Error: ${error.message}`);
    return `URL fetch encountered an error: ${error.message}. Proceed with available information about: "${args.url}"`;
  }
}

/**
 * ToolHandler-compatible wrapper for the unified tool system.
 *
 * Mirrors `handleSearchWeb`: in the plan phase, reject further `fetch_url`
 * calls once `planFetchUrlLimit` have been executed in this plan-toolLoop
 * session. Prevents the LLM from burning rounds fetching page after page
 * when the evidence already gathered is enough to write the document.
 */
export async function handleFetchUrl(
  ctx: ToolExecutionContext,
  args: { url: string },
): Promise<ToolResult> {
  if (ctx.activePhase === 'plan') {
    const limit = ctx.planFetchUrlLimit ?? 5;
    const used = ctx.planFetchUrlCount ?? 0;
    if (used >= limit) {
      const message = `fetch_url rejected: plan-phase limit of ${limit} call(s) reached in this task (already used ${used}). Produce the output from the evidence already gathered; do NOT keep fetching more pages.`;
      console.warn(`🌐 [FetchUrl] ${message}`);
      return { content: `SKIPPED: ${message}`, error: 'plan_fetch_url_limit' };
    }
  }

  try {
    const result = await executeFetchUrl(args);
    return { content: result };
  } catch (e) {
    const errorMsg = (e as Error).message;
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
