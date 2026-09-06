/**
 * Preview management + config handler bodies (mounted from
 * PreviewServer.setupControlRoutes — the mounts stay there on purpose).
 */

import type { Request, Response } from 'express';
import * as fs from 'fs';
import { extractUserContext } from '../../../periphery/adapters/http/routes/helpers/userContext';
import { sendErrorResponse } from '../../../periphery/adapters/http/routes/helpers/errorResponse';
import { logger } from '../../../utils/logger';
import { observedFactsPatch, resolveProjectFacts } from '../../../periphery/adapters/http/services/PreviewService/utils/projectFacts';
import { ConnectionDetector } from '../../../periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector';
import {
  upsertConnectionAnnotation,
  mirrorConnectionToEnv,
  removeConnectionAnnotation,
  removeEnvKey,
} from '../../../periphery/adapters/http/services/PreviewService/detectors/ConnectionDetector/envFileWriter';
import { resolveConnectionForSave } from '../../../periphery/adapters/http/services/PreviewService/utils/connectionResolve';
import { resolveConnectionDir } from '../../../periphery/adapters/http/services/PreviewService/utils/connectionDir';
import { detectFramework } from '../../deploy';
import { toToggleFramework, frameworkTogglePrefix } from '../../../core/prompt/builder/serviceVirtualization/connectionModel';
import { envTarget, requireFeature, type PreviewServerCtx } from './context';

export function createPreviewControlHandlers(ctx: PreviewServerCtx) {
    // ==========================================
    // Preview Management API
    // ==========================================

    /**
     * POST /preview/projects/:id/start
     * Start preview for a project
     */
    const start = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const port = req.body?.port;
        const forceRestart = req.body?.forceRestart !== false;

        logger.warn(`[PreviewServer] POST /projects/${projectId}/start (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const workspacePath = ctx.resolveWorkspacePath(userContext, projectId, feature);

        const result = await ctx.previewService.startPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          workspacePath,
          port,
          forceRestart
        );

        if (result.success) {
          res.json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error: any) {
        logger.error('[PreviewServer] Start error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * POST /preview/projects/:id/stop
     * Stop preview for a project
     */
    const stop = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;

        logger.warn(`[PreviewServer] POST /projects/${projectId}/stop (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        const result = await ctx.previewService.stopPreview(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Stop error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * GET /preview/projects/:id/status
     * Get preview status for a project
     */
    const status = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        // getPreviewStatus reads from Redis (source of truth), with local memory fallback.
        // This guarantees consistent state across pods in multi-pod deployments.
        // status.url and status.packages[].url already obey the multi-frontend
        // contract (top-level url=null when 2+ frontends; per-package url for each).
        const status = await ctx.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Logs are only available on the owning pod (stored in local memory)
        const logs = ctx.previewService.getPreviewLogs(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        // Observe the codebase unconditionally — the project's identity does not
        // depend on whether a preview happens to be running. Only `canStart` is
        // gated on busyness (see `resolveProjectFacts`). Gating detection itself
        // is what made the profile disappear mid-start and flip across a
        // start/stop cycle.
        const cachedConfig = await ctx.stateStore
          .getPreviewConfig(userContext.organizationId, userContext.userId, projectId, feature)
          .catch(() => null);
        const detected = await ctx.detectProjectFacts(
          userContext, projectId, feature, cachedConfig?.projectProfile ?? undefined,
        );
        const isBusy = status.running || status.phase === 'installing' || status.phase === 'starting';
        const facts = resolveProjectFacts({
          detected,
          runtime: { structureType: status.structureType as any, projectProfile: status.projectProfile },
          cached: cachedConfig,
          isBusy,
        });

        res.json({
          running: status.running,
          ready: status.ready,
          port: status.port || null,
          url: status.url ?? null,
          processCount: status.processCount || 0,
          backendPort: status.backendPort || null,
          packages: status.packages || [],
          issues: status.issues || [],
          phase: status.phase,
          error: status.error,
          setupReasoning: status.setupReasoning,
          setupReason: status.setupReason,
          suggestedFix: status.suggestedFix,
          structureType: facts.structureType,
          projectProfile: facts.projectProfile,
          connections: status.connections || [],
          restartRequired: status.restartRequired ?? false,
          canStart: facts.canStart,
          logs: logs.slice(-50)
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Status error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * GET /preview/projects/:id/validate
     * Validate preview setup
     */
    const validate = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);

        const feature = requireFeature(req, res);
        if (!feature) return;
        const workspacePath = ctx.resolveWorkspacePath(userContext, projectId, feature);
        const result = await ctx.previewService.validatePreviewSetup(workspacePath);

        res.json({
          valid: result.valid,
          reason: result.reason,
          suggestedFix: result.suggestedFix
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Validate error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    // ==========================================
    // Preview Config Endpoints
    // ==========================================

    /**
     * GET /preview/projects/:id/preview-config
     * Get preview configuration (connections, structureType, projectProfile).
     *
     * The codebase is the SSOT for all three: connections come from
     * `.env.example` / `.env`, and the profile / structureType from the project
     * manifests. Redis is a derived cache, refreshed here. This endpoint and
     * `GET /status` share `resolveProjectFacts`, so the two can never disagree.
     */
    const getPreviewConfig = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;

        const config = await ctx.stateStore.getPreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const status = await ctx.previewService.getPreviewStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        const detected = await ctx.detectProjectFacts(
          userContext, projectId, feature, config?.projectProfile ?? undefined,
        );
        const isBusy = status.running || status.phase === 'installing' || status.phase === 'starting';
        const facts = resolveProjectFacts({
          detected,
          runtime: { structureType: status.structureType as any, projectProfile: status.projectProfile },
          cached: config,
          isBusy,
        });

        // Cached connections are the fallback when the workspace or its structure
        // is transiently unavailable — never overwrite them with an empty list.
        let connections = config?.connections || [];
        if (detected?.structure) {
          try {
            const workspacePath = ctx.resolveWorkspacePath(userContext, projectId, feature);
            const connectionDetector = new ConnectionDetector();
            connections = connectionDetector.detect(workspacePath, detected.structure, serverKey);
            await ctx.stateStore.savePreviewConfig(
              userContext.organizationId, userContext.userId, projectId, feature,
              { connections, ...observedFactsPatch(detected) }
            );
          } catch (detectErr: any) {
            logger.warn(`[PreviewServer] Connection detect failed, using cached config: ${detectErr.message}`, { component: 'PreviewServer' });
          }
        }

        res.json({
          structureType: facts.structureType,
          projectProfile: facts.projectProfile,
          connections,
        });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config get error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * PUT /preview/projects/:id/preview-config
     * Save preview configuration (connections).
     * Validates resolution type constraints and auto-computes ant-project proxy paths.
     */
    const savePreviewConfig = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;
        const { connections } = req.body;

        // Validate resolution type constraints
        const VALID_RESOLUTIONS: Record<string, string[]> = {
          infrastructure: ['url', 'docker'],
          business: ['url', 'ant-project'],
        };
        for (const conn of (connections || [])) {
          const allowed = VALID_RESOLUTIONS[conn.category];
          if (allowed && conn.resolution?.type && !allowed.includes(conn.resolution.type)) {
            res.status(400).json({
              error: `Invalid resolution type '${conn.resolution.type}' for category '${conn.category}'. Allowed: ${allowed.join(', ')}`,
              envVar: conn.envVar,
            });
            return;
          }
        }

        // Validate `source` BEFORE persisting: it is the subdirectory this
        // service later joins onto the workspace root to write `.env` /
        // `.env.example`, so a `../` source would steer those writes out of the
        // caller's workspace. Rejecting at save time also means no escaping
        // value is ever stored in Redis for a later write to pick up.
        for (const conn of (connections || [])) {
          try {
            resolveConnectionDir(ctx.resolveWorkspacePath(userContext, projectId, feature), conn.source);
          } catch (err: any) {
            res.status(400).json({ error: err.message, envVar: conn.envVar });
            return;
          }
        }

        // Resolve ant-project connections: compute resolvedUrlKey and proxy path.
        // A service-less connection (e.g. `self`) resolves to the whole-backend
        // proxy path — see resolveConnectionForSave for the serviceName guard.
        const resolvedConnections = (connections || []).map((conn: any) =>
          resolveConnectionForSave(conn, {
            projectId,
            feature,
            organizationId: userContext.organizationId,
            userId: userContext.userId,
          }),
        );

        // Strip runtime status before persisting (status is transient, belongs in PREVIEW state only)
        const configConnections = resolvedConnections.map(({ status, ...rest }: any) => rest);

        // Snapshot previous connections (before overwrite) to detect removals —
        // a connection dropped from the panel must have its annotation removed.
        const prevConfig = await ctx.stateStore.getPreviewConfig(
          userContext.organizationId, userContext.userId, projectId, feature,
        );
        const newIds = new Set(configConnections.map((c: any) => c.id));
        const removedConns = (prevConfig?.connections ?? []).filter((c: any) => !newIds.has(c.id));

        await ctx.stateStore.savePreviewConfig(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          { connections: configConnections }
        );
        // Deterministically persist annotations to .env.example + mirror to .env
        // — the write side of panel Save, replacing the Fix → LLM code-job round-trip.
        const workspacePath = ctx.resolveWorkspacePath(userContext, projectId, feature);
        if (fs.existsSync(workspacePath)) {
          for (const conn of configConnections) {
            const pkgDir = resolveConnectionDir(workspacePath, conn.source);
            const framework = toToggleFramework(detectFramework(pkgDir));
            upsertConnectionAnnotation(envTarget(workspacePath, pkgDir, '.env.example'), conn, framework);
            mirrorConnectionToEnv(envTarget(workspacePath, pkgDir, '.env'), conn, framework);
          }
          for (const conn of removedConns) {
            const pkgDir = resolveConnectionDir(workspacePath, conn.source);
            // Structure delete: drop the annotation from .env.example AND the
            // value/toggle keys from .env (explicit removal knows the envVar,
            // so this is the one safe place to delete .env keys).
            removeConnectionAnnotation(envTarget(workspacePath, pkgDir, '.env.example'), conn);
            const envPath = envTarget(workspacePath, pkgDir, '.env');
            removeEnvKey(envPath, conn.envVar);
            if (conn.virtualization?.toggleEnvVar) {
              const framework = toToggleFramework(detectFramework(pkgDir));
              const prefix = frameworkTogglePrefix(framework);
              removeEnvKey(envPath, conn.virtualization.toggleEnvVar);
              if (prefix) removeEnvKey(envPath, `${prefix}${conn.virtualization.toggleEnvVar}`);
            }
          }
        }

        const restartRequired = await ctx.markRestartRequiredIfRunning(userContext, projectId, feature);

        logger.info(`[PreviewServer] Preview config saved: ${projectId}/${feature} (${resolvedConnections.length} connections)`, { component: 'PreviewServer' });
        res.json({ success: true, connections: resolvedConnections, restartRequired });
      } catch (error: any) {
        logger.error('[PreviewServer] Preview config save error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * POST /preview/projects/:id/detect-connections
     * Re-scan project files for connections and overwrite the registry.
     * Used by the "Auto Detect" button in Config UI.
     */
    const detectConnections = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = requireFeature(req, res);
        if (!feature) return;

        const workspacePath = ctx.resolveWorkspacePath(userContext, projectId, feature);
        if (!fs.existsSync(workspacePath)) {
          res.status(404).json({ error: 'Project workspace not found', path: workspacePath });
          return;
        }

        const connections = await ctx.refreshProjectFacts(userContext, projectId, feature);
        logger.info(`[PreviewServer] Detect-connections: found ${connections.length} for ${projectId}/${feature}`, { component: 'PreviewServer' });
        res.json({ success: true, connections });
      } catch (error: any) {
        logger.error('[PreviewServer] Detect connections error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

  return { start, stop, status, validate, getPreviewConfig, savePreviewConfig, detectConnections };
}
