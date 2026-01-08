import { spawn, ChildProcess } from 'child_process';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { LogEntry } from '../../../../../core/ports/http';
import { PortManager } from '../../../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../../../core/ports/portRegistry';
import { SSEService } from '../SSEService';
import { DevServerIssue, DevServerIssueReasoning, PackageInfo, ProjectStructure, ValidationResult } from './types';
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
  private devServerPackagePorts: Map<string, Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>> = new Map();
  private devServerIssues: Map<string, DevServerIssue[]> = new Map();
  private stoppingServers: Set<string> = new Set();
  private stoppingPidsByServer: Map<string, Set<number>> = new Map();
  private stoppingCleanupTimers: Map<string, NodeJS.Timeout> = new Map();
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
    
    // Backend/Node dev tools (must have for backend dev server)
    if (deps['nodemon']) critical.push('nodemon');
    if (deps['tsx']) critical.push('tsx');
    if (deps['ts-node']) critical.push('ts-node');
    if (deps['ts-node-dev']) critical.push('ts-node-dev');
    
    // Core backend dependencies
    if (deps['express']) critical.push('express');
    if (deps['fastify']) critical.push('fastify');
    if (deps['koa']) critical.push('koa');
    
    return critical;
  }
  
  /**
   * Find project root by looking for package.json with workspaces or lock files
   */
  private findProjectRoot(packagePath: string): string {
    let current = packagePath;
    while (current !== path.dirname(current)) {
      // Check for lock files (indicates root)
      if (
        fs.existsSync(path.join(current, 'pnpm-lock.yaml')) ||
        fs.existsSync(path.join(current, 'yarn.lock')) ||
        fs.existsSync(path.join(current, 'package-lock.json'))
      ) {
        return current;
      }
      // Check for workspaces in package.json
      const pkgPath = path.join(current, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.workspaces) {
            return current;
          }
        } catch {
          // ignore
        }
      }
      current = path.dirname(current);
    }
    // Fallback to package path
    return packagePath;
  }
  
  /**
   * Detect package manager for a project
   */
  private detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'npm' {
    // Check for lock files to determine package manager
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      return 'yarn';
    }
    return 'npm';
  }
  
  /**
   * Run package manager install with proper flags
   */
  private async runNpmInstall(packagePath: string, serverKey: string, relativePath: string): Promise<void> {
    // ✅ Detect package manager from project root (not package path)
    // For monorepos, lock file is at root level
    const projectRoot = this.findProjectRoot(packagePath);
    const pm = this.detectPackageManager(projectRoot);
    
    this.appendLog(serverKey, 'stdout', `📦 Installing dependencies for ${relativePath}...`);
    
    // Build install command based on package manager
    let command: string;
    let args: string[];
    
    if (pm === 'pnpm') {
      command = 'pnpm';
      args = ['install'];
    } else if (pm === 'yarn') {
      command = 'yarn';
      args = ['install'];
    } else {
      command = 'npm';
      args = ['install', '--include=dev'];
    }
    
    return new Promise((resolve, reject) => {
      const installProcess = spawn(command, args, {
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
          reject(new Error(`${pm} install failed with code ${code}`));
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
      
      // ✅ If this exit was caused by an explicit stop action, do NOT surface as an error.
      // IMPORTANT: stop() may clear state BEFORE child 'close' fires, so track PIDs as well.
      const pid = childProcess.pid;
      const stoppingPids = this.stoppingPidsByServer.get(serverKey);
      const isExpectedStop =
        this.stoppingServers.has(serverKey) ||
        (pid != null && stoppingPids?.has(pid));
      
      if (isExpectedStop) {
        // Don't append logs after stop (stopDevServer clears logs; avoid re-adding noise)
        if (pid != null && stoppingPids) {
          stoppingPids.delete(pid);
          if (stoppingPids.size === 0) {
            this.stoppingPidsByServer.delete(serverKey);
            this.stoppingServers.delete(serverKey);
            
            const t = this.stoppingCleanupTimers.get(serverKey);
            if (t) {
              clearTimeout(t);
              this.stoppingCleanupTimers.delete(serverKey);
            }
          }
        }
        return;
      }
      
      // ✅ Treat non-zero exits as errors so UI can surface failures reliably
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
    issues?: DevServerIssue[];
    status?: { running: boolean; ready: boolean; port?: number; logs?: any[]; packages?: any[]; backendPort?: number; issues?: any[] };  // ✅ Full status for immediate UI update
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
        
        // ✅ Inject API base URL for frontend to call backend through proxy
        // Uses relative path so it works in both local and cloud environments
        // Browser will use current host (e.g., localhost:3000 or cloud.ant.com)
        // Proxy routes /dev/:serverKey/api/* to backend port
        // See: dev-server-env-contract.md for the full contract
        if (pkg.type === 'frontend' && backendPort) {
          extraEnv.VITE_API_BASE_URL = `/dev/${serverKey}`;
        }
        
        const process = await this.spawnDevProcess(pkg, pkgPort, serverKey, extraEnv);
        pkg.process = process;
        processes.push(process);
      }

      // ✅ Persist package ports for UI/diagnostics (entry + backend port awareness)
      const packagePorts = orderedPackages
        .filter(p => typeof p.port === 'number')
        .map(p => ({ name: p.name, type: p.type, port: p.port as number }));
      this.devServerPackagePorts.set(serverKey, packagePorts);
      
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
          this.devServerPackagePorts.delete(serverKey);
          this.devServerIssues.delete(serverKey);
          
          if (this.portRegistry) {
            await this.portRegistry.unregisterDevServer(tenantId, userId, projectId, feature);
          }

          // ✅ Build issues stack (fatal + optional warning) so UI can "Fix All"
          const issues: DevServerIssue[] = [];
          issues.push({
            reasoning: (validation.reasoning || 'unknown') as DevServerIssueReasoning,
            severity: 'fatal',
            reason: validation.reason || 'Dev server setup validation failed',
            suggestedFix: validation.suggestedFix,
          });
          
          try {
            const hasBackend = orderedPackages.some(p => p.type === 'backend');
            const apiIssue = hasBackend ? await this.detectApiBaseIssue(entryPath) : null;
            if (apiIssue) issues.push(apiIssue);
          } catch {
            // Best-effort only
          }
          
          this.devServerIssues.set(serverKey, issues);
          const combinedSuggestedFix = this.combineIssueFixes(issues);
          
          return {
            success: false,
            error: 'Dev server setup validation failed',
            setupReasoning: validation.reasoning || 'unknown',
            setupReason: validation.reason,
            suggestedFix: combinedSuggestedFix,
            serverKey,
            // Provide issues for richer UI in future (optional)
            issues,
          };
        }
      } else {
        logger.debug(`Skipping validation (entry is not frontend)`, { component: 'DevServerService' });
      }

      // ✅ 6.5 Non-fatal issues (do NOT stop the server)
      // Best-effort heuristic: if fullstack backend exists but frontend isn't configured for dynamic API base.
      const issues: DevServerIssue[] = [];
      const entryFrontendPath = structure.entry?.type === 'frontend' ? structure.entry.path : undefined;
      const hasBackend = orderedPackages.some(p => p.type === 'backend' && typeof p.port === 'number');
      
      if (entryFrontendPath && hasBackend) {
        const apiIssue = await this.detectApiBaseIssue(entryFrontendPath);
        if (apiIssue) issues.push(apiIssue);
      }
      
      if (issues.length > 0) {
        this.devServerIssues.set(serverKey, issues);
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
      } else {
        this.devServerIssues.delete(serverKey);
      }
      
      // ✅ 7. Immediately broadcast "running" status (before health check)
      const runningStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, runningStatus);
      
      // ✅ 8. Health check for entry package (async, don't block response)
      const entryPort = structure.entry?.port || structure.packages[0].port!;
      this.healthCheck(entryPort, serverKey).then(ready => {
        this.devServerReady.set(serverKey, ready);
        
        // ✅ Broadcast updated status via SSE (with ready flag)
        const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
        this.broadcastStatus(serverKey, updatedStatus);
        
        if (this.onStatusChange) {
          this.onStatusChange(serverKey);
        }
      });
      
      // ✅ Include full status in response (for immediate UI update)
      const finalStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      
      return {
        success: true,
        message: `Started ${structure.packages.length} package(s)`,
        port: structure.entry?.port || structure.packages[0].port!,
        serverKey,
        url: proxyUrl,
        setupReasoning: validation.reasoning,  // Only set if validation failed
        setupReason: validation.reason,        // Only set if validation failed
        suggestedFix: validation.suggestedFix, // Only set if validation failed
        status: finalStatus  // ✅ Full status for immediate UI update
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

    // ✅ Mark stopping to avoid surfacing SIGTERM exits as errors
    this.stoppingServers.add(serverKey);
    const pidSet = new Set<number>();
    for (const p of processes) {
      if (p?.pid != null) pidSet.add(p.pid);
    }
    if (pidSet.size > 0) {
      this.stoppingPidsByServer.set(serverKey, pidSet);
    }
    
    // Fallback cleanup in case close events never arrive (or already fired)
    const existingTimer = this.stoppingCleanupTimers.get(serverKey);
    if (existingTimer) clearTimeout(existingTimer);
    this.stoppingCleanupTimers.set(
      serverKey,
      setTimeout(() => {
        this.stoppingServers.delete(serverKey);
        this.stoppingPidsByServer.delete(serverKey);
        this.stoppingCleanupTimers.delete(serverKey);
      }, 10_000)
    );
    
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
    this.devServerPackagePorts.delete(serverKey);
    this.devServerIssues.delete(serverKey);
    // NOTE: Do NOT clear stoppingServers here. close() may fire after cleanup and needs this flag.
    
    logger.info(`Stopped all servers for ${serverKey}`, { component: 'DevServerService' });
    
    // ✅ Broadcast running:false so UI can immediately reflect stopped state without requiring refresh.
    try {
      const updatedStatus = this.getDevServerStatus(tenantId, userId, projectId, feature);
      this.broadcastStatus(serverKey, updatedStatus);
    } catch {
      // Best-effort only
    }
    
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
    backendPort?: number;
    packages?: Array<{ name: string; type: 'frontend' | 'backend' | 'other'; port: number }>;
    issues?: DevServerIssue[];
  } {
    const serverKey = this.createServerKey(tenantId, userId, projectId, feature);
    const processes = this.devServers.get(serverKey);
    const port = this.devServerPorts.get(serverKey);
    const ready = this.devServerReady.get(serverKey) || false;  // ✅ Get health check status
    const packages = this.devServerPackagePorts.get(serverKey) || [];
    const backendPort = packages.find(p => p.type === 'backend')?.port;
    const issues = this.devServerIssues.get(serverKey) || [];
    
    const running = !!processes && processes.length > 0;
    
    return {
      running,
      ready,  // ✅ Real health check result
      port,
      url: port ? `/dev/${serverKey}` : undefined,
      processCount: processes?.length || 0,
      backendPort,
      packages,
      issues
    };
  }

  /**
   * Detect non-fatal issue when frontend API base isn't compatible with dynamic backend ports.
   * This is best-effort (heuristic) and should NOT block dev server startup.
   */
  private async detectApiBaseIssue(frontendPath: string): Promise<DevServerIssue | null> {
    try {
      const srcPath = path.join(frontendPath, 'src');
      const viteConfigCandidates = [
        path.join(frontendPath, 'vite.config.ts'),
        path.join(frontendPath, 'vite.config.js'),
      ];
      
      let hasConfigurableApiBase = false;
      for (const p of viteConfigCandidates) {
        if (!fs.existsSync(p)) continue;
        const c = await fs.promises.readFile(p, 'utf8');
        if (c.includes('VITE_API_BASE_URL') || c.includes("'/api'") || c.includes('\"/api\"')) {
          hasConfigurableApiBase = true;
        }
      }
      
      // Scan a limited subset of src files for API base usage patterns
      const files: string[] = [];
      const stack = [srcPath];
      const maxFiles = 200;
      while (stack.length && files.length < maxFiles) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (files.length >= maxFiles) break;
          if (e.name.startsWith('.')) continue;
          if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) stack.push(full);
          else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) files.push(full);
        }
      }
      
      let hasEnvApiBase = false;
      let hasHardcodedHttpLocal = false;
      let usesRelativeApi = false;
      
      for (const f of files) {
        try {
          const c = await fs.promises.readFile(f, 'utf8');
          if (c.includes('VITE_API_BASE_URL')) hasEnvApiBase = true;
          if (c.includes("'/api/") || c.includes('\"/api/')) usesRelativeApi = true;
          if (/https?:\/\/localhost:\d+/.test(c)) hasHardcodedHttpLocal = true;
        } catch {
          // ignore
        }
      }
      
      // If they already use env or relative /api or configure proxy, assume OK
      if (hasEnvApiBase || usesRelativeApi || hasConfigurableApiBase) {
        return null;
      }
      
      const reason = hasHardcodedHttpLocal
        ? 'Frontend API client appears to use a fixed localhost URL and may not work with dynamic backend ports.'
        : 'Frontend API client may not be configured for dynamic backend ports in Ant-managed dev servers.';
      
      return {
        reasoning: 'api-base-missing',
        severity: 'warning',
        reason,
        suggestedFix: [
          'This project runs as a fullstack dev server under the Ant platform with dynamic backend ports.',
          'Please update the frontend so API requests can target the backend address injected at runtime.',
          '',
          '- Prefer reading a runtime-injected API base URL (Vite projects typically use `import.meta.env` variables).',
          '- Alternatively, route API calls through a stable relative path (e.g., `/api`) and rely on dev/proxy routing.',
          '- Keep non-Ant execution working by preserving the project’s existing defaults/behavior.',
        ].join('\n')
      };
    } catch {
      return null;
    }
  }

  /**
   * Combine multiple issue fixes into a single LLM-ready prompt.
   * Order: fatal first, then warnings (stable).
   */
  private combineIssueFixes(issues: DevServerIssue[]): string | undefined {
    const withFix = issues.filter(i => i.suggestedFix && i.suggestedFix.trim().length > 0);
    if (withFix.length === 0) return undefined;
    const ordered = [...withFix].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fatal' ? -1 : 1));
    return ordered.map(i => i.suggestedFix!.trim()).join('\n\n---\n\n');
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
