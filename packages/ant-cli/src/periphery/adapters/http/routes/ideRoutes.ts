import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * IDE routes for Local Mode
 * Opens local IDE (Cursor, VS Code, etc.) with specified path
 */
export function createIDERoutes(): Router {
  const router = Router();
  
  /**
   * Open local IDE
   * POST /api/ide/open
   */
  router.post('/ide/open', async (req: Request, res: Response) => {
    try {
      const { ide, localPath } = req.body;
      
      if (!ide || !localPath) {
        return res.status(400).json({
          error: 'IDE type and local path are required'
        });
      }
      
      // Expand ~ to home directory
      const expandedPath = localPath.startsWith('~/')
        ? path.join(os.homedir(), localPath.substring(2))
        : localPath.startsWith('~')
        ? os.homedir()
        : localPath;
      
      // Check if path exists
      try {
        await fs.promises.access(expandedPath);
      } catch {
        return res.status(404).json({
          error: 'Path not found',
          message: `Directory does not exist: ${expandedPath}`
        });
      }
      
      console.log(`[IDE] Opening ${ide} at ${expandedPath}`);
      
      // Platform-specific IDE commands
      const platform = os.platform();
      let command: string;
      let args: string[];
      
      if (platform === 'darwin') {
        // macOS
        if (ide === 'cursor') {
          command = 'open';
          args = ['-a', 'Cursor', expandedPath];
        } else if (ide === 'vscode') {
          command = 'open';
          args = ['-a', 'Visual Studio Code', expandedPath];
        } else {
          return res.status(400).json({
            error: 'Unsupported IDE',
            message: `IDE '${ide}' is not supported`
          });
        }
      } else if (platform === 'win32') {
        // Windows
        if (ide === 'cursor') {
          command = 'cmd';
          args = ['/c', 'start', '', 'cursor', expandedPath];
        } else if (ide === 'vscode') {
          command = 'cmd';
          args = ['/c', 'start', '', 'code', expandedPath];
        } else {
          return res.status(400).json({
            error: 'Unsupported IDE',
            message: `IDE '${ide}' is not supported`
          });
        }
      } else {
        // Linux
        if (ide === 'cursor') {
          command = 'cursor';
          args = [expandedPath];
        } else if (ide === 'vscode') {
          command = 'code';
          args = [expandedPath];
        } else {
          return res.status(400).json({
            error: 'Unsupported IDE',
            message: `IDE '${ide}' is not supported`
          });
        }
      }
      
      // Spawn IDE process
      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore'
      });
      
      child.unref();
      
      console.log(`[IDE] Successfully opened ${ide} at ${expandedPath}`);
      
      return res.json({
        success: true,
        message: `Opened ${ide} at ${expandedPath}`,
        ide,
        path: expandedPath
      });
      
    } catch (error: any) {
      console.error('[IDE] Error opening IDE:', error);
      return res.status(500).json({
        error: 'Failed to open IDE',
        message: error.message
      });
    }
  });
  
  /**
   * Check if IDE is installed
   * GET /api/ide/check/:ide
   */
  router.get('/ide/check/:ide', async (req: Request, res: Response) => {
    try {
      const { ide } = req.params;
      const platform = os.platform();
      
      let command: string;
      let args: string[];
      
      if (platform === 'darwin') {
        // macOS - check if app exists
        if (ide === 'cursor') {
          command = 'mdfind';
          args = ['kMDItemKind == "Application" && kMDItemFSName == "Cursor.app"'];
        } else if (ide === 'vscode') {
          command = 'mdfind';
          args = ['kMDItemKind == "Application" && kMDItemFSName == "Visual Studio Code.app"'];
        } else {
          return res.status(400).json({
            error: 'Unsupported IDE',
            installed: false
          });
        }
      } else {
        // Linux/Windows - check if command exists
        command = platform === 'win32' ? 'where' : 'which';
        args = [ide === 'cursor' ? 'cursor' : 'code'];
      }
      
      const child = spawn(command, args);
      
      let stdout = '';
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.on('close', (code) => {
        const installed = code === 0 && stdout.trim().length > 0;
        return res.json({
          ide,
          installed,
          path: installed ? stdout.trim() : null
        });
      });
      
    } catch (error: any) {
      console.error('[IDE] Error checking IDE:', error);
      return res.json({
        ide: req.params.ide,
        installed: false,
        error: error.message
      });
    }
  });
  
  return router;
}

