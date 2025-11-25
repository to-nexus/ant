import { Router } from 'express';
import { GitHubAuthService } from '../../auth/GitHubAuthService';
import { extractUserContext } from './helpers/userContext';

export function createGitHubRoutes(deps: {
  githubAuthService: GitHubAuthService;
}): Router {
  const router = Router();
  
  /**
   * Save GitHub Personal Access Token
   * POST /api/github/pat
   * Body: { pat: string }
   */
  router.post('/pat', async (req, res) => {
    try {
      const { pat } = req.body;
      
      if (!pat || typeof pat !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'PAT is required' 
        });
      }
      
      // ✅ Use consistent user context extraction
      const userContextFull = extractUserContext(req);
      const userContext = {
        org: userContextFull.organizationId,
        user: userContextFull.userId
      };
      
      const result = await deps.githubAuthService.savePAT(userContext, pat);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: 'PAT saved successfully',
          username: result.username
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error 
        });
      }
    } catch (error: any) {
      console.error('Error saving PAT:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });
  
  /**
   * Get PAT status (configured or not)
   * GET /api/github/pat/status
   */
  router.get('/pat/status', async (req, res) => {
    try {
      const userContextFull = extractUserContext(req);
      const userContext = {
        org: userContextFull.organizationId,
        user: userContextFull.userId
      };
      
      const hasPAT = await deps.githubAuthService.hasPAT(userContext);
      
      res.json({ 
        configured: hasPAT,
        message: hasPAT ? 'PAT configured' : 'PAT not configured'
      });
    } catch (error: any) {
      console.error('Error checking PAT status:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });
  
  /**
   * Delete PAT
   * DELETE /api/github/pat
   */
  router.delete('/pat', async (req, res) => {
    try {
      const userContextFull = extractUserContext(req);
      const userContext = {
        org: userContextFull.organizationId,
        user: userContextFull.userId
      };
      
      await deps.githubAuthService.deletePAT(userContext);
      
      res.json({ 
        success: true, 
        message: 'PAT deleted successfully' 
      });
    } catch (error: any) {
      console.error('Error deleting PAT:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Internal server error' 
      });
    }
  });
  
  return router;
}

