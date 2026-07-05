/**
 * ant-source handlers — read/list/search Ant's OWN in-image source.
 *
 * ctx-independent (source root resolves via WorkspacePathResolver, not graph
 * state) → registered in TOOL_HANDLERS so the code/design registries pick them
 * up automatically. Lets code/design/error tasks inspect the running platform
 * source (proxy/spawner/build) and framework behavior when a symptom cannot be
 * explained from the app alone. Diagnosis only — never a source for coupling
 * generated app code to ANT internals.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import {
  readAntSource as coreReadAntSource,
  listAntFiles as coreListAntFiles,
  searchAntCode as coreSearchAntCode,
  type AntSource,
} from '../antSource/core';

function adapt(r: { success: boolean; content?: string; error?: string }): ToolResult {
  return {
    content: r.success ? (r.content || 'No content returned') : `Error: ${r.error}`,
    error: r.success ? undefined : r.error,
  };
}

export async function handleReadAntSource(
  _ctx: ToolExecutionContext,
  args: Record<string, any>,
): Promise<ToolResult> {
  return adapt(await coreReadAntSource(args as { path: string; source?: AntSource }));
}

export async function handleListAntFiles(
  _ctx: ToolExecutionContext,
  args: Record<string, any>,
): Promise<ToolResult> {
  return adapt(await coreListAntFiles(args as { path: string; source?: AntSource }));
}

export async function handleSearchAntCode(
  _ctx: ToolExecutionContext,
  args: Record<string, any>,
): Promise<ToolResult> {
  return adapt(await coreSearchAntCode(args as { query: string; source?: AntSource; filePattern?: string }));
}
