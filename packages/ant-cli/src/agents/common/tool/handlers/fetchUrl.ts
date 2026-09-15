/**
 * fetch_url handler — a specific URL → that page's text content.
 *
 * Sibling of `search_web` but a DIFFERENT capability:
 *   - search_web  → Tavily `/search`  : keyword → ranked result snippets
 *   - fetch_url   → this handler      : a specific URL → that page's content
 *
 * Two fetchers, one policy:
 *   - With `ANT_TAVILY_API_KEY` set, Tavily `/extract` fetches on Tavily's
 *     servers (no egress from Ant at all).
 *   - Without it, the in-process self-fetcher reads the page through
 *     `fetchPublicUrl` (core/config/urlPolicy): public addresses only, every
 *     redirect hop re-vetted, no cookies or ambient credentials, bounded
 *     time and bytes, HTML reduced to text. A page on this host is not a
 *     public page — that is `http_request`'s job.
 *
 * `search_web` has no such fallback: a keyword search needs a search engine.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import {
  fetchPublicUrl,
  isEgressPolicyError,
  type PublicFetchOptions,
  type PublicFetchResult,
} from '../../../../core/config/urlPolicy';

/** Extracted body is truncated to keep the tool result within budget. */
const MAX_CONTENT_CHARS = 8000;

/** Self-fetcher bounds. The byte cap is generous for a text page and tiny for a heap. */
const SELF_FETCH_MAX_BYTES = 1024 * 1024;
const SELF_FETCH_TIMEOUT_MS = 15_000;
const SELF_FETCH_MAX_REDIRECTS = 3;

export type PublicFetcher = (url: string, opts: PublicFetchOptions) => Promise<PublicFetchResult>;

/** Reduce an HTML document to readable text: scripts/styles/comments dropped, block tags → newlines. */
export function htmlToText(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|blockquote|pre|header|footer|nav|main|aside|table|ul|ol|dd|dt)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return title && !text.startsWith(title) ? `# ${title}\n\n${text}` : text;
}

function isTextLike(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct === '' || ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('javascript');
}

function capContent(raw: string): string {
  return raw.length > MAX_CONTENT_CHARS
    ? raw.substring(0, MAX_CONTENT_CHARS) + '\n\n…[content truncated]'
    : raw;
}

async function selfFetch(url: string, fetcher: PublicFetcher): Promise<string> {
  let r: PublicFetchResult;
  try {
    r = await fetcher(url, {
      maxBytes: SELF_FETCH_MAX_BYTES,
      onOverflow: 'truncate',
      timeoutMs: SELF_FETCH_TIMEOUT_MS,
      maxRedirects: SELF_FETCH_MAX_REDIRECTS,
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5',
        'user-agent': 'ant-fetch-url/1.0',
      },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (isEgressPolicyError(e)) {
      console.log(`🌐 [FetchUrl] Refused by egress policy: ${msg}`);
      return `URL fetch refused for "${url}": ${msg}. fetch_url reads public web pages only — a server running on this host is reached with http_request, and internal or private addresses are never fetched.`;
    }
    console.error(`🌐 [FetchUrl] Self-fetch failed: ${msg}`);
    return `URL fetch failed for "${url}" (${msg}). Proceed with available information, or try search_web with related keywords.`;
  }
  if (!isTextLike(r.contentType)) {
    return `"${r.url}" returned ${r.contentType || 'an unknown content type'} (${r.body.byteLength} bytes) — not a text page. fetch_url reads text content only.`;
  }
  const text = r.body.toString('utf-8');
  const isHtml = /html/i.test(r.contentType) || /^\s*<(!doctype|html)/i.test(text);
  const content = isHtml ? htmlToText(text) : text.trim();
  if (!content) {
    return `Could not extract page content from "${r.url}" — the page may render only client-side. Proceed with available information, or try search_web with related keywords.`;
  }
  console.log(`🌐 [FetchUrl] Self-fetched ${r.body.byteLength} bytes from ${r.url}${r.truncated ? ' (truncated at byte cap)' : ''}`);
  return `## Page content: ${r.url}\n\n${capContent(content)}`;
}

/**
 * Low-level URL extraction. Tavily when configured, the policy-bound
 * self-fetcher otherwise. Returns a formatted string; never throws. Usable
 * without ToolExecutionContext. `fetcher` is injectable for tests.
 */
export async function executeFetchUrl(
  args: { url: string },
  fetcher: PublicFetcher = fetchPublicUrl,
): Promise<string> {
  const apiKey = process.env.ANT_TAVILY_API_KEY;

  if (!apiKey) {
    console.log(`🌐 [FetchUrl] No Tavily key — fetching in-process: ${args.url}`);
    return selfFetch(args.url, fetcher);
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

    console.log(`🌐 [FetchUrl] Extracted ${result.raw_content.length} chars from ${result.url}`);
    return `## Page content: ${result.url}\n\n${capContent(result.raw_content)}`;
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
