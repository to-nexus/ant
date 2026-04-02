import { Router, Request, Response } from 'express';

/**
 * Health check and system endpoints
 */
export function createHealthRoutes(): Router {
  const router = Router();
  
  // Health check
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  
  // Get system configuration
  router.get('/system/config', (_req: Request, res: Response) => {
    const MIN_RECURSION_LIMIT = 5;
    const recursionLimit = parseInt(process.env.RECURSION_LIMIT || '', 10);
    const finalLimit = (isNaN(recursionLimit) || recursionLimit < MIN_RECURSION_LIMIT) 
      ? 200 
      : recursionLimit;
    
    res.json({ 
      recursionLimit: finalLimit,
      authMode: process.env.ANT_SERVER_MODE || 'local',  // local or cloud (affects auth only)
      ideRuntime: process.env.ANT_K8S_NAMESPACE ? 'kubernetes' : 'docker'
    });
  });
  
  // Get available agents (only enabled agents are listed)
  router.get('/agents', (_req: Request, res: Response) => {
    res.json([
      { 
        value: 'architect', 
        label: 'Architect', 
        enabled: true,
        jobs: [
          { value: 'design', label: 'Design' },
          { value: 'code', label: 'Code' },
          { value: 'learn', label: 'Learn' },
        ]
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

