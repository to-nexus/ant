import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { LogEntry } from '../../../../core/ports/http';
import { PortManager } from '../../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../../core/ports/portRegistry';
import { SSEService } from './SSEService';  // ✅ Import SSEService

/**
 * Package information for dev server
 */
interface PackageInfo {
  name: string;
  path: string;
  type: 'frontend' | 'backend' | 'other';
  packageJson: any;
  port?: number;
  process?: ChildProcess;
}

/**
 * Project structure detection result
 */
interface ProjectStructure {
  type: 'frontend-only' | 'backend-only' | 'fullstack' | 'monorepo';
  packages: PackageInfo[];
  entry?: PackageInfo;  // Entry point for Open button (usually frontend)
}

/**
 * DevServerService
 * 
 * Manages development servers for projects at feature/branch level.
 * 
 * Key Features:
 * - Multi-package support: Starts ALL runnable packages (frontend, backend, etc.)
 * - Smart detection: Identifies project structure (fullstack, monorepo, etc.)
 * - Entry point: Only the entry package (usually frontend) is registered for proxy
 * - Port management: Dynamic port allocation for all servers
 * - Process management: Tracks and manages all running processes
 */
export class DevServerService {
  private devServers: Map<string, ChildProcess[]> = new Map();  // Multiple processes per serverKey
  private devServerPorts: Map<string, number> = new Map();  // Entry port for proxy
  private devServerReady: Map<string, boolean> = new Map();  // ✅ Track ready state
  private devServerLogs: Map<string, LogEntry[]> = new Map();
  private installingProjects: Set<string> = new Set();
  private onStatusChange?: (serverKey: string) => void;
  private portManager?: PortManager;
  private portRegistry?: PortRegistryPort;
  private sseService?: SSEService;  // ✅ Use shared SSEService
  
  constructor(
    portManager?: PortManager,
    portRegistry?: PortRegistryPort,
    callbacks?: {
      onStatusChange?: (serverKey: string) => void;
    },
    sseService?: SSEService  // ✅ Accept SSEService
  ) {
    this.portManager = portManager;
    this.portRegistry = portRegistry;
    this.onStatusChange = callbacks?.onStatusChange;
    this.sseService = sseService;  // ✅ Store SSEService
  }
  
  /**
   * Create unique server key: tenantId:userId:projectId:feature
   */
  private createServerKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return `${tenantId}:${userId}:${projectId}:${feature}`;
  }
  
  /**
   * Parse server key into components
   */
  private parseServerKey(serverKey: string): { tenantId: string; userId: string; projectId: string; feature: string } {
    const [tenantId, userId, projectId, feature] = serverKey.split(':');
    return { tenantId, userId, projectId, feature };
  }
  
  /**
   * Append log entry and broadcast via SSEService
   */
  private appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message: message.trim()
    };
    
    const logs = this.devServerLogs.get(serverKey) || [];
    logs.push(logEntry);
    
    // Keep last 1000 lines
    if (logs.length > 1000) {
      logs.shift();
    }
    
    this.devServerLogs.set(serverKey, logs);
    
    // ✅ Broadcast via SSEService (if available)
    if (this.sseService) {
      const { projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'devServer', {
        type: 'log',
        data: logEntry
      });
    }
  }
  
  /**
   * Broadcast status update via SSEService
   */
  private broadcastStatus(serverKey: string, status: any): void {
    console.log(`[DevServerService] 📤 Broadcasting status update for ${serverKey}:`, status);
    
    // ✅ Broadcast via SSEService (if available)
    if (this.sseService) {
      const { projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'devServer', {
        type: 'status',
        data: status
      });
    }
    
    // Also trigger onStatusChange callback
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
  }
  
  /**
   * Detect if package is a frontend project
   */
  private isFrontendPackage(packageJson: any): boolean {
    const deps = { 
      ...packageJson.dependencies, 
      ...packageJson.devDependencies 
    };
    
    // Frontend frameworks
    const frontendFrameworks = [
      'react', 'react-dom',
      'vue', '@vue/runtime-core',
      'svelte',
      '@angular/core',
      'solid-js'
    ];
    
    // Build tools (strong indicators)
    const frontendBuildTools = [
      'vite', '@vitejs/plugin-react', '@vitejs/plugin-vue',
      'next', 'nuxt',
      'webpack', '@angular/cli',
      'parcel-bundler', 'parcel',
      '@remix-run/dev',
      'astro'
    ];
    
    const hasFrontend = frontendFrameworks.some(fw => deps[fw]) || 
                       frontendBuildTools.some(tool => deps[tool]);
    
    // Check dev script
    const devScript = packageJson.scripts?.dev || packageJson.scripts?.start || '';
    const isFrontendScript = devScript.includes('vite') || 
                            devScript.includes('next') || 
                            devScript.includes('webpack') ||
                            devScript.includes('react-scripts') ||
                            devScript.includes('vue-cli-service') ||
                            devScript.includes('ng serve') ||
                            devScript.includes('astro');
    
    return hasFrontend || isFrontendScript;
  }
  
  /**
   * Detect if package is a backend project
   */
  private isBackendPackage(packageJson: any): boolean {
    const deps = { 
      ...packageJson.dependencies, 
      ...packageJson.devDependencies 
    };
    
    // Backend frameworks
    const backendFrameworks = [
      'express', 'koa', 'fastify', 'hapi',
      '@nestjs/core', '@nestjs/platform-express',
      'ws', 'socket.io'
    ];
    
    const hasBackend = backendFrameworks.some(fw => deps[fw]);
    
    // Check dev script
    const devScript = packageJson.scripts?.dev || '';
    const isBackendScript = devScript.includes('tsx') || 
                           devScript.includes('nodemon') || 
                           devScript.includes('ts-node') ||
                           devScript.includes('nest start');
    
    return hasBackend || isBackendScript;
  }
  
  /**
   * Find immediate subdirectories
   */
  private async findSubdirectories(parentPath: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(parentPath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map(entry => entry.name);
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Resolve workspace pattern (e.g., "packages/*")
   */
  private async resolveWorkspacePattern(basePath: string, pattern: string): Promise<string[]> {
    if (!pattern.includes('*')) {
      const fullPath = path.join(basePath, pattern);
      return fs.existsSync(fullPath) ? [fullPath] : [];
    }
    
    const baseDir = pattern.replace('/*', '');
    const baseDirPath = path.join(basePath, baseDir);
    
    if (!fs.existsSync(baseDirPath)) return [];
    
    const subdirs = await this.findSubdirectories(baseDirPath);
    return subdirs.map(subdir => path.join(baseDirPath, subdir));
  }
  
  /**
   * Detect monorepo structure
   */
  private async detectMonorepoStructure(localPath: string, rootPkgJson: any): Promise<ProjectStructure> {
    const packages: PackageInfo[] = [];
    const workspacePatterns = Array.isArray(rootPkgJson.workspaces) 
      ? rootPkgJson.workspaces 
      : (rootPkgJson.workspaces.packages || []);
    
    for (const pattern of workspacePatterns) {
      const resolvedPaths = await this.resolveWorkspacePattern(localPath, pattern);
      
      for (const wsPath of resolvedPaths) {
        const pkgJsonPath = path.join(wsPath, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;
        
        try {
          const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf-8'));
          const pkgName = path.relative(localPath, wsPath);
          
          let pkgType: 'frontend' | 'backend' | 'other' = 'other';
          if (this.isFrontendPackage(pkgJson)) {
            pkgType = 'frontend';
          } else if (this.isBackendPackage(pkgJson)) {
            pkgType = 'backend';
          }
          
          // Only include packages with dev script
          if (pkgJson.scripts?.dev || pkgJson.scripts?.start) {
            packages.push({
              name: pkgName,
              path: wsPath,
              type: pkgType,
              packageJson: pkgJson
            });
          }
        } catch (error) {
          continue;
        }
      }
    }
    
    // Entry is the first frontend package
    const entry = packages.find(p => p.type === 'frontend');
    
    console.log(`[DevServerService] Monorepo detected: ${packages.length} packages`);
    packages.forEach(pkg => {
      console.log(`  - ${pkg.name} (${pkg.type})${pkg === entry ? ' ← ENTRY' : ''}`);
    });
    
    return { type: 'monorepo', packages, entry };
  }
  
  /**
   * Detect project structure
   */
  private async detectProjectStructure(localPath: string): Promise<ProjectStructure> {
    const rootPkgPath = path.join(localPath, 'package.json');
    if (!fs.existsSync(rootPkgPath)) {
      throw new Error('package.json not found');
    }
    
    const rootPkgJson = JSON.parse(await fs.promises.readFile(rootPkgPath, 'utf-8'));
    
    // Check if monorepo
    if (rootPkgJson.workspaces) {
      return await this.detectMonorepoStructure(localPath, rootPkgJson);
    }
    
    // Check subdirectories for fullstack
    const subdirs = await this.findSubdirectories(localPath);
    const packages: PackageInfo[] = [];
    
    for (const subdir of subdirs) {
      const subdirPath = path.join(localPath, subdir);
      const pkgJsonPath = path.join(subdirPath, 'package.json');
      
      if (!fs.existsSync(pkgJsonPath)) continue;
      
      try {
        const pkgJson = JSON.parse(await fs.promises.readFile(pkgJsonPath, 'utf-8'));
        
        // Only include packages with dev script
        if (!pkgJson.scripts?.dev && !pkgJson.scripts?.start) continue;
        
        let pkgType: 'frontend' | 'backend' | 'other' = 'other';
        if (this.isFrontendPackage(pkgJson)) {
          pkgType = 'frontend';
        } else if (this.isBackendPackage(pkgJson)) {
          pkgType = 'backend';
        }
        
        packages.push({
          name: subdir,
          path: subdirPath,
          type: pkgType,
          packageJson: pkgJson
        });
      } catch (error) {
        continue;
      }
    }
    
    // Determine type
    const hasFrontend = packages.some(p => p.type === 'frontend');
    const hasBackend = packages.some(p => p.type === 'backend');
    
    if (hasFrontend && hasBackend) {
      const entry = packages.find(p => p.type === 'frontend');
      console.log(`[DevServerService] Fullstack detected: ${packages.length} packages`);
      packages.forEach(pkg => {
        console.log(`  - ${pkg.name} (${pkg.type})${pkg === entry ? ' ← ENTRY' : ''}`);
      });
      return { type: 'fullstack', packages, entry };
    }
    
    if (packages.length > 0) {
      const entry = packages[0];
      const type = hasFrontend ? 'frontend-only' : hasBackend ? 'backend-only' : 'frontend-only';
      console.log(`[DevServerService] ${type} detected: ${packages.length} package(s)`);
      return { type, packages, entry };
    }
    
    // Treat root as single package
    const pkgType = this.isFrontendPackage(rootPkgJson) ? 'frontend' : 
                   this.isBackendPackage(rootPkgJson) ? 'backend' : 'frontend';
    
    const pkg: PackageInfo = {
      name: 'root',
      path: localPath,
      type: pkgType,
      packageJson: rootPkgJson
    };
    
    console.log(`[DevServerService] Single package detected (${pkgType})`);
    
    return { 
      type: pkgType === 'backend' ? 'backend-only' : 'frontend-only', 
      packages: [pkg], 
      entry: pkg 
    };
  }
  
  /**
   * Install dependencies if needed
   */
  private async installDependenciesIfNeeded(packagePath: string, serverKey: string): Promise<void> {
    const nodeModulesPath = path.join(packagePath, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      console.log(`[DevServerService] Dependencies already installed: ${packagePath}`);
      return;
    }
    
    const relativePath = path.basename(packagePath);
    console.log(`[DevServerService] Installing dependencies: ${relativePath}...`);
    
    this.appendLog(serverKey, 'stdout', `📦 Installing dependencies for ${relativePath}...`);
    
    return new Promise((resolve, reject) => {
      const installProcess = spawn('npm', ['install'], {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe'
      });
      
      installProcess.stdout?.on('data', (data) => {
        this.appendLog(serverKey, 'stdout', data.toString());
      });
      
      installProcess.stderr?.on('data', (data) => {
        this.appendLog(serverKey, 'stderr', data.toString());
      });
      
      installProcess.on('close', (code) => {
        if (code === 0) {
          this.appendLog(serverKey, 'stdout', `✅ Dependencies installed for ${relativePath}`);
          resolve();
        } else {
          reject(new Error(`npm install failed with code ${code}`));
        }
      });
      
      installProcess.on('error', reject);
    });
  }
  
  /**
   * Health check: Try to connect to dev server
   */
  private async healthCheck(port: number, serverKey: string, maxAttempts = 20, delayMs = 500): Promise<boolean> {
    console.log(`[DevServerService] 🏥 Health check starting for port ${port}...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000)  // 2s timeout per attempt
        });
        
        // Any response (even 404) means server is up
        console.log(`[DevServerService] ✅ Health check passed (attempt ${attempt}/${maxAttempts}): ${response.status}`);
        this.appendLog(serverKey, 'stdout', `✅ Dev server is ready on port ${port}`);
        return true;
      } catch (error: any) {
        console.log(`[DevServerService] ⚠️ Health check attempt ${attempt}/${maxAttempts} failed:`, error.message);
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    console.error(`[DevServerService] ❌ Health check failed after ${maxAttempts} attempts`);
    this.appendLog(serverKey, 'stderr', `❌ Dev server failed to respond on port ${port} after ${maxAttempts * delayMs / 1000}s`);
    return false;
  }
  
  /**
   * Spawn dev process for a package
   */
  private async spawnDevProcess(pkg: PackageInfo, port: number, serverKey: string): Promise<ChildProcess> {
    const pkgJson = pkg.packageJson;
    const devScript = pkgJson.scripts?.dev || pkgJson.scripts?.start;
    
    let command: string;
    let args: string[] = [];
    
    // Determine command based on package type and script content
    if (pkg.type === 'frontend') {
      if (devScript?.includes('vite')) {
        command = 'npx';
        // ✅ No --base: Let proxy handle path rewriting
        args = ['vite', '--port', port.toString(), '--host'];
      } else if (devScript?.includes('next')) {
        command = 'npx';
        args = ['next', 'dev', '-p', port.toString()];
      } else if (devScript?.includes('react-scripts')) {
        command = 'npm';
        args = ['run', 'dev'];
      } else {
        command = 'npm';
        args = ['run', 'dev'];
      }
    } else if (pkg.type === 'backend') {
      command = 'npm';
      args = ['run', 'dev'];
    } else {
      command = 'npm';
      args = ['run', 'dev'];
    }
    
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      PORT: port.toString(),
      NODE_ENV: 'development',
      // ✅ Prevent auto-opening browser (Vite, CRA, Next.js)
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
    };
    
    console.log(`[DevServerService] Starting ${pkg.type}: ${pkg.name} on port ${port}`);
    this.appendLog(serverKey, 'stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    
    console.log(`[DevServerService] 🔧 Spawning: ${command} ${args.join(' ')} in ${pkg.path}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      env,
      stdio: 'pipe'
    });
    
    console.log(`[DevServerService] ✅ Process spawned with PID: ${childProcess.pid}`);
    
    // Setup logging
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log(`[DevServerService] 📤 stdout (PID ${childProcess.pid}):`, output.substring(0, 100));
      this.appendLog(serverKey, 'stdout', output);
    });
    
    childProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      console.log(`[DevServerService] 📤 stderr (PID ${childProcess.pid}):`, output.substring(0, 100));
      this.appendLog(serverKey, 'stderr', output);
    });
    
    childProcess.on('close', (code) => {
      console.log(`[DevServerService] ❌ Process ${childProcess.pid} exited with code ${code}`);
      this.appendLog(serverKey, 'stdout', `⚠️  ${pkg.name} exited with code ${code}`);
    });
    
    childProcess.on('error', (error) => {
      console.error(`[DevServerService] ❌ Process ${childProcess.pid} error:`, error);
      this.appendLog(serverKey, 'stderr', `❌ ${pkg.name} error: ${error.message}`);
    });
    
    return childProcess;
  }
  
  /**
   * Start dev server for a project feature
   * 
   * This method:
   * 1. Detects project structure (fullstack, monorepo, etc.)
   * 2. Installs dependencies for ALL packages
   * 3. Starts dev servers for ALL packages
   * 4. Registers only the ENTRY package in PortRegistry (for proxy)
   */
  async startDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    localPath: string,
    port?: number
  ): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    port?: number;
    serverKey?: string;
    url?: string;
  }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const proxyUrl = `/dev/${serverKey}`;
    
    // Check if already running
    if (this.devServers.has(serverKey)) {
      const existingPort = this.devServerPorts.get(serverKey);
      return { 
        success: false, 
        error: 'Dev server already running', 
        port: existingPort,
        serverKey,
        url: proxyUrl
      };
    }
    
    // Check if installing
    if (this.installingProjects.has(serverKey)) {
      return { success: false, error: 'Dependencies are being installed. Please wait...' };
    }
    
    this.installingProjects.add(serverKey);
    this.devServerLogs.set(serverKey, []);
    
    try {
      // 1. Detect project structure
      const structure = await this.detectProjectStructure(localPath);
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 2. Install dependencies for all packages
      for (const pkg of structure.packages) {
        await this.installDependenciesIfNeeded(pkg.path, serverKey);
      }
      
      this.installingProjects.delete(serverKey);
      
      // 3. Allocate ports and start all dev servers
      const processes: ChildProcess[] = [];
      
      for (const pkg of structure.packages) {
        const pkgPort = this.portManager 
          ? await this.portManager.allocate() 
          : 3000 + processes.length;
        
        pkg.port = pkgPort;
        
        const process = await this.spawnDevProcess(pkg, pkgPort, serverKey);
        pkg.process = process;
        processes.push(process);
      }
      
      // 4. Register only the ENTRY in PortRegistry
      if (structure.entry && this.portRegistry) {
        await this.portRegistry.registerDevServer(
          tenantId, userId, projectId, feature,
          structure.entry.port!
        );
        console.log(`[DevServerService] ✅ Registered entry: ${serverKey} → ${structure.entry.port}`);
      }
      
      // 5. Store processes and entry port
      this.devServers.set(serverKey, processes);
      this.devServerPorts.set(serverKey, structure.entry?.port || structure.packages[0].port!);
      
      this.appendLog(serverKey, 'stdout', '✅ All dev servers started successfully!');
      
      // ✅ 6. Health check for entry package (async, don't block response)
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthCheck(entryPort, serverKey).then(ready => {
        this.devServerReady.set(serverKey, ready);
        
        // ✅ Broadcast updated status via SSE
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        console.log(`[DevServerService] 📡 Broadcasting ready status: ${ready}`);
        this.broadcastStatus(serverKey, updatedStatus);
        
        if (this.onStatusChange) {
          this.onStatusChange(serverKey);
        }
      });
      
      return {
        success: true,
        message: `Started ${structure.packages.length} package(s)`,
        port: structure.entry?.port || structure.packages[0].port!,
        serverKey,
        url: proxyUrl
      };
      
    } catch (error: any) {
      this.installingProjects.delete(serverKey);
      console.error('[DevServerService] Error starting dev server:', error);
      this.appendLog(serverKey, 'stderr', `❌ Error: ${error.message}`);
      
      return {
        success: false,
        error: error.message || 'Failed to start dev server'
      };
    }
  }
  
  /**
   * Stop dev server
   * Kills ALL processes associated with the serverKey
   */
  async stopDevServer(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    const processes = this.devServers.get(serverKey);
    if (!processes || processes.length === 0) {
      return { success: false, error: 'Dev server not running' };
    }
    
    // Kill all processes
    for (const process of processes) {
      try {
        process.kill();
      } catch (error) {
        console.warn(`[DevServerService] Failed to kill process:`, error);
      }
    }
    
    // Release ports
    const port = this.devServerPorts.get(serverKey);
    if (port && this.portManager) {
      await this.portManager.release(port);
    }
    
    // Unregister from PortRegistry
    if (this.portRegistry) {
      await this.portRegistry.unregisterDevServer(tenantId, userId, projectId, feature);
    }
    
    // Cleanup
    this.devServers.delete(serverKey);
    this.devServerPorts.delete(serverKey);
    this.devServerReady.delete(serverKey);  // ✅ Clear ready state
    this.devServerLogs.delete(serverKey);
    
    console.log(`[DevServerService] ✅ Stopped all servers for ${serverKey}`);
    
    if (this.onStatusChange) {
      this.onStatusChange(serverKey);
    }
    
    return { 
      success: true, 
      message: `Stopped ${processes.length} process(es)` 
    };
  }
  
  /**
   * Get dev server status
   */
  getDevServerStatus(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): {
    running: boolean;  // ✅ Changed from isRunning to running
    ready: boolean;    // ✅ NEW: Health check passed
    port?: number;
    url?: string;
    processCount?: number;
  } {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const processes = this.devServers.get(serverKey);
    const port = this.devServerPorts.get(serverKey);
    const ready = this.devServerReady.get(serverKey) || false;  // ✅ Get health check status
    
    const running = !!processes && processes.length > 0;
    
    return {
      running,
      ready,  // ✅ Real health check result
      port,
      url: port ? `/dev/${serverKey}` : undefined,
      processCount: processes?.length || 0
    };
  }
  
  /**
   * Get logs for a dev server
   */
  getDevServerLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string
  ): LogEntry[] {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    return this.devServerLogs.get(serverKey) || [];
  }
  
  /**
   * Stream logs via SSE (using shared SSEService)
   * 
   * Note: This method is now deprecated in favor of unified SSE endpoint
   * DevServer updates are now sent via SSEService.broadcast()
   */
  streamDevServerLogs(
    tenantId: string,
    userId: string,
    projectId: string,
    feature: string,
    res: Response
  ): void {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    
    console.log(`[DevServerService] 📡 SSE connection opened for ${serverKey}`);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial status
    const status = this.getDevServerStatus(tenantId, userId, projectId, feature);
    console.log(`[DevServerService] 📤 Sending initial status:`, status);
    res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    
    // Send existing logs
    const existingLogs = this.devServerLogs.get(serverKey) || [];
    console.log(`[DevServerService] 📤 Sending ${existingLogs.length} existing logs`);
    existingLogs.forEach(log => {
      res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
    });
    
    // ✅ Register client with SSEService for future updates
    // Updates will come via SSEService.broadcast() calls from appendLog() and broadcastStatus()
    if (this.sseService) {
      this.sseService.registerClient(projectId, feature, res);
      console.log(`[DevServerService] ✅ Client registered with SSEService`);
    }
  }
  
  /**
   * Cleanup all dev servers (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    const serverKeys = Array.from(this.devServers.keys());
    
    if (serverKeys.length === 0) {
      console.log('[DevServerService] No running dev servers to cleanup');
      return;
    }
    
    console.log(`[DevServerService] 🧹 Cleaning up ${serverKeys.length} dev server(s)...`);
    
    const cleanupPromises: Promise<void>[] = [];
    
    for (const serverKey of serverKeys) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      
      const cleanupPromise = this.stopDevServer(tenantId, userId, projectId, feature)
        .then(() => {
          console.log(`[DevServerService]    ✅ Stopped: ${serverKey}`);
        })
        .catch((error) => {
          console.error(`[DevServerService]    ❌ Failed to stop ${serverKey}:`, error.message);
        });
      
      cleanupPromises.push(cleanupPromise);
    }
    
    await Promise.all(cleanupPromises);
    
    // Close PortRegistry connection if exists
    if (this.portRegistry && typeof this.portRegistry.close === 'function') {
      try {
        await this.portRegistry.close();
        console.log('[DevServerService]    ✅ PortRegistry closed');
      } catch (error: any) {
        console.error('[DevServerService]    ❌ PortRegistry close error:', error.message);
      }
    }
    
    console.log(`[DevServerService] ✅ Cleanup complete (${serverKeys.length} server(s) stopped)`);
  }
}
