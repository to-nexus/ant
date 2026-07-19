/**
 * Reference-codebase catalog — sibling ANT projects the current job may register
 * and read (cross-project code exploration). Tenant-scoped by construction: every
 * path is resolved through `workspaceResolver` with the job's own `userContext`,
 * so a job can only ever enumerate its own org/user workspace.
 *
 * Kept in the common tool layer (no HTTP-service dependency) — it replicates the
 * minimal directory-listing logic of ProjectCrudService / FeatureCrudService
 * rather than importing them, so tool handlers stay decoupled from periphery/http.
 */

import * as fs from 'fs';
import * as path from 'path';
import { featureSlugToName } from '@ant/shared';
import type { WorkspaceResolver } from '../../../../core/config/WorkspacePathResolver';
import type { UserContext } from '../../../../core/types/user';

export interface ReferenceCatalogEntry {
  project: string;
  /** Git refs offered for this project — feature names (branch == feature name). */
  branches: string[];
  /**
   * Feature this project is linked to via the current project's
   * `@connection … ant-project:{project}:{feature}` annotation, when present.
   * The authoritative "which branch to read" answer — surfaced as recommended.
   */
  connectedFeature?: string;
}

/** Render a catalog as a compact markdown list for prompt injection. */
export function formatReferenceCatalog(entries: ReferenceCatalogEntry[]): string {
  if (!entries.length) return '';
  return entries
    .map((e) => {
      const branches = e.branches.length ? ` (branches: ${e.branches.join(', ')})` : '';
      if (e.connectedFeature) {
        return `- ${e.project} — linked at feature "${e.connectedFeature}" (use branch ${e.connectedFeature})${branches}`;
      }
      return `- ${e.project}${branches}`;
    })
    .join('\n');
}

/** Read `branchBase` from a project's config.json (default `main`). */
export function readBranchBase(projectPath: string): string {
  try {
    const configPath = path.join(projectPath, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config?.branchBase) return config.branchBase;
    }
  } catch {
    // fall through to default
  }
  return 'main';
}

/** All project ids in the current tenant workspace (dirs, excludes hidden). */
export async function listTenantProjects(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
): Promise<string[]> {
  const workspacePath = workspaceResolver.getWorkspacePath(userContext);
  try {
    await fs.promises.access(workspacePath);
  } catch {
    return [];
  }
  const entries = await fs.promises.readdir(workspacePath);
  const dirs = await Promise.all(
    entries
      .filter((p) => !p.startsWith('.'))
      .map(async (p) => {
        try {
          const stat = await fs.promises.stat(path.join(workspacePath, p));
          return stat.isDirectory() ? p : null;
        } catch {
          return null;
        }
      }),
  );
  return dirs.filter(Boolean) as string[];
}

/** Ant feature names of a project (every dir under features/ is a feature). */
export async function listProjectFeatures(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  projectId: string,
): Promise<string[]> {
  const projectPath = workspaceResolver.getProjectPath(userContext, projectId);
  const featuresPath = path.join(projectPath, 'features');
  try {
    await fs.promises.access(featuresPath);
  } catch {
    return [];
  }
  const items = await fs.promises.readdir(featuresPath);
  const features = await Promise.all(
    items
      .filter((item) => !item.startsWith('.'))
      .map(async (item) => {
        try {
          const stat = await fs.promises.stat(path.join(featuresPath, item));
          // `item` is the on-disk slug; the catalog lists raw feature names.
          return stat.isDirectory() ? featureSlugToName(item) : null;
        } catch {
          return null;
        }
      }),
  );
  return features.filter(Boolean) as string[];
}

/**
 * Build the reference catalog for the tenant, excluding the current project.
 * Each entry lists the project's feature names verbatim (branch == feature
 * name; the base branch IS one of the features).
 */
export async function buildReferenceCatalog(
  workspaceResolver: WorkspaceResolver,
  userContext: UserContext,
  opts: { excludeProject?: string; connectionBranches?: Map<string, string> } = {},
): Promise<ReferenceCatalogEntry[]> {
  const projects = await listTenantProjects(workspaceResolver, userContext);
  const catalog: ReferenceCatalogEntry[] = [];
  for (const project of projects) {
    if (opts.excludeProject && project === opts.excludeProject) continue;
    const features = await listProjectFeatures(workspaceResolver, userContext, project);
    catalog.push({
      project,
      branches: features,
      connectedFeature: opts.connectionBranches?.get(project),
    });
  }
  return catalog;
}
