import { Request } from 'express';
import { UserContext } from '../../../../../core/types/user';
import * as fs from 'fs';
import * as path from 'path';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';

let inferredLocalDefault: { organizationId: string; userId: string } | null | undefined;

function inferLocalDefaultTenant(): { organizationId: string; userId: string } | null {
  // Only infer in local server mode; in cloud mode the client must be explicit.
  if ((process.env.ANT_SERVER_MODE || 'local') === 'cloud') return null;

  if (inferredLocalDefault !== undefined) return inferredLocalDefault;

  try {
    const base = WorkspacePathResolver.getPhysicalWorkspacesPath();
    const orgs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => name !== 'local' && name !== '.ide-homes' && !name.startsWith('.'));

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
    }
  } catch {
    // ignore
  }

  inferredLocalDefault = null;
  return null;
}

function inferTenantByProjectId(projectId: string): { organizationId: string; userId: string } | null {
  // Only infer in local server mode; cloud must be explicit.
  if ((process.env.ANT_SERVER_MODE || 'local') === 'cloud') return null;
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
    };
  }

  // Cloud mode: JWT must be present — reject if not
  const isCloudMode = (process.env.ANT_SERVER_MODE || 'local') === 'cloud';
  if (isCloudMode) {
    throw new Error('Authentication required: no valid JWT token');
  }

  // Local mode: filesystem inference fallback
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
  };
}

/**
 * Check if request has authenticated user context
 */
export function hasUserContext(req: Request): boolean {
  return !!(req.user && req.organization);
}
