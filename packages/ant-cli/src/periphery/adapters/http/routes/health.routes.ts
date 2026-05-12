import { Router, Request, Response } from 'express';
import type { ServerMode, SystemConfigResponse } from '@ant/shared';
import { isVectorDbEnabled } from '../../../../core/config/vectorDbCapability';

/**
 * Health check and system endpoints
 */
export function createHealthRoutes(): Router {
  const router = Router();
  
  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Get system configuration. SSOT for FE-visible BE runtime mode —
  // `authMode` is the canonical answer to "is this server local or cloud"
  // (sourced from ANT_SERVER_MODE at startup). FE consumes this read-only;
  // there is no user-facing toggle.
  router.get('/system/config', (_req: Request, res: Response) => {
    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT)
      ? 200
      : recursionLimit;

    const authMode: ServerMode = process.env.ANT_SERVER_MODE === 'cloud' ? 'cloud' : 'local';

    const payload: SystemConfigResponse = {
      recursionLimit: finalLimit,
      authMode,
      ideRuntime: process.env.ANT_K8S_NAMESPACE ? 'kubernetes' : 'docker',
      capabilities: {
        vectorDb: isVectorDbEnabled(),
      },
    };

    res.json(payload);
  });
  
  // Get available agents (only enabled agents are listed).
  // The architect/learn job is intentionally omitted — the feature is
  // incomplete and hidden from every UI surface (chat chips, action
  // tab, @-mention, and this agent/job picker). The BE intent / job
  // runner remain wired so direct API invocation still works.
  router.get('/agents', (_req: Request, res: Response) => {
    const architectJobs = [
      { value: 'design', label: 'Design' },
      { value: 'code', label: 'Code' },
    ];

    res.json([
      { 
        value: 'architect', 
        label: 'Architect', 
        enabled: true,
        jobs: architectJobs,
      },
      { 
        value: 'planner', 
        label: 'Planner', 
        enabled: true,
        jobs: [
          { value: 'plan', label: 'Plan' },
        ]
      },
      {
        value: 'creator',
        label: 'Creator',
        enabled: true,
        jobs: [
          { value: 'visual', label: 'Visual' },
        ]
      },
    ]);
  });
  
  return router;
}

