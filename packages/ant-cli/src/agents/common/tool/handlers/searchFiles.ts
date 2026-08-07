/**
 * search_files handler — ripgrep-backed search over a NON-canonical root.
 *
 * Same engine and result shape as `search_code`, but the root is whatever
 * `ctx.fileSystem` points at (universal `universal/artifacts/` tree) and the
 * `file_pattern` is passed to ripgrep verbatim — no `codebase/` normalization,
 * because the tree has no canonical layout to normalize against.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { runSearchTool } from './searchCode';

export async function handleSearchFiles(
  ctx: ToolExecutionContext,
  args: { pattern: string; file_pattern?: string; include_dependencies?: boolean },
): Promise<ToolResult> {
  return runSearchTool(ctx, args, 'search_files');
}
