/**
 * list_reference_files handler — list a directory in a registered reference
 * project. Read-only. dir-mode uses a scoped FileSystemAdapter; git-mode uses
 * `git ls-tree` against the branch's tree.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { AdapterFactory } from '../../../../infrastructure/adapters/AdapterFactory';
import { getRefDeps, isRegistered, notRegisteredError } from '../reference/handlerSupport';
import { resolveReferenceCodebase, ReferenceTargetError } from '../reference/resolve';
import { refGitList } from '../reference/refGit';

export async function handleListReferenceFiles(
  ctx: ToolExecutionContext,
  args: { project: string; directory?: string; branch?: string; pattern?: string },
): Promise<ToolResult> {
  const { project, directory = '.', branch, pattern } = args;
  if (!project) {
    const msg = 'list_reference_files requires "project"';
    return { content: msg, error: msg };
  }
  if (!isRegistered(ctx, project)) {
    const msg = notRegisteredError(project, ctx);
    return { content: msg, error: msg };
  }

  const deps = getRefDeps(ctx);
  if ('error' in deps) return { content: deps.error, error: deps.error };

  try {
    const resolution = await resolveReferenceCodebase(
      deps.workspaceResolver,
      deps.userContext,
      { project, branch },
      ctx.project,
    );

    let items: string[];
    if (resolution.mode === 'git') {
      const dir = directory === '.' ? '' : directory;
      items = await refGitList(resolution.gitDir, resolution.ref, dir);
    } else {
      const adapter = AdapterFactory.createFileSystemAdapterWithPath(resolution.absPath);
      const entries = await adapter.readDirectory(directory);
      items = entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
    }

    const filtered = pattern ? items.filter((f) => f.includes(pattern)) : items;
    if (filtered.length === 0) {
      return { content: `No entries in "${project}" ${directory}${pattern ? ` matching "${pattern}"` : ''}.` };
    }
    return { content: `[${project}] ${directory}\n${filtered.join('\n')}` };
  } catch (e) {
    const msg = e instanceof ReferenceTargetError ? e.message : (e as Error).message;
    console.error(`[listReferenceFiles] ❌ ${msg}`);
    return { content: `Error: ${msg}`, error: msg };
  }
}
