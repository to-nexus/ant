import { Request } from 'express';
import { UserContext } from '../../../../../core/types/user';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../../../../core/config/WorkspacePathResolver';
import { INDIVIDUAL_ORG_ID, LOCAL_ORG_ID, deriveKindFromOrgId } from '@ant/shared';
import { logger } from '../../../../../utils/logger';

// Fires at most once: local-mode tenant inference is only safe when the
// workspace holds a single org/user. With multiple tenants the inference is
// ambiguous and requests silently fall back to the `local` tenant — a
// cross-tenant data-exposure footgun outside the single-developer assumption.
let warnedMultiTenant = false;
function warnAmbiguousLocalTenant(reason: string): void {
  if (warnedMultiTenant) return;
  warnedMultiTenant = true;
  logger.warn(
    `⚠️  Local-mode tenant inference is ambiguous (${reason}); falling back to the 'local' tenant — ` +
      'projects under any other org/user directory are invisible to this server. ' +
      'Set ANT_LOCAL_ORG + ANT_LOCAL_USER to pick a tenant explicitly, or JWT auth (cloud mode) for real multi-tenant isolation.',
    { component: 'userContext' },
  );
}

/**
 * Single sink for "is the BE running in local mode?". Re-exported from
 * `core/config/serverMode` — `core/` needs the same predicate (codebase-path
 * resolution) and must not import from `periphery/`, so the implementation
 * lives there and this stays the route-layer import site.
 */
import { isLocalServerMode } from '../../../../../core/config/serverMode';
export { isLocalServerMode };

let inferredLocalDefault: { organizationId: string; userId: string } | null | undefined;

/**
 * Authored local tenant. Without it the active tenant is a function of how many
 * directories happen to sit under the workspaces root, so adding or removing one
 * user folder silently repoints every project/feature/credential lookup.
 * Both halves are required — a half-declared tenant is a typo, not a default.
 */
export function declaredLocalTenant(): { organizationId: string; userId: string } | null {
  const organizationId = process.env.ANT_LOCAL_ORG?.trim();
  const userId = process.env.ANT_LOCAL_USER?.trim();
  if (!organizationId || !userId) return null;
  return { organizationId, userId };
}

/**
 * Test-only: clear the cached local-default-tenant inference so a test
 * can rerun the filesystem probe after seeding the workspace tree. Not
 * called by production code.
 */
export function __resetInferredLocalDefaultForTests(): void {
  inferredLocalDefault = undefined;
  warnedMultiTenant = false;
}

export function inferLocalDefaultTenant(): { organizationId: string; userId: string } | null {
  // Only infer in local server mode; in cloud mode the client must be explicit.
  if (!isLocalServerMode()) return null;

  // An authored tenant outranks the filesystem probe — and silences the warning,
  // since there is nothing ambiguous left to resolve.
  const declared = declaredLocalTenant();
  if (declared) return declared;

  if (inferredLocalDefault !== undefined) return inferredLocalDefault;

  try {
    const base = WorkspacePathResolver.getPhysicalWorkspacesPath();
    const orgs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(
        (name) =>
          name !== LOCAL_ORG_ID &&
          name !== INDIVIDUAL_ORG_ID &&
          name !== '.ide-homes' &&
          !name.startsWith('.'),
      );

    // If there is exactly one org folder, and exactly one user folder inside it,
    // use that as the implicit default tenant for local development.
    if (orgs.length === 1) {
      const org = orgs[0];
      const usersDir = path.join(base, org);
      const users = fs
        .readdirSync(usersDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((name) => !name.startsWith('.'));
      if (users.length === 1) {
        inferredLocalDefault = { organizationId: org, userId: users[0] };
        return inferredLocalDefault;
      }
      if (users.length > 1) warnAmbiguousLocalTenant(`${users.length} users under org '${org}'`);
    } else if (orgs.length > 1) {
      warnAmbiguousLocalTenant(`${orgs.length} org folders`);
    }
  } catch {
    // ignore
  }

  inferredLocalDefault = null;
  return null;
}

function inferTenantByProjectId(projectId: string): { organizationId: string; userId: string } | null {
  // Only infer in local server mode; cloud must be explicit.
  if (!isLocalServerMode()) return null;
  if (!projectId) return null;

  try {
    const base = WorkspacePathResolver.getPhysicalWorkspacesPath();
    const candidates: Array<{ organizationId: string; userId: string }> = [];

    const orgDirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => name !== '.ide-homes' && !name.startsWith('.'));

    // The `local` org is scanned like any other: its user directory is
    // LOCAL_USER_ID ('local'), so `local/local/<project>` is discoverable here.
    for (const org of orgDirs) {
      const usersDir = path.join(base, org);
      let users: string[] = [];
      try {
        users = fs
          .readdirSync(usersDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((name) => !name.startsWith('.'));
      } catch {
        continue;
      }

      for (const user of users) {
        const projectPath = path.join(base, org, user, projectId);
        if (fs.existsSync(projectPath)) {
          candidates.push({ organizationId: org, userId: user });
        }
      }
    }

    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      warnAmbiguousLocalTenant(`projectId '${projectId}' exists under ${candidates.length} tenants`);
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Extract UserContext from Express Request
 * 
 * Priority:
 * 1. JWT auth middleware (req.user, req.organization) — cloud mode primary source
 * 2. Local mode filesystem inference — local mode fallback
 * 
 * In cloud mode, user context MUST come from the verified JWT cookie.
 * Header/query parameter based identification is removed for security.
 */
export function extractUserContext(req: Request): UserContext {
  // Priority 1: JWT auth middleware (set by createJwtAuthMiddleware)
  if (req.user && req.organization) {
    return {
      userId: req.user.id,
      organizationId: req.organization.id,
      organizationKind: req.organization.kind ?? deriveKindFromOrgId(req.organization.id),
    };
  }

  // Cloud mode: JWT must be present — reject if not
  if (!isLocalServerMode()) {
    throw new Error('Authentication required: no valid JWT token');
  }

  // Local mode: authored tenant, else filesystem inference. Local server mode is
  // local-kind by definition regardless of which org folder it lands on.
  // The declaration outranks project-id inference too: once a developer names
  // their tenant, a same-named project under another org must not repoint them.
  const declared = declaredLocalTenant();
  const projectIdFromParams =
    (req.params as any)?.id ||
    (req.params as any)?.projectId ||
    (req.params as any)?.project ||
    undefined;
  const inferredByProject =
    declared || !projectIdFromParams ? null : inferTenantByProjectId(projectIdFromParams);
  const inferred = declared || inferredByProject || inferLocalDefaultTenant();
  return {
    userId: inferred?.userId || 'local',
    organizationId: inferred?.organizationId || 'local',
    organizationKind: 'local',
  };
}

/**
 * Check if request has authenticated user context
 */
export function hasUserContext(req: Request): boolean {
  return !!(req.user && req.organization);
}
