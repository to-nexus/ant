/**
 * Template-var provider for the reference-codebase partials. Computes the
 * sibling-project catalog from a graph state (any job) and returns the two vars
 * the register/usage partials gate on. Non-fatal: returns empty on any failure.
 */

import { buildReferenceCatalog, formatReferenceCatalog } from './catalog';
import { currentProjectOf } from './currentProject';
import { buildConnectionBranchMap } from './connectionBranches';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';

interface CatalogStateLike {
  deps?: { workspaceResolver?: unknown };
  context?: {
    userId?: string;
    organizationId?: string;
    project?: string;
    featureFolder?: string;
  };
}

export interface ReferenceCatalogVars {
  referenceCatalog: string;
  hasReferenceCatalog: boolean;
}

export async function referenceCatalogVars(state: CatalogStateLike): Promise<ReferenceCatalogVars> {
  const workspaceResolver = state.deps?.workspaceResolver as WorkspaceResolver | undefined;
  if (!workspaceResolver) return { referenceCatalog: '', hasReferenceCatalog: false };
  try {
    const userContext = {
      userId: state.context?.userId || 'local',
      organizationId: state.context?.organizationId || 'local',
    };
    const currentProject = currentProjectOf(state);

    // Connection-linked feature per sibling — the authoritative "which branch"
    // hint, scanned from the current codebase's `@connection` annotations.
    let connectionBranches: Map<string, string> | undefined;
    if (currentProject) {
      const codebaseRoot = workspaceResolver.getCodebasePath(
        userContext,
        currentProject,
        state.context?.featureFolder,
      );
      connectionBranches = await buildConnectionBranchMap(codebaseRoot);
    }

    const catalog = await buildReferenceCatalog(workspaceResolver, userContext, {
      excludeProject: currentProject,
      connectionBranches,
    });
    const referenceCatalog = formatReferenceCatalog(catalog);
    return { referenceCatalog, hasReferenceCatalog: referenceCatalog.length > 0 };
  } catch {
    return { referenceCatalog: '', hasReferenceCatalog: false };
  }
}
