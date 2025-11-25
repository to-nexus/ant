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
  private installingProjects: Set<string> = new Set();  // ✅ Track installing projects
  private onStatusChange?: (projectId: string) => void;
  
  constructor(callbacks?: {
    onStatusChange?: (projectId: string) => void;
  }) {
    this.onStatusChange = callbacks?.onStatusChange;
  }
  
  /**
   * Check if npm install is needed
   * ✅ CRITICAL FIX: Use marker file instead of mtime
   * Directory mtime is UNRELIABLE (only updates on add/remove, not modify!)
   */
  private async checkIfInstallNeeded(localPath: string, hasNodeModules: boolean): Promise<boolean> {
    if (!hasNodeModules) {
      console.log('[DevServerService] node_modules not found - install needed');
      return true;
    }
    
    // ✅ Use marker file to track install completion
    const markerPath = path.join(localPath, 'node_modules', '.install-complete');
    try {
      await fs.promises.access(markerPath);
      console.log('[DevServerService] ✅ Dependencies up to date (marker found)');
      return false;
    } catch {
      console.log('[DevServerService] Marker file missing - install needed');
      return true;
    }
  }
  
  /**
   * Mark installation as complete
   */
  private async markInstallComplete(localPath: string): Promise<void> {
    const markerPath = path.join(localPath, 'node_modules', '.install-complete');
    try {
      await fs.promises.writeFile(markerPath, new Date().toISOString(), 'utf-8');
      console.log('[DevServerService] ✅ Install marker created');
    } catch (error) {
      console.warn('[DevServerService] ⚠️  Failed to create marker:', error);
    }
  }
  
  /**
   * Start dev server for a project
   */
  async startDevServer(projectId: string, localPath: string, port?: number): Promise<{ success: boolean; message?: string; error?: string }> {
    // Check if dev server is already running
    if (this.devServers.has(projectId)) {
      return { success: false, error: 'Dev server already running' };
    }
    
    // ✅ CRITICAL: Check and add ATOMICALLY (before any await!)
    if (this.installingProjects.has(projectId)) {
      return { success: false, error: 'Dependencies are being installed. Please wait...' };
    }
    // ✅ Add immediately to prevent race condition with concurrent requests
    this.installingProjects.add(projectId);
    
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
    
    // ✅ Smart dependency check: install if missing OR outdated
    const needsInstall = await this.checkIfInstallNeeded(localPath, hasNodeModules);
    
    // ✅ Use provided port or default
    const devPort = port || 4200;
    
    // Clear previous logs
    this.devServerLogs.set(projectId, []);
    
    // ✅ Auto-install dependencies if needed
    if (needsInstall) {
      const reason = !hasNodeModules 
        ? 'Dependencies not found' 
        : 'Dependencies outdated (package.json or lock file changed)';
      
      const installLog: LogEntry = {
        timestamp: new Date().toISOString(),
        type: 'stdout',
        message: `📦 ${reason}. Installing dependencies... This may take a few minutes.`
      };
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(installLog);
      this.devServerLogs.set(projectId, logs);
      
      // Run npm install
      return new Promise((resolve) => {
        const installProcess = spawn('npm', ['install'], {
          cwd: localPath,
          shell: true
        });
        
        installProcess.stdout?.on('data', (data: Buffer) => {
          const message = data.toString();
          const log: LogEntry = {
            timestamp: new Date().toISOString(),
            type: 'stdout',
            message: message.trim()
          };
          
          const logs = this.devServerLogs.get(projectId) || [];
          logs.push(log);
          this.devServerLogs.set(projectId, logs);
        });
        
        installProcess.stderr?.on('data', (data: Buffer) => {
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
        
        installProcess.on('exit', async (code) => {
          // ✅ Remove from installing set
          this.installingProjects.delete(projectId);
          
          if (code === 0) {
            // ✅ CRITICAL: Create marker file BEFORE recursive call!
            await this.markInstallComplete(localPath);
            
            const successLog: LogEntry = {
              timestamp: new Date().toISOString(),
              type: 'stdout',
              message: '✅ Dependencies installed successfully. Starting dev server...'
            };
            const logs = this.devServerLogs.get(projectId) || [];
            logs.push(successLog);
            this.devServerLogs.set(projectId, logs);
            
            // Now start the dev server by calling this method again
            const result = await this.startDevServer(projectId, localPath, port);
            resolve(result);
          } else {
            const errorLog: LogEntry = {
              timestamp: new Date().toISOString(),
              type: 'stderr',
              message: `❌ Failed to install dependencies (exit code ${code})`
            };
            const logs = this.devServerLogs.get(projectId) || [];
            logs.push(errorLog);
            this.devServerLogs.set(projectId, logs);
            
            resolve({
              success: false,
              error: `Failed to install dependencies (exit code ${code})`
            });
          }
        });
      });
    }
    
    // ✅ If install not needed, remove from installing set
    if (!needsInstall) {
      this.installingProjects.delete(projectId);
    }
    
    console.log(`[DevServerService] Starting dev server on port ${devPort}`);
    
    // Determine the best dev server command
    let command: string;
    let args: string[];
    let needsPortArg = false;
    
    // Check for specific frameworks first (before generic "dev" script)
    if (packageJson.devDependencies?.vite || packageJson.dependencies?.vite) {
      // Direct vite command
      command = 'npx';
      args = ['vite', '--port', devPort.toString()];  // ✅ Vite accepts --port
      needsPortArg = true;
    } else if (packageJson.devDependencies?.['@vitejs/plugin-react'] || packageJson.dependencies?.['@vitejs/plugin-react']) {
      // Vite React project
      command = 'npx';
      args = ['vite', '--port', devPort.toString()];  // ✅ Vite accepts --port
      needsPortArg = true;
    } else if (packageJson.devDependencies?.['next'] || packageJson.dependencies?.['next']) {
      // Next.js project
      command = 'npx';
      args = ['next', 'dev', '-p', devPort.toString()];  // ✅ Next.js accepts -p
      needsPortArg = true;
    } else if (packageJson.devDependencies?.['react-scripts']) {
      // Create React App
      command = 'npx';
      args = ['react-scripts', 'start'];
      needsPortArg = false;  // Port set via PORT env var
    } else if (packageJson.scripts?.dev) {
      // Fallback: Use npm/pnpm/yarn run dev
      // Try to pass port via -- (works for most modern dev servers)
      command = 'npm';
      args = ['run', 'dev', '--', '--port', devPort.toString()];
      needsPortArg = true;
    } else if (packageJson.scripts?.start) {
      // Last resort: start script
      command = 'npm';
      args = ['run', 'start'];
      needsPortArg = false;  // Port set via PORT env var
    } else {
      return { 
        success: false,
        error: 'No suitable dev server command found. Please add a "dev" script to package.json' 
      };
    }
    
    // ✅ Store port for later use
    this.devServerPorts.set(projectId, devPort);
    
    // Start dev server with BROWSER=none to prevent auto-opening
    const devProcess = spawn(command, args, {
      cwd: localPath,
      shell: true,
      env: { 
        ...process.env,
        PORT: devPort.toString(),  // ✅ Set port via environment variable
        BROWSER: 'none',           // Prevent Vite/CRA from auto-opening browser
        OPEN: 'false'              // Alternative env var for some dev servers
      }
    });
    
    console.log(`[DevServerService] Process spawned for ${projectId}, PID: ${devProcess.pid}`);
    console.log(`[DevServerService] Command: ${command} ${args.join(' ')}`);
    
    this.devServers.set(projectId, devProcess);
    
    // Log when process starts
    
    // Capture stdout
    devProcess.stdout?.on('data', (data: Buffer) => {
      const message = data.toString();
      
      // ✅ Log to console for debugging
      console.log(`[DevServer:${projectId}] ${message.trim()}`);
      
      const log: LogEntry = {
        timestamp: new Date().toISOString(),
        type: 'stdout',
        message: message.trim()
      };
      
      const logs = this.devServerLogs.get(projectId) || [];
      logs.push(log);
      this.devServerLogs.set(projectId, logs);
      
      // ✅ Detect when server is ready (various dev server patterns)
      const readyPatterns = [
        /ready in \d+/i,           // Next.js: "Ready in 1771ms"
        /ready - started/i,         // Next.js (older): "ready - started server"
        /local:.*http/i,            // Vite: "Local: http://localhost:5173"
        /compiled successfully/i,   // Webpack: "Compiled successfully"
        /server running at/i,       // Generic
      ];
      
      const isReady = readyPatterns.some(pattern => pattern.test(message));
      
      if (isReady) {
        // Server is ready - notify UI immediately
        console.log(`[DevServerService] ✅ Dev server ready for ${projectId}`);
        this.onStatusChange?.(projectId);
      }
      
      // Also try to extract port from output (fallback)
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
            break;
          }
        }
      }
    });
    
    // Capture stderr
    devProcess.stderr?.on('data', (data: Buffer) => {
      const message = data.toString();
      
      // ✅ Log to console for debugging
      console.error(`[DevServer:${projectId}] ${message.trim()}`);
      
      // Check for port already in use error
      const portInUsePatterns = [
        /EADDRINUSE/i,
        /address already in use/i,
        /port.*already.*allocated/i,
        /bind.*EADDRINUSE/i,
        /Port \d+ is already in use/i
      ];
      
      const isPortInUse = portInUsePatterns.some(pattern => pattern.test(message));
      
      if (isPortInUse) {
        // Add clear error message for port in use
        const errorLog: LogEntry = {
          timestamp: new Date().toISOString(),
          type: 'stderr',
          message: `❌ Port ${devPort} is already in use. Please stop the other process using this port or choose a different port.`
        };
        
        const logs = this.devServerLogs.get(projectId) || [];
        logs.push(errorLog);
        this.devServerLogs.set(projectId, logs);
        
        // ✅ Kill the process - the 'exit' handler will do cleanup
        devProcess.kill();
        // Don't return here - let other stderr output be logged too
      }
      
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
      console.log(`[DevServerService] Process exited for ${projectId}, code: ${code}, signal: ${signal}`);
      
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
      console.error(`[DevServerService] Process error for ${projectId}:`, error);
      
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
    
    // ✅ Check if process is actually alive (not killed or exited)
    const isActuallyRunning = devProcess && 
                               !devProcess.killed && 
                               devProcess.exitCode === null;
    
    // ✅ If process is dead but still in map, clean it up
    if (devProcess && !isActuallyRunning) {
      console.log(`[DevServerService] Cleaning up dead process for ${projectId}`);
      this.devServers.delete(projectId);
      this.devServerPorts.delete(projectId);
    }
    
    return {
      running: !!isActuallyRunning,
      port: isActuallyRunning ? port : undefined,
      pid: isActuallyRunning ? devProcess?.pid : undefined
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

