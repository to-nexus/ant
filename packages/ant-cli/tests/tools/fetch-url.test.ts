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
import { executeFetchUrl, handleFetchUrl } from '../../src/agents/common/tool/handlers/fetchUrl';
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

describe('executeFetchUrl — graceful degradation', () => {
  it('returns a usable fallback string (never throws) when no API key is set', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const out = await executeFetchUrl({ url: 'https://example.com' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/not configured|proceed/i);
    // Must not throw — the caller keeps planning with available info.
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

  it('allows the call when under the limit (no key → graceful content, no error)', async () => {
    delete process.env.ANT_TAVILY_API_KEY;
    const res = await handleFetchUrl(
      ctx({ planFetchUrlCount: 0, planFetchUrlLimit: 5 }),
      { url: 'https://example.com' },
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
