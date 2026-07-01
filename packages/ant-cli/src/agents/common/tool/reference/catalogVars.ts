/**
 * Template-var provider for the reference-codebase partials. Computes the
 * sibling-project catalog from a graph state (any job) and returns the two vars
 * the register/usage partials gate on. Non-fatal: returns empty on any failure.
 */

import { buildReferenceCatalog, formatReferenceCatalog } from './catalog';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';

interface CatalogStateLike {
  deps?: { workspaceResolver?: unknown };
  context?: { userId?: string; organizationId?: string; projectName?: string };
}

export interface ReferenceCatalogVars {
  referenceCatalog: string;
  hasReferenceCatalog: boolean;
}

export async function referenceCatalogVars(state: CatalogStateLike): Promise<ReferenceCatalogVars> {
  const workspaceResolver = state.deps?.workspaceResolver as WorkspaceResolver | undefined;
  if (!workspaceResolver) return { referenceCatalog: '', hasReferenceCatalog: false };
  try {
    const catalog = await buildReferenceCatalog(
      workspaceResolver,
      {
        userId: state.context?.userId || 'local',
        organizationId: state.context?.organizationId || 'local',
      },
      { excludeProject: state.context?.projectName },
    );
    const referenceCatalog = formatReferenceCatalog(catalog);
    return { referenceCatalog, hasReferenceCatalog: referenceCatalog.length > 0 };
  } catch {
    return { referenceCatalog: '', hasReferenceCatalog: false };
  }
}
