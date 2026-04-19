/**
 * search_web handler — Tavily API web search
 *
 * Canonical implementation used by all agents (code, design, plan).
 * Requires ANT_TAVILY_API_KEY environment variable.
 */

import type { ToolExecutionContext, ToolResult } from '../types';

/**
 * Low-level web search execution via Tavily API.
 * Returns a formatted string. Usable without ToolExecutionContext.
 */
export async function executeSearchWeb(args: { query: string }): Promise<string> {
  const apiKey = process.env.ANT_TAVILY_API_KEY;

  if (!apiKey) {
    console.log(`🔍 [WebSearch] No API key configured, using graceful fallback`);
    return `Web search is not configured (ANT_TAVILY_API_KEY not set). Please proceed with your existing knowledge about: "${args.query}"`;
  }

  console.log(`🔍 [WebSearch] Searching: ${args.query}`);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🔍 [WebSearch] API error (${response.status}): ${errorText}`);
      return `Web search failed (HTTP ${response.status}). Please proceed with available information about: "${args.query}"`;
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{ title: string; url: string; content: string }>;
    };

    const sections: string[] = [];

    if (data.answer) {
      sections.push(`## Summary\n${data.answer}`);
    }

    if (data.results && data.results.length > 0) {
      sections.push('## Sources');
      for (const result of data.results) {
        const snippet = result.content.length > 500
          ? result.content.substring(0, 500) + '...'
          : result.content;
        sections.push(`### ${result.title}\n${result.url}\n${snippet}`);
      }
    }

    const output = sections.join('\n\n');
    console.log(`🔍 [WebSearch] Found ${data.results?.length || 0} results`);
    return output || 'No relevant results found.';
  } catch (error: any) {
    console.error(`🔍 [WebSearch] Error: ${error.message}`);
    return `Web search encountered an error: ${error.message}. Please proceed with available information about: "${args.query}"`;
  }
}

/**
 * ToolHandler-compatible wrapper for the unified tool system.
 *
 * Phase 3-15 — in plan phase, reject further `search_web` calls after
 * `planSearchWebLimit` (default 3) have already been executed in this
 * plan-toolLoop session. Prevents the LLM from burning rounds on
 * near-duplicate queries when the information is not going to surface
 * new actionable signal.
 */
export async function handleSearchWeb(
  ctx: ToolExecutionContext,
  args: { query: string },
): Promise<ToolResult> {
  if (ctx.activePhase === 'plan') {
    const limit = ctx.planSearchWebLimit ?? 3;
    const used = ctx.planSearchWebCount ?? 0;
    if (used >= limit) {
      const message = `search_web rejected: plan-phase limit of ${limit} call(s) reached in this task (already used ${used}). Produce the <plan> from the evidence already gathered; do NOT retry the same query with a different phrasing.`;
      console.warn(`🔍 [WebSearch] ${message}`);
      return { content: `SKIPPED: ${message}`, error: 'plan_search_web_limit' };
    }
  }

  try {
    const result = await executeSearchWeb(args);
    return { content: result };
  } catch (e) {
    const errorMsg = (e as Error).message;
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
