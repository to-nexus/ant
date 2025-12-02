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
      ? MIN_RECURSION_LIMIT 
      : recursionLimit;
    
    res.json({ 
      recursionLimit: finalLimit,
      serverMode: process.env.ANT_SERVER_MODE || 'local'
    });
  });
  
  // Get available agents
  router.get('/agents', (_req: Request, res: Response) => {
    res.json([
      { 
        value: 'architect', 
        label: 'Architect', 
        enabled: true,
        tasks: [
          { value: 'design', label: 'Design' },
          { value: 'code', label: 'Code' },
          { value: 'learn', label: 'Learn' },
        ]
      },
      { 
        value: 'reviewer', 
        label: 'Reviewer', 
        enabled: false,
        tasks: [
          { value: 'review', label: 'Review' },
        ]
      },
      { 
        value: 'planner', 
        label: 'Planner', 
        enabled: false,
        tasks: [
          { value: 'plan', label: 'Plan' },
        ]
      },
      { 
        value: 'doc', 
        label: 'Doc', 
        enabled: false,
        tasks: [
          { value: 'doc', label: 'Document' },
        ]
      },
    ]);
  });
  
  return router;
}

