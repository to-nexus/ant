/**
 * fetch_url tool — capability that reads a SPECIFIC URL's page content
 * (Tavily /extract), distinct from search_web (Tavily /search, keyword).
 *
 * Added after the `ivory-hearing-flask` RCA: a plan job given a live URL to
 * "analyze this site" had no tool to fetch the page, so it fell back to
 * useless keyword search_web. These tests lock:
 *   - graceful no-key behavior (never throws; returns a usable string),
 *   - plan-phase call cap in the unified handler,
 *   - exposure to the planner (advertised) and the catalog (plan/code/design),
 *   - the search_web / fetch_url boundary is documented in descriptions.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { executeFetchUrl, handleFetchUrl, htmlToText, type PublicFetcher } from '../../src/agents/common/tool/handlers/fetchUrl';
import { EgressPolicyError } from '../../src/core/config/urlPolicy';
import { plannerObserveTools, plannerToolsForMode } from '../../src/agents/planner/graph/plan/nodes/tools';
import {
  ToolName,
  JOB_TOOL_MATRIX,
  JobType,
  TOOL_HANDLERS,
  TOOL_SETS,
} from '../../src/agents/common/tool/toolCatalog';
import { ARCHITECT_TOOLS } from '../../src/agents/common/tool/toolSchemas';
import type { ToolExecutionContext } from '../../src/agents/common/tool/types';

const origKey = process.env.ANT_TAVILY_API_KEY;
afterEach(() => {
  if (origKey === undefined) delete process.env.ANT_TAVILY_API_KEY;
  else process.env.ANT_TAVILY_API_KEY = origKey;
});

/** Stub fetcher: canned body/content-type, records the options the handler chose. */
function stubFetcher(body: string, contentType = 'text/html; charset=utf-8') {
  const calls: Array<Parameters<PublicFetcher>[1]> = [];
  const fetcher: PublicFetcher = async (url, opts) => {
    calls.push(opts);
    return { url, status: 200, contentType, body: Buffer.from(body), truncated: false };
  };
  return { fetcher, calls };
}

// Without a Tavily key the handler fetches in-process through
// `core/config/urlPolicy` — public addresses only, bounded, HTML → text.
// `search_web` keeps its "not configured" notice: a keyword search needs an engine.
describe('executeFetchUrl — self-fetcher fallback (no Tavily key)', () => {
  it('returns the page as text with scripts/styles dropped and the title kept', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const html = '<html><head><title>Release notes</title><style>p{}</style></head><body><script>evil()</script><h1>v2.0</h1><p>Faster &amp; smaller.</p></body></html>';
    const { fetcher, calls } = stubFetcher(html);
    const out = await executeFetchUrl({ url: 'https://example.com/notes' }, fetcher);
    expect(out).toMatch(/^## Page content: https:\/\/example\.com\/notes/);
    expect(out).toContain('# Release notes');
    expect(out).toContain('v2.0');
    expect(out).toContain('Faster & smaller.');
    expect(out).not.toMatch(/evil\(\)|p\{\}|<h1>/);
    // The bounds the fetcher is asked for: truncate (never refuse a long page),
    // few redirects, no ambient credentials — only the explicit UA/Accept.
    expect(calls[0].onOverflow).toBe('truncate');
    expect(calls[0].maxRedirects).toBeLessThanOrEqual(3);
    expect(Object.keys(calls[0].headers ?? {}).map(k => k.toLowerCase()).sort()).toEqual(['accept', 'user-agent']);
  });

  it('passes plain text / JSON through and caps the body', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const { fetcher } = stubFetcher('x'.repeat(20_000), 'text/plain');
    const out = await executeFetchUrl({ url: 'https://example.com/big.txt' }, fetcher);
    expect(out).toContain('[content truncated]');
    expect(out.length).toBeLessThan(9_000);
  });

  it('a policy refusal is reported as such (never thrown) and points at http_request for local servers', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const refusing: PublicFetcher = async () => { throw new EgressPolicyError('Blocked internal address for host: 169.254.169.254'); };
    const out = await executeFetchUrl({ url: 'http://169.254.169.254/latest/meta-data/' }, refusing);
    expect(out).toMatch(/refused/i);
    expect(out).toMatch(/169\.254\.169\.254/);
    expect(out).toMatch(/http_request/);
  });

  it('refuses a private-range URL for real (literal host — no DNS, no socket)', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const out = await executeFetchUrl({ url: 'http://10.0.0.5/admin' });
    expect(out).toMatch(/refused/i);
    expect(out).toMatch(/internal address/i);
  });

  it('a network failure degrades to a usable string', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const failing: PublicFetcher = async () => { throw new Error('HTTP 503'); };
    const out = await executeFetchUrl({ url: 'https://example.com' }, failing);
    expect(out).toMatch(/failed/i);
    expect(out).toMatch(/HTTP 503/);
    expect(out).toMatch(/search_web/);
  });

  it('a binary content type is named, not inlined', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const { fetcher } = stubFetcher('\x89PNG', 'image/png');
    const out = await executeFetchUrl({ url: 'https://example.com/a.png' }, fetcher);
    expect(out).toMatch(/image\/png/);
    expect(out).toMatch(/not a text page/);
  });
});

describe('htmlToText', () => {
  it('turns block boundaries into newlines and decodes entities', () => {
    expect(htmlToText('<p>a&nbsp;b</p><div>c &lt;d&gt;</div>e&#39;s &#x41;<br>')).toBe('a b\nc <d>\ne\'s A');
  });
});

describe('handleFetchUrl — plan-phase cap (mirrors search_web)', () => {
  const ctx = (over: Partial<ToolExecutionContext>): ToolExecutionContext =>
    ({ activePhase: 'plan', ...over } as unknown as ToolExecutionContext);

  it('rejects once planFetchUrlCount reaches the limit', async () => {
    const res = await handleFetchUrl(
      ctx({ planFetchUrlCount: 5, planFetchUrlLimit: 5 }),
      { url: 'https://example.com' },
    );
    expect(res.error).toBe('plan_fetch_url_limit');
    expect(res.content).toMatch(/SKIPPED/);
  });

  it('allows the call when under the limit (no key → policy-refused literal host, still no tool error)', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const res = await handleFetchUrl(
      ctx({ planFetchUrlCount: 0, planFetchUrlLimit: 5 }),
      { url: 'http://127.0.0.1:1/' },
    );
    expect(res.error).toBeUndefined();
    expect(typeof res.content).toBe('string');
  });
});

describe('fetch_url exposure matrix — mirrors search_web where it lives', () => {
  it('is advertised to the planner (observe set and every mode set)', () => {
    expect(plannerObserveTools().map(t => t.name)).toContain('fetch_url');
    expect(plannerToolsForMode('refactor').map(t => t.name)).toContain('fetch_url');
    // sibling: search_web stays too.
    expect(plannerObserveTools().map(t => t.name)).toContain('search_web');
  });

  it('is registered with a handler and present in CODE/DESIGN/PLAN matrices', () => {
    expect(TOOL_HANDLERS.has(ToolName.FETCH_URL)).toBe(true);
    for (const job of [JobType.CODE, JobType.DESIGN, JobType.PLAN]) {
      expect(JOB_TOOL_MATRIX[job]).toContain(ToolName.FETCH_URL);
    }
  });

  it('lives in exactly the TOOL_SETS where search_web lives (info-gathering surfaces)', () => {
    const webSets = ['planExplore', 'codeExplain', 'designPlanExplore', 'designPlanFigma', 'designExplain', 'design', 'specFigma'] as const;
    for (const s of webSets) {
      expect(TOOL_SETS[s], `${s} should carry search_web`).toContain(ToolName.SEARCH_WEB);
      expect(TOOL_SETS[s], `${s} should carry fetch_url`).toContain(ToolName.FETCH_URL);
    }
    // Execute-write sets deliberately omit both (mirror).
    for (const s of ['codeBasic', 'uiDesign', 'uiDesignBase'] as const) {
      expect(TOOL_SETS[s]).not.toContain(ToolName.SEARCH_WEB);
      expect(TOOL_SETS[s]).not.toContain(ToolName.FETCH_URL);
    }
  });

  it('has a catalog schema whose description separates it from search_web', () => {
    const fetchDef = (ARCHITECT_TOOLS as any).fetch_url;
    expect(fetchDef).toBeTruthy();
    expect(fetchDef.input_schema.required).toContain('url');
    expect(fetchDef.description).toMatch(/search_web/);
    expect((ARCHITECT_TOOLS as any).search_web.description).toMatch(/fetch_url/);
  });
});
