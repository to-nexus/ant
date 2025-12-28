import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';
import { SSEService } from '../SSEService';
import { PackageInfo, ProjectStructure, ValidationResult } from './types';
import { createServerKey, parseServerKey } from './utils/serverKeyUtils';
import { LogManager } from './managers/LogManager';
import { PackageDetector } from './detectors/PackageDetector';
import { ProjectValidator } from './validators/ProjectValidator';
import { logger } from '../../../../../utils/logger';

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
  private installingProjects: Set<string> = new Set();
  private onStatusChange?: (serverKey: string) => void;
  private portManager?: PortManager;
  private portRegistry?: PortRegistryPort;
  private sseService?: SSEService;  // ✅ Use shared SSEService
  
  // ✅ Refactored modules
  private logManager: LogManager;
  private packageDetector: PackageDetector;
  private projectValidator: ProjectValidator;
  
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
    
    // ✅ Initialize refactored modules
    this.logManager = new LogManager();
    this.packageDetector = new PackageDetector();
    this.projectValidator = new ProjectValidator();
  }
  
  /**
   * Create unique server key: tenantId:userId:projectId:feature
   */
  private createServerKey(tenantId: string, userId: string, projectId: string, feature: string): string {
    return createServerKey(tenantId, userId, projectId, feature);
  }
  
  /**
   * Parse server key into components
   */
  private parseServerKey(serverKey: string): { tenantId: string; userId: string; projectId: string; feature: string } {
    return parseServerKey(serverKey);
  }
  
  /**
   * Append log entry and broadcast via SSEService
   */
  private appendLog(serverKey: string, type: 'stdout' | 'stderr', message: string): void {
    const logEntry = this.logManager.appendLog(serverKey, type, message);
    
    // ✅ Broadcast via SSEService (if available)
    if (this.sseService) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'devServer', {
        type: 'log',
        data: logEntry
      }, { organizationId: tenantId, userId, workspacePath: '' });
    }
  }
  
  /**
   * Broadcast status update via SSEService
   */
  private broadcastStatus(serverKey: string, status: any): void {
    logger.debug('Broadcasting status update', { component: 'DevServerService' }, { serverKey, status });
    
    // ✅ Broadcast via SSEService (if available)
    if (this.sseService) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      this.sseService.broadcast(projectId, feature, 'devServer', {
        type: 'status',
        data: status
      }, { organizationId: tenantId, userId, workspacePath: '' });
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
    return this.packageDetector.isFrontendPackage(packageJson);
  }
  
  /**
   * Detect framework type from package.json
   */
  private detectFrameworkType(packageJson: any): 'react' | 'vue' | 'svelte' | 'next' | 'nuxt' | 'unknown' {
    return this.packageDetector.detectFrameworkType(packageJson);
  }
  
  /**
   * Validate dev server setup for frontend projects
   * Checks if basename configuration is present in router setup
   */
  async validateDevServerSetup(codebasePath: string): Promise<ValidationResult> {
    return await this.projectValidator.validate(codebasePath);
  }
  
  /**
   * Detect if package is a backend project
   */
  private isBackendPackage(packageJson: any): boolean {
    return this.packageDetector.isBackendPackage(packageJson);
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
    const workspacePatterns = this.getWorkspacePatterns(localPath, rootPkgJson);
    
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
    
    logger.debug(`Monorepo detected (${packages.length} packages)`, { component: 'DevServerService' });
    
    return { type: 'monorepo', packages, entry };
  }
  
  /**
   * Get workspace patterns from package.json workspaces or pnpm-workspace.yaml
   *
   * ✅ Server-side source of truth for monorepo detection (UI should not special-case)
   */
  private getWorkspacePatterns(localPath: string, rootPkgJson: any): string[] {
    // 1) package.json workspaces (yarn/npm/pnpm)
    if (rootPkgJson?.workspaces) {
      return Array.isArray(rootPkgJson.workspaces)
        ? rootPkgJson.workspaces
        : (rootPkgJson.workspaces.packages || []);
    }
    
    // 2) pnpm-workspace.yaml
    const pnpmWsPath = path.join(localPath, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWsPath)) {
      try {
        const raw = fs.readFileSync(pnpmWsPath, 'utf8');
        return this.parsePnpmWorkspaceYaml(raw);
      } catch {
        return [];
      }
    }
    
    return [];
  }
  
  /**
   * Minimal parser for pnpm-workspace.yaml
   * We only need the "packages:" list (e.g. apps/*, packages/*).
   *
   * Example:
   * packages:
   *   - 'apps/*'
   *   - "packages/*"
   */
  private parsePnpmWorkspaceYaml(yamlText: string): string[] {
    const lines = yamlText.split(/\r?\n/);
    const patterns: string[] = [];
    let inPackages = false;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      if (!inPackages) {
        if (/^packages\s*:/.test(trimmed)) {
          inPackages = true;
        }
        continue;
      }
      
      // Stop when we hit another top-level key (non-list and no indentation)
      if (!/^- /.test(trimmed) && /^[a-zA-Z0-9_-]+\s*:/.test(trimmed)) {
        break;
      }
      
      const m = trimmed.match(/^- \s*['"]?([^'"]+)['"]?\s*$/);
      if (m?.[1]) {
        patterns.push(m[1]);
      }
    }
    
    return patterns;
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
    
    // Check if monorepo (package.json workspaces OR pnpm-workspace.yaml)
    const workspacePatterns = this.getWorkspacePatterns(localPath, rootPkgJson);
    if (workspacePatterns.length > 0) {
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
      logger.debug(`Fullstack detected (${packages.length} packages)`, { component: 'DevServerService' });
      return { type: 'fullstack', packages, entry };
    }
    
    if (packages.length > 0) {
      const entry = packages[0];
      const type = hasFrontend ? 'frontend-only' : hasBackend ? 'backend-only' : 'frontend-only';
      logger.debug(`${type} detected (${packages.length} package(s))`, { component: 'DevServerService' });
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
    
    logger.debug(`Single package detected (${pkgType})`, { component: 'DevServerService' });
    
    return { 
      type: pkgType === 'backend' ? 'backend-only' : 'frontend-only', 
      packages: [pkg], 
      entry: pkg 
    };
  }
  
  /**
   * Identify critical dependencies that must be present for dev server
   */
  private identifyCriticalDeps(packageJson: any): string[] {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const critical = [];
    
    // Build tools (must have for dev server)
    if (deps['vite']) critical.push('vite');
    if (deps['webpack']) critical.push('webpack');
    if (deps['next']) critical.push('next');
    if (deps['@vue/cli-service']) critical.push('@vue/cli-service');
    
    // Frameworks (must have)
    if (deps['react']) critical.push('react');
    if (deps['vue']) critical.push('vue');
    if (deps['svelte']) critical.push('svelte');
    
    return critical;
  }
  
  /**
   * Run npm install with proper flags
   */
  private async runNpmInstall(packagePath: string, serverKey: string, relativePath: string): Promise<void> {
    this.appendLog(serverKey, 'stdout', `📦 Installing dependencies for ${relativePath}...`);
    
    return new Promise((resolve, reject) => {
      // ✅ CRITICAL: Include devDependencies for dev server
      const installProcess = spawn('npm', ['install', '--include=dev'], {
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
   * Install dependencies if needed
   * 
   * Enhanced to verify critical dependencies are actually installed,
   * not just check if node_modules directory exists.
   */
  private async installDependenciesIfNeeded(packagePath: string, serverKey: string, displayName?: string): Promise<void> {
    const nodeModulesPath = path.join(packagePath, 'node_modules');
    // ✅ Use stable package name from structure detection to avoid UI progress double-counting
    // (e.g., cloud projects where basename(packagePath) === "codebase" but package name is "root")
    const relativePath = displayName || path.basename(packagePath);
    
    // Check if node_modules exists
    if (!fs.existsSync(nodeModulesPath)) {
      logger.info(`Installing dependencies (no node_modules): ${relativePath}`, { component: 'DevServerService' });
      return this.runNpmInstall(packagePath, serverKey, relativePath);
    }
    
    // ✅ NEW: Verify critical dependencies are actually installed
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      logger.warn(`No package.json found at ${packagePath}`, { component: 'DevServerService' });
      return;
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const criticalDeps = this.identifyCriticalDeps(packageJson);
    
    // Check if critical deps exist in node_modules
    const missingDeps = criticalDeps.filter(dep => 
      !fs.existsSync(path.join(nodeModulesPath, dep))
    );
    
    if (missingDeps.length > 0) {
      logger.info(`Missing critical deps for ${relativePath}: ${missingDeps.join(', ')} (re-install)`, { component: 'DevServerService' });
      this.appendLog(serverKey, 'stdout', `⚠️  Missing critical dependencies: ${missingDeps.join(', ')}`);
      return this.runNpmInstall(packagePath, serverKey, relativePath);
    }
    
    logger.debug(`Dependencies already installed: ${packagePath}`, { component: 'DevServerService' });
  }
  
  /**
   * Health check: Try to connect to dev server
   */
  private async healthCheck(port: number, serverKey: string, maxAttempts = 20, delayMs = 500): Promise<boolean> {
    logger.debug(`Health check starting for port ${port}`, { component: 'DevServerService' });
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000)  // 2s timeout per attempt
        });
        
        // Any response (even 404) means server is up
        logger.debug(`Health check passed (${attempt}/${maxAttempts}): ${response.status}`, { component: 'DevServerService' });
        this.appendLog(serverKey, 'stdout', `✅ Dev server is ready on port ${port}`);
        return true;
      } catch (error: any) {
        logger.debug(`Health check failed (${attempt}/${maxAttempts}): ${error.message}`, { component: 'DevServerService' });
        
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    logger.warn(`Health check failed after ${maxAttempts} attempts`, { component: 'DevServerService' });
    this.appendLog(serverKey, 'stderr', `❌ Dev server failed to respond on port ${port} after ${maxAttempts * delayMs / 1000}s`);
    return false;
  }
  
  /**
   * Spawn dev process for a package
   */
  private async spawnDevProcess(
    pkg: PackageInfo,
    port: number,
    serverKey: string,
    extraEnv?: Record<string, string | undefined>
  ): Promise<ChildProcess> {
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
      ...process.env,
      PORT: port.toString(),
      NODE_ENV: 'development',
      // ✅ Prevent auto-opening browser (Vite, CRA, Next.js)
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
      ...(extraEnv || {})
    };
    
    logger.info(`Starting ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'DevServerService' });
    this.appendLog(serverKey, 'stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    
    logger.debug(`Spawning: ${command} ${args.join(' ')} in ${pkg.path}`, { component: 'DevServerService' });
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      env,
      stdio: 'pipe'
    });
    
    logger.debug(`Process spawned PID=${childProcess.pid}`, { component: 'DevServerService' });
    
    // Setup logging
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      this.appendLog(serverKey, 'stdout', output);
    });
    
    childProcess.stderr?.on('data', (data) => {
      const output = data.toString();
      this.appendLog(serverKey, 'stderr', output);
    });
    
    childProcess.on('close', (code) => {
      logger.info(`Process exited PID=${childProcess.pid} code=${code}`, { component: 'DevServerService' });
      // ✅ Treat non-zero exits as errors so UI can surface failure reliably
      if (code !== 0 && code !== null) {
        this.appendLog(serverKey, 'stderr', `❌ ${pkg.name} exited with code ${code}`);
      } else {
        this.appendLog(serverKey, 'stdout', `⚠️  ${pkg.name} exited with code ${code}`);
      }
      
      // ✅ Proactively broadcast status so frontend can stop "Starting..." even if health-check never completes
      try {
        const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      } catch (e: any) {
        // Don't crash on exit handler
      }
      
      // ✅ Best-effort: release the port if we allocated it
      if (this.portManager) {
        void Promise.resolve(this.portManager.release(port)).catch(() => {});
      }
    });
    
    childProcess.on('error', (error) => {
      logger.error(`Process error PID=${childProcess.pid}: ${error.message}`, { component: 'DevServerService' }, error);
      this.appendLog(serverKey, 'stderr', `❌ ${pkg.name} error: ${error.message}`);
      
      // ✅ Broadcast status on process error as well
      try {
        const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      } catch (e: any) {
        // Ignore
      }
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
    setupReasoning?: string;  // Categorized failure code (e.g., 'basename-missing')
    setupReason?: string;     // Human-readable message
    suggestedFix?: string;
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
    // Logs are now managed by logManager
    
    try {
      // 1. Detect project structure
      const structure = await this.detectProjectStructure(localPath);
      
      if (structure.packages.length === 0) {
        throw new Error('No runnable packages found');
      }
      
      // 2. Install dependencies for all packages
      for (const pkg of structure.packages) {
        await this.installDependenciesIfNeeded(pkg.path, serverKey, pkg.name);
      }
      
      this.installingProjects.delete(serverKey);
      
      // 3. Allocate ports and start all dev servers
      const processes: ChildProcess[] = [];
      let backendPort: number | undefined;
      
      // ✅ Start backend first so frontend can be configured with the correct API port
      const orderedPackages = [...structure.packages].sort((a, b) => {
        const prio = (p: PackageInfo) => (p.type === 'backend' ? 0 : p.type === 'frontend' ? 1 : 2);
        return prio(a) - prio(b);
      });
      
      for (const pkg of orderedPackages) {
        const pkgPort = this.portManager 
          ? await this.portManager.allocate() 
          : 3000 + processes.length;
        
        pkg.port = pkgPort;
        
        if (!backendPort && pkg.type === 'backend') {
          backendPort = pkgPort;
        }
        
        const extraEnv: Record<string, string | undefined> = {};
        
        // ✅ Inject backend port into frontend so in-app API clients can call the correct backend
        // Keeps project source unchanged; only affects Ant-managed dev server sessions.
        if (pkg.type === 'frontend' && backendPort) {
          extraEnv.VITE_API_BASE_URL = `http://localhost:${backendPort}`;
        }
        
        const process = await this.spawnDevProcess(pkg, pkgPort, serverKey, extraEnv);
        pkg.process = process;
        processes.push(process);
      }
      
      // 4. Register only the ENTRY in PortRegistry
      if (structure.entry && this.portRegistry) {
        await this.portRegistry.registerDevServer(
          tenantId, userId, projectId, feature,
          structure.entry.port!
        );
        logger.info(`Registered entry: ${serverKey} -> ${structure.entry.port}`, { component: 'DevServerService' });
      }
      
      // 5. Store processes and entry port
      this.devServers.set(serverKey, processes);
      this.devServerPorts.set(serverKey, structure.entry?.port || structure.packages[0].port!);
      
      this.appendLog(serverKey, 'stdout', '✅ All dev servers started successfully!');
      
      // ✅ 6. Validate dev server setup for frontend entry package ONLY
      // This happens AFTER server is running to allow Fix workflow
      let validation: ValidationResult = { valid: true };
      
      if (structure.entry?.type === 'frontend') {
        // Validate entry package path (not root)
        const entryPath = structure.entry.path;
        validation = await this.validateDevServerSetup(entryPath);
        logger.debug(`Frontend entry validation result`, { component: 'DevServerService' }, validation);
        
        // ❌ If validation fails, stop the server and return error
        if (!validation.valid) {
          logger.info(`Frontend setup validation failed - stopping server`, { component: 'DevServerService' });
          
          // Stop all processes
          for (const process of processes) {
            if (process && !process.killed) {
              process.kill();
            }
          }
          
          // Clean up
          this.devServers.delete(serverKey);
          this.devServerPorts.delete(serverKey);
          this.devServerReady.delete(serverKey);
          this.logManager.clearLogs(serverKey);
          
          if (this.portRegistry) {
            await this.portRegistry.unregisterDevServer(tenantId, userId, projectId, feature);
          }
          
          return {
            success: false,
            error: 'Dev server setup validation failed',
            setupReasoning: validation.reasoning || 'unknown',
            setupReason: validation.reason,
            suggestedFix: validation.suggestedFix,
            serverKey,
          };
        }
      } else {
        logger.debug(`Skipping validation (entry is not frontend)`, { component: 'DevServerService' });
      }
      
      // ✅ 7. Health check for entry package (async, don't block response)
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthCheck(entryPort, serverKey).then(ready => {
        this.devServerReady.set(serverKey, ready);
        
        // ✅ Broadcast updated status via SSE
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        logger.debug(`Broadcasting ready status: ${ready}`, { component: 'DevServerService' });
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
        url: proxyUrl,
        setupReasoning: validation.reasoning,  // Only set if validation failed
        setupReason: validation.reason,        // Only set if validation failed
        suggestedFix: validation.suggestedFix  // Only set if validation failed
      };
      
    } catch (error: any) {
      this.installingProjects.delete(serverKey);
      logger.error(`Error starting dev server: ${error.message}`, { component: 'DevServerService' }, error);
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
        logger.warn(`Failed to kill process`, { component: 'DevServerService' }, error);
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
    this.logManager.clearLogs(serverKey);  // ✅ Clear logs via logManager
    
    logger.info(`Stopped all servers for ${serverKey}`, { component: 'DevServerService' });
    
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
    return this.logManager.getLogs(serverKey);
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
    
    logger.debug(`SSE connection opened for ${serverKey}`, { component: 'DevServerService' });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial status
    const status = this.getDevServerStatus(tenantId, userId, projectId, feature);
    logger.debug(`Sending initial status`, { component: 'DevServerService' }, { serverKey, status });
    // ✅ Match unified SSEService envelope so frontend can consume it consistently
    if (this.sseService) {
      this.sseService.sendInitialState(res, 'devServer', { type: 'status', data: status });
    } else {
      // Fallback: legacy (no envelope)
      res.write(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`);
    }
    
    // Send existing logs
    const existingLogs = this.logManager.getLogs(serverKey);
    logger.debug(`Sending ${existingLogs.length} existing logs`, { component: 'DevServerService' }, { serverKey });
    existingLogs.forEach((log: LogEntry) => {
      if (this.sseService) {
        this.sseService.sendInitialState(res, 'devServer', { type: 'log', data: log });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'log', data: log })}\n\n`);
      }
    });
    
    // ✅ Register client with SSEService for future updates
    // Updates will come via SSEService.broadcast() calls from appendLog() and broadcastStatus()
    if (this.sseService) {
      // ✅ IMPORTANT: pass tenant/user to match broadcast scoping keys (cloud workspace isolation)
      this.sseService.registerClient(projectId, feature, res, { organizationId: tenantId, userId, workspacePath: '' });
      logger.debug(`Client registered with SSEService`, { component: 'DevServerService', projectId, featureName: feature });
    }
  }
  
  /**
   * Cleanup all dev servers (called on server shutdown)
   */
  async cleanup(): Promise<void> {
    const serverKeys = Array.from(this.devServers.keys());
    
    if (serverKeys.length === 0) {
      logger.debug('No running dev servers to cleanup', { component: 'DevServerService' });
      return;
    }
    
    logger.info(`Cleaning up ${serverKeys.length} dev server(s)...`, { component: 'DevServerService' });
    
    const cleanupPromises: Promise<void>[] = [];
    
    for (const serverKey of serverKeys) {
      const { tenantId, userId, projectId, feature } = this.parseServerKey(serverKey);
      
      const cleanupPromise = this.stopDevServer(tenantId, userId, projectId, feature)
        .then(() => {
          logger.debug(`Stopped: ${serverKey}`, { component: 'DevServerService' });
        })
        .catch((error) => {
          logger.warn(`Failed to stop ${serverKey}: ${error.message}`, { component: 'DevServerService' });
        });
      
      cleanupPromises.push(cleanupPromise);
    }
    
    await Promise.all(cleanupPromises);
    
    // Close PortRegistry connection if exists
    if (this.portRegistry && typeof this.portRegistry.close === 'function') {
      try {
        await this.portRegistry.close();
        logger.debug('PortRegistry closed', { component: 'DevServerService' });
      } catch (error: any) {
        logger.warn(`PortRegistry close error: ${error.message}`, { component: 'DevServerService' });
      }
    }
    
    logger.info(`Cleanup complete (${serverKeys.length} server(s) stopped)`, { component: 'DevServerService' });
  }
}
