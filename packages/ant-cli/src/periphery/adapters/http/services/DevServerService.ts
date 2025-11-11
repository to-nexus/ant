import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { LogEntry } from '../../../../core/ports/http';

/**
 * DevServerService
 * 
 * Manages development servers for projects.
 * Handles spawning, monitoring, and stopping dev servers.
 */
export class DevServerService {
  private devServers: Map<string, ChildProcess> = new Map();
  private devServerPorts: Map<string, number> = new Map();
  private devServerLogs: Map<string, LogEntry[]> = new Map();
  private onStatusChange?: (projectId: string) => void;
  
  constructor(callbacks?: {
    onStatusChange?: (projectId: string) => void;
  }) {
    this.onStatusChange = callbacks?.onStatusChange;
  }
  
  /**
   * Start dev server for a project
   */
  async startDevServer(projectId: string, localPath: string): Promise<{ success: boolean; message?: string; error?: string }> {
    // Check if dev server is already running
    if (this.devServers.has(projectId)) {
      return { success: false, error: 'Dev server already running' };
    }
    
    // Check if package.json exists
    const packageJsonPath = path.join(localPath, 'package.json');
    const packageJsonExists = await fs.promises.access(packageJsonPath)
      .then(() => true)
      .catch(() => false);
    
    if (!packageJsonExists) {
      return { success: false, error: 'package.json not found in project' };
    }
    
    // Read package.json to get dev script
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
    
    // Check if node_modules exists
    const nodeModulesPath = path.join(localPath, 'node_modules');
    const hasNodeModules = await fs.promises.access(nodeModulesPath)
      .then(() => true)
      .catch(() => false);
    
    if (!hasNodeModules) {
      return { 
        success: false,
        error: 'Dependencies not installed. Please run "npm install" in the project directory first.' 
      };
    }
    
    // Determine the best dev server command
    let command: string;
    let args: string[];
    
    if (packageJson.scripts?.dev) {
      // Use npm/pnpm/yarn run dev
      command = 'npm';
      args = ['run', 'dev'];
    } else if (packageJson.scripts?.start) {
      // Fallback to start script
      command = 'npm';
      args = ['run', 'start'];
    } else if (packageJson.devDependencies?.vite || packageJson.dependencies?.vite) {
      // Direct vite command
      command = 'npx';
      args = ['vite'];
    } else if (packageJson.devDependencies?.['@vitejs/plugin-react'] || packageJson.dependencies?.['@vitejs/plugin-react']) {
      // Vite React project
      command = 'npx';
      args = ['vite'];
    } else if (packageJson.devDependencies?.['next'] || packageJson.dependencies?.['next']) {
      // Next.js project
      command = 'npx';
      args = ['next', 'dev'];
    } else if (packageJson.devDependencies?.['react-scripts']) {
      // Create React App
      command = 'npx';
      args = ['react-scripts', 'start'];
    } else {
      return { 
        success: false,
        error: 'No suitable dev server command found. Please add a "dev" script to package.json' 
      };
    }
    
    // Clear previous logs
    this.devServerLogs.set(projectId, []);
    
    
    // Start dev server with BROWSER=none to prevent auto-opening
    const devProcess = spawn(command, args, {
      cwd: localPath,
      shell: true,
      env: { 
        ...process.env,
        BROWSER: 'none',  // Prevent Vite/CRA from auto-opening browser
        OPEN: 'false'     // Alternative env var for some dev servers
      }
    });
    
    this.devServers.set(projectId, devProcess);
    
    // Log when process starts
    
    // Capture stdout
    devProcess.stdout?.on('data', (data: Buffer) => {
      const message = data.toString();
      const log: LogEntry = {
        timestamp: new Date().toISOString(),
        type: 'stdout',
        message: message.trim()
      };
      
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(log);
      this.devServerLogs.set(projectId, logs);
      
      // Try to extract port from common dev server outputs
      // Vite: "Local:   http://localhost:5173/"
      // Next.js: "ready - started server on 0.0.0.0:3000"
      // Create React App: "Local:            http://localhost:3000"
      const portPatterns = [
        /localhost:(\d+)/i,
        /127\.0\.0\.1:(\d+)/i,
        /port\s+(\d+)/i,
        /0\.0\.0\.0:(\d+)/i,
      ];
      
      if (!this.devServerPorts.has(projectId)) {
        for (const pattern of portPatterns) {
          const match = message.match(pattern);
          if (match) {
            const port = parseInt(match[1]);
            this.devServerPorts.set(projectId, port);
            this.onStatusChange?.(projectId);
            break;
          }
        }
      }
    });
    
    // Capture stderr
    devProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString();
      
      const log: LogEntry = {
        timestamp: new Date().toISOString(),
        type: 'stderr',
        message: message.trim()
      };
      
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(log);
      this.devServerLogs.set(projectId, logs);
    });
    
    // Handle process exit
    devProcess.on('exit', (code, signal) => {
      
      const log: LogEntry = {
        timestamp: new Date().toISOString(),
        type: code === 0 ? 'stdout' : 'stderr',
        message: signal 
          ? `Dev server stopped (${signal})`
          : `Dev server exited with code ${code}`
      };
      
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(log);
      this.devServerLogs.set(projectId, logs);
      
      // Cleanup
      this.devServers.delete(projectId);
      this.devServerPorts.delete(projectId);
      this.onStatusChange?.(projectId);
    });
    
    devProcess.on('error', (error) => {
      console.error(`[DevServer] Error for ${projectId}:`, error);
      
      const log: LogEntry = {
        timestamp: new Date().toISOString(),
        type: 'stderr',
        message: `Error: ${error.message}`
      };
      
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(log);
      this.devServerLogs.set(projectId, logs);
      
      // Cleanup
      this.devServers.delete(projectId);
      this.devServerPorts.delete(projectId);
      this.onStatusChange?.(projectId);
    });
    
    return { success: true, message: 'Dev server starting...' };
  }
  
  /**
   * Stop dev server for a project
   */
  stopDevServer(projectId: string): { success: boolean; message?: string; error?: string } {
    const devProcess = this.devServers.get(projectId);
    
    if (!devProcess) {
      return { success: false, error: 'Dev server not running' };
    }
    
    devProcess.kill('SIGTERM');
    
    // Add a timeout to force kill if graceful shutdown fails
    setTimeout(() => {
      if (this.devServers.has(projectId)) {
        devProcess.kill('SIGKILL');
      }
    }, 5000);
    
    return { success: true, message: 'Dev server stopping...' };
  }
  
  /**
   * Get dev server status
   */
  getDevServerStatus(projectId: string): {
    running: boolean;
    port?: number;
    pid?: number;
  } {
    const devProcess = this.devServers.get(projectId);
    const port = this.devServerPorts.get(projectId);
    
    return {
      running: !!devProcess,
      port,
      pid: devProcess?.pid
    };
  }
  
  /**
   * Get dev server logs
   */
  getDevServerLogs(projectId: string): LogEntry[] {
    return this.devServerLogs.get(projectId) || [];
  }
  
  /**
   * Cleanup all dev servers
   */
  cleanup(): void {
    for (const [projectId, devProcess] of this.devServers.entries()) {
      devProcess.kill('SIGTERM');
    }
    this.devServers.clear();
    this.devServerPorts.clear();
  }
}

