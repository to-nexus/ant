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
    `⚠️  Local-mode tenant inference is ambiguous (${reason}); falling back to the 'local' tenant. ` +
      'Local server mode assumes a single developer — set JWT auth (cloud mode) for multi-tenant isolation.',
    { component: 'userContext' },
  );
}

/**
 * Single sink for "is the BE running in local mode?". Reading
 * `process.env.ANT_SERVER_MODE` directly is allowed at startup wiring,
 * but routes / services that branch on mode should go through here so
 * the gate semantics ("anything other than 'cloud' is local") stays in
 * one place.
 */
export function isLocalServerMode(): boolean {
  return (process.env.ANT_SERVER_MODE || 'local') !== 'cloud';
}

let inferredLocalDefault: { organizationId: string; userId: string } | null | undefined;

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

    for (const org of orgDirs) {
      // Local legacy workspace shape: <base>/local/user/<project>
      if (org === 'local') {
        const localProject = path.join(base, 'local', 'user', projectId);
        if (fs.existsSync(localProject)) {
          candidates.push({ organizationId: 'local', userId: 'user' });
        }
        continue;
      }

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

  // Local mode: filesystem inference fallback. Local server mode is local-kind
  // by definition regardless of which org folder the inference lands on.
  const projectIdFromParams =
    (req.params as any)?.id ||
    (req.params as any)?.projectId ||
    (req.params as any)?.project ||
    undefined;
  const inferredByProject = projectIdFromParams ? inferTenantByProjectId(projectIdFromParams) : null;
  const inferred = inferredByProject || inferLocalDefaultTenant();
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
