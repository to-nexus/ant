/**
 * Deploy management, custom-domain and admin handler bodies (mounted from
 * PreviewServer.setupControlRoutes — the mounts stay there on purpose).
 */

import type { Request, Response } from 'express';
import { extractUserContext } from '../../../periphery/adapters/http/routes/helpers/userContext';
import { sendErrorResponse } from '../../../periphery/adapters/http/routes/helpers/errorResponse';
import { logger } from '../../../utils/logger';
import { isBillingEnabled } from '../../../core/config/billingCapability';
import { getInfrastructureFactory } from '../../adapters/InfrastructureFactory';
import { type PreviewServerCtx } from './context';

export function createDeployControlHandlers(ctx: PreviewServerCtx) {
    // ==========================================
    // Deploy Management API (JWT-authenticated)
    // ==========================================

    /**
     * POST /projects/:id/deploy
     * Start build and deploy (non-blocking). Returns 202 immediately;
     * build progress and final status are delivered via SSE 'deploy' events.
     *
     * Deploy is feature-scoped, so a request without a feature is rejected with
     * 400. No feature NAME is privileged — under the bare-anchor model branch ==
     * feature, so `main` is an ordinary feature (and is the one clone
     * auto-creates). Requests issued while a code job is writing files on this
     * feature are rejected with 409 — DeployService surfaces this via
     * `reason === 'code-job-active'`.
     */
    const deploy = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.body?.feature;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        // Free-tier gate: preview is open to all, deploy requires a paid plan.
        // Billing-guarded so local/OSS (noop ledger reports 'free') keeps deploy open.
        if (isBillingEnabled()) {
          try {
            const bal = await getInfrastructureFactory()
              .getCreditLedger()
              .getBalance(userContext.organizationId, userContext.userId);
            if (bal.tier === 'free') {
              res.status(403).json({
                success: false,
                reason: 'tier-not-allowed',
                message: 'Deploy requires Pro or Max. Preview is free for all tiers.',
              });
              return;
            }
          } catch (err) {
            logger.warn('[PreviewServer] deploy tier check failed — rejecting', { component: 'PreviewServer' }, err as any);
            res.status(500).json({ success: false, reason: 'internal-error', message: 'Tier verification failed.' });
            return;
          }
        }

        logger.warn(`[PreviewServer] POST /projects/${projectId}/deploy (user=${userContext.userId}, feature=${feature})`, {
          component: 'PreviewServer'
        });

        // Whitelist the visibility input — never trust the raw body value.
        const visibility = req.body?.visibility === 'private' ? 'private' : 'public';

        const codebasePath = ctx.resolveWorkspacePath(userContext, projectId, feature);
        const result = await ctx.deployService.startDeploy(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature,
          codebasePath,
          visibility
        );

        if (result.success) {
          res.status(202).json(result);
          return;
        }

        // Map failure reasons to HTTP status codes. 409 for the one that
        // is transient (resolves when the code job ends); 400 for the
        // rest (validation failures the caller must fix before retrying).
        const status = result.reason === 'code-job-active' ? 409 : 400;
        res.status(status).json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * POST /projects/:id/deploy/stop
     * Stop a running deploy. Only valid for feature branches.
     */
    const deployStop = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.body?.feature;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        const result = await ctx.deployService.stopDeploy(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(result);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy stop error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /**
     * GET /projects/:id/deploy/status
     * Get deploy status. Only valid for feature branches.
     */
    const deployStatus = async (req: Request, res: Response) => {
      try {
        const projectId = req.params.id;
        const userContext = extractUserContext(req);
        const feature = req.query.feature as string | undefined;

        if (!feature) {
          res.status(400).json({
            success: false,
            reason: 'feature-required',
            message: 'A feature is required — deploy is feature-scoped',
          });
          return;
        }

        const status = await ctx.deployService.getStatus(
          userContext.organizationId,
          userContext.userId,
          projectId,
          feature
        );

        res.json(status);
      } catch (error: any) {
        logger.error('[PreviewServer] Deploy status error', { component: 'PreviewServer' }, error);
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    // ==========================================
    // Custom Domains (deploy-only)
    // ==========================================
    // A user-owned domain attached to a deployed package. Same feature-branch +
    // cloud constraints as deploy. Serving is handled by the deploy proxy; these
    // routes are the management plane (register → verify → active, list, delete).

    /** Shared guard: validate feature and build deploy coords from the request. */
    const customDomainCoords = (
      req: Request,
      res: Response,
      feature: string | undefined,
    ): { organizationId: string; userId: string; projectId: string; feature: string } | null => {
      if (!feature) {
        res.status(400).json({ success: false, reason: 'feature-required', message: 'A feature is required — custom domains are feature-scoped' });
        return null;
      }
      const userContext = extractUserContext(req);
      return { organizationId: userContext.organizationId, userId: userContext.userId, projectId: req.params.id, feature };
    };

    /** POST /projects/:id/custom-domain — register (returns DNS setup instructions). */
    const registerCustomDomain = async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.body?.feature);
        if (!c) return;
        const hostname = req.body?.hostname;
        const target = req.body?.target === 'backend' ? 'backend' : 'frontend';
        const slug = typeof req.body?.slug === 'string' && req.body.slug ? req.body.slug : undefined;
        const wildcard = req.body?.wildcard === true;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const result = await ctx.customDomainService.register(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname, target, slug, new Date().toISOString(), wildcard,
        );
        if (!result.ok) {
          const code = result.reason === 'not-enabled' ? 503 : result.reason === 'already-taken' ? 409 : 400;
          res.status(code).json({ success: false, reason: result.reason, message: result.message });
          return;
        }
        res.status(201).json({ success: true, domain: result.domain, dns: result.dns });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /** GET /projects/:id/custom-domain/status?feature=... — list domains for the deploy. */
    const customDomainStatus = async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.query.feature as string | undefined);
        if (!c) return;
        const domains = await ctx.customDomainService.list(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
        );
        res.json({ success: true, enabled: ctx.customDomainService.isEnabled(), domains });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /** POST /projects/:id/custom-domain/verify — trigger ownership (TXT) verification. */
    const verifyCustomDomain = async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, req.body?.feature);
        if (!c) return;
        const hostname = req.body?.hostname;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const domain = await ctx.customDomainService.verify(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname, new Date().toISOString(),
        );
        if (!domain) { res.status(404).json({ success: false, reason: 'not-found', message: 'Domain not found' }); return; }
        res.json({ success: true, domain });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    /** DELETE /projects/:id/custom-domain?feature=...&hostname=... — remove a domain. */
    const deleteCustomDomain = async (req: Request, res: Response) => {
      try {
        const c = customDomainCoords(req, res, (req.query.feature as string | undefined) ?? req.body?.feature);
        if (!c) return;
        const hostname = (req.query.hostname as string | undefined) ?? req.body?.hostname;
        if (!hostname || typeof hostname !== 'string') {
          res.status(400).json({ success: false, reason: 'invalid-hostname', message: 'hostname is required' });
          return;
        }
        const ok = await ctx.customDomainService.delete(
          { tenantId: c.organizationId, userId: c.userId, projectId: c.projectId, feature: c.feature },
          hostname,
        );
        if (!ok) { res.status(404).json({ success: false, reason: 'not-found', message: 'Domain not found' }); return; }
        res.json({ success: true });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    // ==========================================
    // Admin/Debug Endpoints
    // ==========================================

    /**
     * GET /preview/admin/instances
     * List all preview instances (admin only)
     */
    const adminInstances = async (_req: Request, res: Response) => {
      try {
        const previews = await ctx.stateStore.listPreviews();
        res.json({ instances: previews });
      } catch (error: any) {
        sendErrorResponse(res, 500, error, 'PreviewServer');
      }
    };

    // 404 handler

  return {
    deploy,
    deployStop,
    deployStatus,
    registerCustomDomain,
    customDomainStatus,
    verifyCustomDomain,
    deleteCustomDomain,
    adminInstances,
  };
}
