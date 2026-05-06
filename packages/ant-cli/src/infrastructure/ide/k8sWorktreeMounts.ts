/**
 * K8s worktree mount resolution
 *
 * SSOT for the IDE pod's git worktree-aware mounts. Mirrors the Docker side's
 * [`GitHelper.resolveWorktreeBindMounts`](../../periphery/adapters/http/services/GitService/helper/GitHelper.ts)
 * 1:1 — when the workspace path is a git worktree (i.e. `.git` is a file
 * containing `gitdir: <abs path>`), the IDE pod must additionally mount the
 * main repo's `.git` directory AND the worktree path itself at their host
 * absolute paths so the back-reference between worktree marker and main repo
 * resolves inside the pod.
 *
 * Topology contract — keep aligned with [`KubernetesIDEOrchestrator.createPodSpec`](./KubernetesIDEOrchestrator.ts):
 * - The PRIMARY workspace mount keeps the alias mountPath `/workspace` (mirrors
 *   Docker's `dockerWorkspacePath = /{projectId}` alias). This guarantees the
 *   absolute-path mounts returned here NEVER collide with the primary mount,
 *   so K8s doesn't reject the spec with `Invalid value: ... mountPath: must be unique`.
 * - This helper returns ONLY the absolute-path entries (mainGitDir, worktreePath).
 * - For the base branch (`.git` is a directory) the returned array is empty.
 *
 * Implementation note: `.git` parsing + mainGitDir derivation is delegated to
 * the SSOT [`GitHelper.resolveWorktreeAbsPaths`](../../periphery/adapters/http/services/GitService/helper/GitHelper.ts) —
 * shared with the Docker side. This file owns ONLY the K8s mount format
 * (`{name, mountPath, subPath}`) and the workspaceBasePath strict prefix
 * validation.
 *
 * Risk closed: silent broken pod when `WORKSPACE_BASE_PATH` is wrong. The
 * helper throws if a returned mountPath does not start with the configured
 * base path, surfacing the misconfiguration at startup instead of presenting
 * an empty `/workspace` to the user.
 */

import { GitHelper } from '../../periphery/adapters/http/services/GitService/helper/GitHelper';
import { logger } from '../../utils/logger';

export interface K8sWorktreeMount {
  /** PVC volume name (matches the `volumes[].name` entry in pod spec) */
  name: string;
  /** Absolute mountPath inside the container (host path verbatim) */
  mountPath: string;
  /** Path relative to PVC root — derived from mountPath by stripping `workspaceBasePath` */
  subPath: string;
}

/**
 * Strip the configured base path prefix off an absolute path to produce a
 * PVC-relative subPath. Throws if the path does not live under the base —
 * silent broken pod prevention (see Risk in `K8s worktree mount fix` plan).
 */
function stripBase(absPath: string, workspaceBasePath: string): string {
  if (!absPath.startsWith(workspaceBasePath)) {
    throw new Error(
      `K8s mount: path '${absPath}' is outside ANT_WORKSPACE_BASE_PATH '${workspaceBasePath}'. ` +
        `Cannot derive PVC subPath. Check ANT_WORKSPACE_BASE_PATH on both API server and IDE pod.`,
    );
  }
  return absPath.slice(workspaceBasePath.length).replace(/^\/+/, '');
}

/**
 * Resolve the additional pod volumeMounts required for git worktree support.
 *
 * @param workspacePath        Absolute host path to the IDE workspace (the codebase dir)
 * @param workspaceBasePath    Absolute host path of the EFS/PVC mount root (`ANT_WORKSPACE_BASE_PATH`)
 * @param pvcVolumeName        Volume name in the pod spec (defaults to 'workspace')
 * @returns                    Zero entries for base branch (`.git` is dir) or
 *                             corrupt worktree marker; otherwise the absolute-path
 *                             mounts the pod needs in addition to the primary alias mount.
 */
export function resolveK8sWorktreeMounts(
  workspacePath: string,
  workspaceBasePath: string,
  pvcVolumeName: string = 'workspace',
): K8sWorktreeMount[] {
  const abs = GitHelper.resolveWorktreeAbsPaths(workspacePath);
  if (!abs) return [];

  const mounts: K8sWorktreeMount[] = [
    {
      name: pvcVolumeName,
      mountPath: abs.mainGitDir,
      subPath: stripBase(abs.mainGitDir, workspaceBasePath),
    },
  ];

  // Defensive dedup: in the (theoretically impossible) degenerate case where
  // workspacePath and mainGitDir collide, skip the worktree-self mount.
  // Otherwise add the worktree's own path so the
  // `.git/worktrees/{branch}/gitdir` back-reference resolves inside the pod.
  if (abs.worktreePath !== abs.mainGitDir) {
    mounts.push({
      name: pvcVolumeName,
      mountPath: abs.worktreePath,
      subPath: stripBase(abs.worktreePath, workspaceBasePath),
    });
  }

  logger.info(`[k8sWorktreeMounts] Resolved worktree mounts`, { component: 'k8sWorktreeMounts' }, {
    workspacePath: abs.worktreePath,
    mainGitDir: abs.mainGitDir,
    mountCount: mounts.length,
  });

  return mounts;
}
