/**
 * Resolve a reference target `{ project, branch }` to a concrete on-disk root
 * (dir-mode) or a git tree-ish accessor (git-mode). Tenant-scoped: `project`
 * must exist in the caller's own workspace.
 *
 * Branch == feature name (no prefix). Resolution order:
 *   1. no branch → the project's branchBase feature worktree if on disk
 *      ({proj}/features/{branchBase}/codebase)                      → dir-mode
 *      (falls to git-mode against the bare anchor when not materialized)
 *   2. branch names an on-disk ant feature worktree                 → dir-mode
 *      ({proj}/features/{name}/codebase)
 *   3. otherwise (a branch not materialized on disk)                → git-mode
 *      (read via git show / ls-tree / grep against {proj}/repo.git)
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

export async function resolveReferenceCodebase(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  target: { project: string; branch?: string },
  currentProject?: string,
): Promise<ReferenceResolution> {
  const { project } = target;
  const branch = target.branch?.trim() || undefined;

  // References are for OTHER projects only. The current project's code — every
  // branch — is the job's own codebase channel; reading it through the
  // git/worktree-backed reference resolver returns a divergent (often empty)
  // committed view, which is what sent the `north-gaining-globe` job
  // branch-hunting. The project name is discoverable from user input (e.g. a
  // preview URL slug), so the catalog exclusion alone cannot prevent this —
  // this guard is the load-bearing gate.
  if (currentProject && project === currentProject) {
    throw new ReferenceTargetError(
      `"${project}" is your current project — do not register it as a reference. ` +
        `Your own code (every branch) is available through the codebase channel: ` +
        `use search_code / read_file on codebase/…. References are for OTHER projects only.`,
    );
  }

  const projects = await listTenantProjects(workspaceResolver, userContext);
  if (!projects.includes(project)) {
    const available = projects.length ? projects.join(', ') : '(none)';
    throw new ReferenceTargetError(
      `Reference project "${project}" is not in your workspace. Available projects: ${available}`,
    );
  }

  const projectPath = workspaceResolver.getProjectPath(userContext, project);
  const branchBase = readBranchBase(projectPath);
  const anchorPath = workspaceResolver.getGitAnchorPath(userContext, project);

  // Branch == feature name. `branch` omitted resolves to the project's
  // branchBase feature.
  const effectiveBranch = branch ?? branchBase;

  // (1)+(2) on-disk feature worktree
  const featureCodebase = workspaceResolver.getCodebasePath(userContext, project, effectiveBranch);
  if (fs.existsSync(featureCodebase)) {
    return { mode: 'dir', absPath: featureCodebase, project, branch };
  }

  // (3) git-mode — branch exists only in the bare anchor, not as a worktree
  return { mode: 'git', gitDir: anchorPath, ref: effectiveBranch, project, branch };
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
