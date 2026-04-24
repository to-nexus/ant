/**
 * GitHub REST helpers outside the git-world SSOT.
 *
 * This file intentionally carries only the clone-status polling helper used
 * by the Project Wizard to confirm a freshly-cloned working tree has
 * materialized before advancing to the next step. Every other GitHub /
 * Git REST call is now mediated by the `domain/git-world/` slice and its
 * private client (`domain/git-world/infrastructure/api.ts`).
 *
 * See `docs/architecture/24-git-operations.md §0` for the contract.
 */

import { API_BASE, apiGet } from './client';

/**
 * Polls the server for "clone has completed" confirmation. Some backend
 * builds still complete `POST /projects/:id/git/ops/clone` synchronously
 * while the working-tree materialization continues asynchronously; the
 * Wizard uses this to bridge that window before starting subsequent steps.
 */
export async function checkCloneStatus(
  projectId: string,
): Promise<{ cloned: boolean; error?: string }> {
  try {
    const result = await apiGet<{ cloned: boolean }>(
      `${API_BASE()}/projects/${encodeURIComponent(projectId)}/clone/status`,
    );
    return { cloned: result.cloned };
  } catch (error: any) {
    return { cloned: false, error: error.message || 'Network error' };
  }
}
