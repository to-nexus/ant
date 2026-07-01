/**
 * Resolve a reference target `{ project, branch }` to a concrete on-disk root
 * (dir-mode) or a git tree-ish accessor (git-mode). Tenant-scoped: `project`
 * must exist in the caller's own workspace.
 *
 * Resolution order:
 *   1. no branch / branch == branchBase / 'main' / 'master' → sibling main
 *      codebase dir  ({proj}/codebase)                              → dir-mode
 *   2. branch names an on-disk ant feature worktree                 → dir-mode
 *      ('feature/{name}' or bare '{name}')  ({proj}/features/{name}/codebase)
 *   3. otherwise (a branch not materialized on disk)                → git-mode
 *      (read via git show / ls-tree / grep against {proj}/codebase/.git)
 */

import * as fs from 'fs';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../core/types/user';
import { listTenantProjects, readBranchBase } from './catalog';

export type ReferenceResolution =
  | { mode: 'dir'; absPath: string; project: string; branch?: string }
  | { mode: 'git'; gitDir: string; ref: string; project: string; branch?: string };

export class ReferenceTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceTargetError';
  }
}

const MAIN_ALIASES = new Set(['main', 'master']);

export async function resolveReferenceCodebase(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  target: { project: string; branch?: string },
): Promise<ReferenceResolution> {
  const { project } = target;
  const branch = target.branch?.trim() || undefined;

  const projects = await listTenantProjects(workspaceResolver, userContext);
  if (!projects.includes(project)) {
    const available = projects.length ? projects.join(', ') : '(none)';
    throw new ReferenceTargetError(
      `Reference project "${project}" is not in your workspace. Available projects: ${available}`,
    );
  }

  const projectPath = workspaceResolver.getProjectPath(userContext, project);
  const branchBase = readBranchBase(projectPath);
  const mainCodebase = workspaceResolver.getCodebasePath(userContext, project);

  // (1) main codebase
  if (!branch || branch === branchBase || MAIN_ALIASES.has(branch)) {
    return { mode: 'dir', absPath: mainCodebase, project, branch: undefined };
  }

  // (2) on-disk feature worktree
  const featureName = branch.startsWith('feature/') ? branch.slice('feature/'.length) : branch;
  const featureCodebase = workspaceResolver.getCodebasePath(userContext, project, featureName);
  if (featureCodebase !== mainCodebase && fs.existsSync(featureCodebase)) {
    return { mode: 'dir', absPath: featureCodebase, project, branch };
  }

  // (3) git-mode — branch exists only in git, not as a worktree
  return { mode: 'git', gitDir: mainCodebase, ref: branch, project, branch };
}

/** Directory-tree bootstrap listing (top-level entries) for a resolved dir root. */
export async function listRootEntries(absPath: string, limit = 60): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .slice(0, limit)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}
