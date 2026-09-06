/**
 * Shared context for the preview control-plane handler modules and the
 * content-listener upgrade handler. PreviewServer builds one from its own
 * services after initialize(); route MOUNTS stay in PreviewServer.ts (the
 * origin-split test reads them there) — only handler bodies live out here.
 */

import type { Request, Response } from 'express';
import type { IncomingMessage } from 'http';
import * as path from 'path';
import type { ProjectProfile } from '@ant/shared';
import type { PreviewService } from '../../../periphery/adapters/http/services/PreviewService';
import type { DeployService } from '../../deploy/DeployService';
import type { CustomDomainService } from '../../deploy/customDomain/CustomDomainService';
import type { StateStorePort } from '../../../core/ports/stateStore';
import type { PortRegistryPort, ServiceConnection } from '../../../core/ports/portRegistry';
import type { DetectedProjectFacts } from '../../../periphery/adapters/http/services/PreviewService/detectors/ProjectProfileDetector';

export interface PreviewServerCtx {
  mode?: 'local' | 'cloud';
  stateStore: StateStorePort & PortRegistryPort;
  previewService: PreviewService;
  deployService: DeployService;
  customDomainService: CustomDomainService;
  resolveWorkspacePath(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): string;
  detectProjectFacts(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
    fallback?: ProjectProfile,
  ): Promise<DetectedProjectFacts | null>;
  refreshProjectFacts(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): Promise<ServiceConnection[]>;
  markRestartRequiredIfRunning(
    userContext: { organizationId: string; userId: string },
    projectId: string,
    feature: string,
  ): Promise<boolean>;
  authorizeDeployUpgrade(
    req: IncomingMessage,
    coords: { tenantId: string; userId: string; projectId: string; feature: string },
  ): Promise<boolean>;
}

/**
 * Every preview/deploy operation is feature-scoped — a project has no codebase
 * of its own. Returns the feature name, or sends 400 and returns null.
 *
 * Replaces the old `req.body?.feature || 'main'` defaults, which synthesized a
 * feature that may not exist instead of rejecting an incomplete request.
 */
export function requireFeature(req: Request, res: Response): string | null {
  const feature = (req.body?.feature ?? req.query.feature) as string | undefined;
  if (!feature) {
    res.status(400).json({ success: false, error: 'feature is required' });
    return null;
  }
  return feature;
}

export function envTarget(workspaceRoot: string, pkgDir: string, fileName: string): { root: string; rel: string } {
  return { root: workspaceRoot, rel: path.join(path.relative(workspaceRoot, pkgDir), fileName) };
}
