/**
 * Organization Routes
 * 
 * API endpoints for exploring same-organization members' projects/features.
 * Used by the Transfer UI to browse recipient destinations.
 * Also handles organization-level configuration (e.g., GitHub defaults).
 * 
 * Security: Only exposes directory structure (canonical dirs), not file contents.
 * Access restricted to same organization members.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { extractUserContext } from './helpers/userContext';
import { sendErrorResponse } from './helpers/errorResponse';
import { logger } from '../../../../utils/logger';
import { CANONICAL_FEATURE_DIRS } from '@ant/shared';
import { OrgConfig } from '../../../../core/types/orgConfig';
import {
  UserConfig,
  getUserConfigPath,
  readUserConfig,
  writeUserConfig,
  readUserVisibility,
} from './helpers/userConfigStore';

export interface OrgRoutesDeps {
  workspaceResolver: any;
}

/** Validate an email param: lowercase, single `@`, no path separators. */
function normalizeEmailParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@:/\\]+@[^\s@:/\\]+\.[^\s@:/\\]+$/.test(email)) return null;
  if (email.includes('..')) return null;
  return email;
}

/**
 * Get org config file path
 */
function getOrgConfigPath(workspacesPath: string, orgId: string): string {
  return path.join(workspacesPath, orgId, '.ant', 'org-config.json');
}

/**
 * Read org config from disk
 */
async function readOrgConfig(workspacesPath: string, orgId: string): Promise<OrgConfig> {
  const configPath = getOrgConfigPath(workspacesPath, orgId);
  try {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(data) as OrgConfig;
  } catch {
    return {}; // Return empty config if not found
  }
}

/**
 * Write org config to disk
 */
async function writeOrgConfig(workspacesPath: string, orgId: string, config: OrgConfig): Promise<void> {
  const configPath = getOrgConfigPath(workspacesPath, orgId);
  const dir = path.dirname(configPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function createOrgRoutes(deps: OrgRoutesDeps): Router {
  const router = Router();
  const { workspaceResolver } = deps;

  /**
   * Whether the caller may drill into a target member's tree.
   * - self → always.
   * - team → same-org peer.
   * - individual → only when the target's account is public.
   * - local → self only.
   */
  async function canAccessTarget(
    kind: string,
    selfUserId: string,
    targetUserId: string,
    orgId: string,
  ): Promise<boolean> {
    if (targetUserId === selfUserId) return true;
    if (kind === 'team') return true;
    if (kind === 'individual') {
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      return (await readUserVisibility(workspacesPath, orgId, targetUserId)) === 'public';
    }
    return false;
  }

  /**
   * GET /api/org/members
   * List organization members — dispatched by org kind (data-driven, not
   * server mode):
   *
   * - `team`: enumerate the workspace directory tree under the org, so any
   *   sibling user folder becomes a transfer recipient candidate.
   * - `individual`: self only. The `individual` org is SHARED across every
   *   cloud user — enumerating it would leak the entire user base. Cross-user
   *   reach goes through the exact-email `GET /org/members/lookup` instead.
   * - `local`: self only (no organization concept).
   */
  router.get('/org/members', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const kind = userContext.organizationKind ?? 'local';

      if (kind !== 'team') {
        // individual + local: self only.
        return res.json({
          members: [{ userId: userContext.userId, isSelf: true }],
        });
      }

      const orgId = userContext.organizationId;
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const orgPath = path.join(workspacesPath, orgId);

      if (!fs.existsSync(orgPath)) {
        return res.json({ members: [] });
      }

      const entries = await fs.promises.readdir(orgPath, { withFileTypes: true });
      const members = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({
          userId: e.name,
          isSelf: e.name === userContext.userId,
        }));

      res.json({ members });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * GET /api/org/members/lookup?email=<full-email>
   * Exact-email recipient lookup for `individual` orgs (file-transfer
   * search). Returns a candidate ONLY when the target workspace exists AND
   * that account's visibility is `public`. A miss (not found OR private)
   * returns an INDISTINGUISHABLE `{ member: null }` so a private account's
   * existence is never leaked.
   */
  router.get('/org/members/lookup', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const kind = userContext.organizationKind ?? 'local';
      if (kind !== 'individual') {
        // team uses the browse list; local has no peers.
        return res.status(400).json({ error: 'Lookup is only available for individual accounts.' });
      }

      const email = normalizeEmailParam(req.query.email);
      if (!email) {
        return res.status(400).json({ error: 'A valid email is required.' });
      }

      const orgId = userContext.organizationId; // 'individual'
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const userPath = path.join(workspacesPath, orgId, email);

      const exists = fs.existsSync(userPath);
      const visibility = exists ? await readUserVisibility(workspacesPath, orgId, email) : 'private';
      if (!exists || visibility !== 'public') {
        // Indistinguishable miss — do not reveal whether the account exists.
        return res.json({ member: null });
      }

      res.json({ member: { userId: email, isSelf: email === userContext.userId } });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * GET /api/org/members/:userId/projects
   * List a member's projects. In local mode only the caller can be
   * queried — other user ids are rejected (no organization concept).
   */
  router.get('/org/members/:userId/projects', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const targetUserId = req.params.userId;
      const kind = userContext.organizationKind ?? 'local';
      if (!(await canAccessTarget(kind, userContext.userId, targetUserId, userContext.organizationId))) {
        return res.status(404).json({ error: 'Member not found.' });
      }
      const orgId = userContext.organizationId;
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const userPath = path.join(workspacesPath, orgId, targetUserId);

      if (!fs.existsSync(userPath)) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      }

      const entries = await fs.promises.readdir(userPath, { withFileTypes: true });
      const projects = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ projectId: e.name }));

      res.json({ projects });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * GET /api/org/members/:userId/projects/:projectId/features
   * List a member's project features.
   */
  router.get('/org/members/:userId/projects/:projectId/features', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const { userId: targetUserId, projectId } = req.params;
      const kind = userContext.organizationKind ?? 'local';
      if (!(await canAccessTarget(kind, userContext.userId, targetUserId, userContext.organizationId))) {
        return res.status(404).json({ error: 'Member not found.' });
      }
      const orgId = userContext.organizationId;
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const featuresPath = path.join(workspacesPath, orgId, targetUserId, projectId, 'features');

      if (!fs.existsSync(featuresPath)) {
        return res.json({ features: [] });
      }

      const entries = await fs.promises.readdir(featuresPath, { withFileTypes: true });
      const features = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => ({ featureId: e.name }));

      res.json({ features });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * GET /api/org/members/:userId/projects/:projectId/features/:featureId/directories
   * List canonical directories only (no file content exposure).
   * Returns the subset of CANONICAL_FEATURE_DIRS that actually exist on disk,
   * excluding sessions/ directories.
   */
  router.get('/org/members/:userId/projects/:projectId/features/:featureId/directories', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const { userId: targetUserId, projectId, featureId } = req.params;
      const kind = userContext.organizationKind ?? 'local';
      if (!(await canAccessTarget(kind, userContext.userId, targetUserId, userContext.organizationId))) {
        return res.status(404).json({ error: 'Member not found.' });
      }
      const orgId = userContext.organizationId;
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const featurePath = path.join(workspacesPath, orgId, targetUserId, projectId, 'features', featureId);

      if (!fs.existsSync(featurePath)) {
        return res.status(404).json({ error: '피처를 찾을 수 없습니다.' });
      }

      // Return canonical dirs (excluding sessions/) that exist
      const canonicalDirs = CANONICAL_FEATURE_DIRS
        .filter(d => !d.startsWith('sessions'))
        .filter(d => {
          try {
            return fs.existsSync(path.join(featurePath, d));
          } catch {
            return false;
          }
        });

      res.json({ directories: canonicalDirs });
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  // ========================================
  // Organization Config Endpoints
  // ========================================

  /**
   * GET /api/org/config
   * Read organization-level configuration.
   */
  router.get('/org/config', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const orgId = userContext.organizationId;
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();

      const config = await readOrgConfig(workspacesPath, orgId);
      res.json(config);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * PUT /api/org/config
   * Update organization-level configuration (merge with existing).
   */
  router.put('/org/config', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const orgId = userContext.organizationId;

      // Individual accounts have no org-level config — there is no shared
      // org to own a default repo owner (only the personal owner applies).
      if ((userContext.organizationKind ?? 'local') === 'individual') {
        return res.status(403).json({
          error: 'INDIVIDUAL_NO_ORG_CONFIG',
          message: 'Individual accounts have no organization-level configuration.',
        });
      }

      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();

      // Read existing config and deep merge
      const existing = await readOrgConfig(workspacesPath, orgId);
      const updates = req.body as Partial<OrgConfig>;
      
      const merged: OrgConfig = {
        ...existing,
        github: {
          ...existing.github,
          ...updates.github,
        },
      };

      await writeOrgConfig(workspacesPath, orgId, merged);
      res.json(merged);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  // ========================================
  // User Config Endpoints (per-user overrides)
  // ========================================

  /**
   * GET /api/user/config
   * Read user-level configuration (personal overrides).
   */
  router.get('/user/config', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();

      const config = await readUserConfig(workspacesPath, userContext.organizationId, userContext.userId);
      res.json(config);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * PUT /api/user/config
   * Update user-level configuration (merge with existing).
   */
  router.put('/user/config', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();

      const existing = await readUserConfig(workspacesPath, userContext.organizationId, userContext.userId);
      const updates = req.body as Partial<UserConfig>;

      const merged: UserConfig = {
        ...existing,
        github: {
          ...existing.github,
          ...updates.github,
        },
        account: {
          ...existing.account,
          ...updates.account,
        },
      };

      // Clean up undefined values
      if (merged.github && !merged.github.ownerOverride) {
        delete merged.github.ownerOverride;
      }
      if (merged.github && Object.keys(merged.github).length === 0) {
        delete merged.github;
      }
      if (merged.account && merged.account.visibility == null) {
        delete merged.account.visibility;
      }
      if (merged.account && Object.keys(merged.account).length === 0) {
        delete merged.account;
      }

      await writeUserConfig(workspacesPath, userContext.organizationId, userContext.userId, merged);
      res.json(merged);
    } catch (error: any) {
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  /**
   * POST /api/user/reset
   * Reset user account: delete all workspaces, sessions, and user config.
   * Git repositories are preserved.
   */
  router.post('/user/reset', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const workspacesPath = workspaceResolver.getPhysicalWorkspacesPath();
      const userWorkspacePath = path.join(workspacesPath, userContext.organizationId, userContext.userId);

      logger.debug(`[UserReset] Starting account reset for user ${userContext.userId} in org ${userContext.organizationId}`);

      if (!fs.existsSync(userWorkspacePath)) {
        logger.debug('[UserReset] User workspace not found, nothing to reset');
        res.json({ success: true, message: 'No data to reset' });
        return;
      }

      // Read all project directories
      const projectDirs = fs.readdirSync(userWorkspacePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && dirent.name !== '.ant')
        .map(dirent => dirent.name);

      logger.debug(`[UserReset] Found ${projectDirs.length} projects to delete`);

      // Delete each project directory entirely
      for (const projectId of projectDirs) {
        const projectPath = path.join(userWorkspacePath, projectId);
        await fs.promises.rm(projectPath, { recursive: true, force: true });
        logger.debug(`[UserReset] Deleted project ${projectId}`);
      }

      // Delete user config
      const userConfigPath = getUserConfigPath(workspacesPath, userContext.organizationId, userContext.userId);
      if (fs.existsSync(userConfigPath)) {
        await fs.promises.unlink(userConfigPath);
        logger.debug('[UserReset] Deleted user-config.json');
      }

      // Delete .ant directory if it exists and is now empty
      const antDirPath = path.join(userWorkspacePath, '.ant');
      if (fs.existsSync(antDirPath)) {
        const antDirContents = fs.readdirSync(antDirPath);
        if (antDirContents.length === 0) {
          await fs.promises.rmdir(antDirPath);
          logger.debug('[UserReset] Deleted empty .ant directory');
        }
      }

      logger.debug('[UserReset] ✅ Account reset complete');
      res.json({ success: true, message: 'Account reset successfully' });
    } catch (error: any) {
      logger.error('[UserReset] Failed', { component: 'UserReset' }, error);
      sendErrorResponse(res, 500, error, 'Org');
    }
  });

  return router;
}
