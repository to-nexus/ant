/**
 * register_reference handler — the LLM's runtime request form for cross-project
 * code exploration. Validates the target is a sibling project in the caller's
 * own tenant, resolves the branch (dir-mode worktree vs git-mode branch), and
 * emits a `referenceRegistered` side-effect so the tool node adds it to
 * `state.referenceRequests`. After this, read/list/search_reference_code may
 * operate on the project. Read-only: never mutates the reference repo.
 */

import type { ToolExecutionContext, ToolResult } from '../types';
import { getRefDeps } from '../reference/handlerSupport';
import { resolveReferenceCodebase, listRootEntries, ReferenceTargetError } from '../reference/resolve';
import { buildConnectionBranchMap } from '../reference/connectionBranches';

export async function handleRegisterReference(
  ctx: ToolExecutionContext,
  args: { project: string; branch?: string },
): Promise<ToolResult> {
  const { project } = args;
  let { branch } = args;
  if (!project) {
    return { content: 'register_reference requires "project"', error: 'register_reference requires "project"' };
  }

  const deps = getRefDeps(ctx);
  if ('error' in deps) {
    return { content: deps.error, error: deps.error };
  }

  // Default an omitted branch to the connection-linked feature (the authoritative
  // "which branch" answer from the current project's `@connection` annotations),
  // instead of falling through to `main`.
  if (!branch && ctx.project) {
    try {
      const codebaseRoot = deps.workspaceResolver.getCodebasePath(
        deps.userContext,
        ctx.project,
        ctx.featureFolder,
      );
      const connected = (await buildConnectionBranchMap(codebaseRoot)).get(project);
      if (connected) branch = `feature/${connected}`;
    } catch {
      // no connection hint — resolver defaults to main
    }
  }

  try {
    const resolution = await resolveReferenceCodebase(
      deps.workspaceResolver,
      deps.userContext,
      { project, branch },
      ctx.project,
    );

    let bootstrap = '';
    if (resolution.mode === 'dir') {
      const entries = await listRootEntries(resolution.absPath);
      bootstrap = entries.length
        ? `\n\nTop-level entries:\n${entries.join('\n')}`
        : '';
    }

    const branchLabel = branch ? `\`${branch}\`` : 'default branch';
    const modeNote =
      resolution.mode === 'git'
        ? ' (branch read via git — not checked out on disk)'
        : '';

    return {
      content:
        `✅ Registered reference project "${project}" @ ${branchLabel}${modeNote}. ` +
        `Now use list_reference_files / read_reference_file / search_reference_code with project="${project}".` +
        bootstrap,
      sideEffects: [{ type: 'referenceRegistered', project, branch: resolution.branch }],
    };
  } catch (e) {
    const msg = e instanceof ReferenceTargetError ? e.message : (e as Error).message;
    return { content: `❌ ${msg}`, error: msg };
  }
}
