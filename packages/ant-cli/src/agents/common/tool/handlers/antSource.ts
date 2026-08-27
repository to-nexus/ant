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
  antSourceToCodebasePath,
  type AntSource,
} from '../antSource/core';

function adapt(r: { success: boolean; content?: string; error?: string }): ToolResult {
  return {
    content: r.success ? (r.content || 'No content returned') : `Error: ${r.error}`,
    error: r.success ? undefined : r.error,
  };
}

export async function handleReadAntSource(
  ctx: ToolExecutionContext,
  args: Record<string, any>,
): Promise<ToolResult> {
  // Workspace-copy priority: when the job's codebase IS a clone of the Ant
  // monorepo (self-development), the clone is the SSOT the job reads AND
  // edits — the in-image copy may be a different version, and citations in
  // its namespace poison later phases (narrow-ending-flour). Redirect only
  // where read_file is actually dispatchable (ask jobs keep in-image reads).
  const source: AntSource = (args?.source as AntSource) || 'cli';
  if (args?.path && ctx.availableToolNames?.has('read_file')) {
    try {
      const codebasePath = antSourceToCodebasePath(source, args.path);
      if (await ctx.fileSystem.fileExists(codebasePath)) {
        const msg =
          `This file is present in YOUR workspace codebase: ${codebasePath}. ` +
          `Your job operates on the workspace copy — read it with read_file("${codebasePath}") ` +
          `(supports startLine/endLine) and cite that path. ` +
          `read_ant_source serves the RUNNING platform's in-image copy, which may be a DIFFERENT version from the code you are editing.`;
        return { content: msg, error: msg };
      }
    } catch {
      // Probe failure (reparented/absent tree) → normal in-image read.
    }
  }
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
