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
import { CANONICAL_FEATURE_DIRS } from '../../../../core/utils/sessionPaths';
import { OrgConfig } from '../../../../core/types/orgConfig';

/**
 * User-level configuration (per-user overrides)
 * Stored at: {workspaces}/{orgId}/{userId}/.ant/user-config.json
 */
interface UserConfig {
  github?: {
    /** User-level override for default GitHub owner. Takes precedence over org config. null = clear override. */
    ownerOverride?: string | null;
  };
}

export interface OrgRoutesDeps {
  workspaceResolver: any;
}

/**
 * Get org config file path
 */
function getOrgConfigPath(workspacesPath: string, orgId: string): string {
  return path.join(workspacesPath, orgId, '.ant', 'org-config.json');
}

/**
 * Get user config file path
 */
function getUserConfigPath(workspacesPath: string, orgId: string, userId: string): string {
  return path.join(workspacesPath, orgId, userId, '.ant', 'user-config.json');
}

/**
 * Read user config from disk
 */
async function readUserConfig(workspacesPath: string, orgId: string, userId: string): Promise<UserConfig> {
  const configPath = getUserConfigPath(workspacesPath, orgId, userId);
  try {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    return JSON.parse(data) as UserConfig;
  } catch {
    return {}; // Return empty config if not found
  }
}

/**
 * Write user config to disk
 */
async function writeUserConfig(workspacesPath: string, orgId: string, userId: string, config: UserConfig): Promise<void> {
  const configPath = getUserConfigPath(workspacesPath, orgId, userId);
  const dir = path.dirname(configPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
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
   * GET /api/org/members
   * List organization members (based on workspace directory structure).
   */
  router.get('/org/members', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
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
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/org/members/:userId/projects
   * List a member's projects.
   */
  router.get('/org/members/:userId/projects', async (req: Request, res: Response) => {
    try {
      const userContext = extractUserContext(req);
      const targetUserId = req.params.userId;
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      };

      // Clean up undefined values
      if (merged.github && !merged.github.ownerOverride) {
        delete merged.github.ownerOverride;
      }
      if (merged.github && Object.keys(merged.github).length === 0) {
        delete merged.github;
      }

      await writeUserConfig(workspacesPath, userContext.organizationId, userContext.userId, merged);
      res.json(merged);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
