/**
 * search_web handler — context-injected wrapper around executeSearchWeb
 */

import type { ToolExecutionContext, ToolResult } from '../types';

export async function handleSearchWeb(
  _ctx: ToolExecutionContext,
  args: { query: string },
): Promise<ToolResult> {
  const { executeSearchWeb } = await import('../../../architect/tools/searchWeb');

  try {
    const result = await executeSearchWeb(args);
    return { content: result };
  } catch (e) {
    const errorMsg = (e as Error).message;
    return { content: `Error: ${errorMsg}`, error: errorMsg };
  }
}
