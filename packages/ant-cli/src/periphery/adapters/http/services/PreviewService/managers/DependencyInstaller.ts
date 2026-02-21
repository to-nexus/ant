import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback } from '../types';

// npm install on EFS can be slow; 3 minutes is generous but prevents infinite hang
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * DependencyInstaller
 * 
 * Handles dependency installation for packages.
 * Detects package manager, identifies critical dependencies,
 * and runs npm/yarn/pnpm install as needed.
 */
export class DependencyInstaller {
  // Track which project roots have already been installed
  private installedRoots: Set<string> = new Set();

  /**
   * Install dependencies if needed.
   * Dispatches to language-specific install based on projectProfile.
   */
  async installIfNeeded(
    packagePath: string, 
    displayName: string,
    onLog: LogCallback,
    projectProfile?: { language: string; framework?: string }
  ): Promise<void> {
    const relativePath = displayName || path.basename(packagePath);
    const lang = (projectProfile?.language || 'typescript').toLowerCase();
    
    switch (lang) {
      case 'typescript':
      case 'javascript':
        return this.installNodeDeps(packagePath, relativePath, onLog);
      case 'go':
      case 'python':
      case 'rust':
      case 'java':
        return this.installByLanguage(packagePath, relativePath, lang, onLog);
      default:
        logger.debug(`No dependency install for language: ${lang}`, { component: 'DependencyInstaller' });
        return;
    }
  }
  
  /**
   * Node.js / TypeScript dependency install
   */
  private async installNodeDeps(
    packagePath: string,
    displayName: string,
    onLog: LogCallback
  ): Promise<void> {
    const nodeModulesPath = path.join(packagePath, 'node_modules');
    const projectRoot = this.findProjectRoot(packagePath);
    const isWorkspace = this.isWorkspaceProject(projectRoot);
    
    // For workspace projects, only install once at root
    if (isWorkspace) {
      if (this.installedRoots.has(projectRoot)) {
        logger.debug(`Workspace already installed: ${projectRoot}`, { component: 'DependencyInstaller' });
        return;
      }
      
      const rootNodeModules = path.join(projectRoot, 'node_modules');
      if (!fs.existsSync(rootNodeModules)) {
        logger.info(`Installing workspace dependencies at root: ${projectRoot}`, { component: 'DependencyInstaller' });
        await this.runInstall(projectRoot, 'workspace root', onLog);
        this.installedRoots.add(projectRoot);
        return;
      }
      
      // Check if workspace needs reinstall
      if (this.workspaceNeedsReinstall(projectRoot)) {
        logger.info(`Workspace needs reinstall: ${projectRoot}`, { component: 'DependencyInstaller' });
        await this.runInstall(projectRoot, 'workspace root', onLog);
        this.installedRoots.add(projectRoot);
        return;
      }
      
      this.installedRoots.add(projectRoot);
      logger.debug(`Workspace dependencies OK: ${projectRoot}`, { component: 'DependencyInstaller' });
      return;
    }
    
    // Non-workspace: install per package
    if (!fs.existsSync(nodeModulesPath)) {
      logger.info(`Installing dependencies (no node_modules): ${displayName}`, { component: 'DependencyInstaller' });
      return this.runInstall(packagePath, displayName, onLog);
    }
    
    // Verify critical dependencies are actually installed
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      logger.warn(`No package.json found at ${packagePath}`, { component: 'DependencyInstaller' });
      return;
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const criticalDeps = this.identifyCriticalDeps(packageJson);
    
    const missingDeps = criticalDeps.filter(dep => 
      !fs.existsSync(path.join(nodeModulesPath, dep))
    );
    
    if (missingDeps.length > 0) {
      logger.info(`Missing critical deps for ${displayName}: ${missingDeps.join(', ')} (re-install)`, { component: 'DependencyInstaller' });
      onLog('stdout', `⚠️  Missing critical dependencies: ${missingDeps.join(', ')}`);
      return this.runInstall(packagePath, displayName, onLog);
    }
    
    logger.debug(`Dependencies already installed: ${packagePath}`, { component: 'DependencyInstaller' });
  }
  
  /**
   * Language-specific dependency install (Go, Python, Rust, Java)
   */
  private async installByLanguage(
    packagePath: string,
    displayName: string,
    language: string,
    onLog: LogCallback
  ): Promise<void> {
    let command: string;
    let args: string[];
    
    switch (language) {
      case 'go':
        return this.installGoDeps(packagePath, displayName, onLog);
      case 'python':
        if (fs.existsSync(path.join(packagePath, 'requirements.txt'))) {
          command = 'pip';
          args = ['install', '-r', 'requirements.txt'];
        } else if (fs.existsSync(path.join(packagePath, 'pyproject.toml'))) {
          command = 'pip';
          args = ['install', '-e', '.'];
        } else {
          logger.debug(`No Python dependency file found, skipping`, { component: 'DependencyInstaller' });
          return;
        }
        break;
      case 'rust':
        if (!fs.existsSync(path.join(packagePath, 'Cargo.toml'))) {
          logger.debug(`No Cargo.toml found, skipping Rust dep install`, { component: 'DependencyInstaller' });
          return;
        }
        command = 'cargo';
        args = ['build'];
        break;
      case 'java':
        if (fs.existsSync(path.join(packagePath, 'pom.xml'))) {
          command = 'mvn';
          args = ['dependency:resolve'];
        } else if (fs.existsSync(path.join(packagePath, 'build.gradle')) || fs.existsSync(path.join(packagePath, 'build.gradle.kts'))) {
          command = './gradlew';
          args = ['dependencies'];
        } else {
          logger.debug(`No Java build file found, skipping`, { component: 'DependencyInstaller' });
          return;
        }
        break;
      default:
        logger.debug(`Unsupported language for dep install: ${language}`, { component: 'DependencyInstaller' });
        return;
    }
    
    onLog('stdout', `📦 Installing ${language} dependencies for ${displayName}...`);
    logger.info(`Running ${command} ${args.join(' ')} in: ${packagePath}`, { component: 'DependencyInstaller' });
    
    return new Promise((resolve, reject) => {
      let settled = false;
      
      const installProcess = spawn(command, args, {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe'
      });
      
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          const msg = `${command} ${args[0]} timed out after ${INSTALL_TIMEOUT_MS / 1000}s`;
          logger.error(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `❌ ${msg}`);
          try { installProcess.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { installProcess.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
          reject(new Error(msg));
        }
      }, INSTALL_TIMEOUT_MS);
      
      installProcess.stdout?.on('data', (data) => onLog('stdout', data.toString()));
      installProcess.stderr?.on('data', (data) => onLog('stderr', data.toString()));
      
      installProcess.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          onLog('stdout', `✅ ${language} dependencies installed for ${displayName}`);
          resolve();
        } else {
          logger.error(`${command} failed in ${packagePath} with code ${code}`, { component: 'DependencyInstaller' });
          reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
        }
      });
      
      installProcess.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        logger.error(`Install process error in ${packagePath}`, { component: 'DependencyInstaller' }, err);
        reject(err);
      });
    });
  }
  
  /**
   * Run package manager install
   */
  private async runInstall(
    packagePath: string, 
    relativePath: string,
    onLog: LogCallback
  ): Promise<void> {
    const projectRoot = this.findProjectRoot(packagePath);
    const pm = this.detectPackageManager(projectRoot);
    
    onLog('stdout', `📦 Installing dependencies for ${relativePath}...`);
    logger.info(`Running ${pm} install in: ${packagePath}`, { component: 'DependencyInstaller' });
    
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
      let settled = false;
      
      const installProcess = spawn(command, args, {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe'
      });
      
      // Timeout: kill the process if install takes too long (e.g., EFS network hang)
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          const msg = `${pm} install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`;
          logger.error(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `❌ ${msg}`);
          try { installProcess.kill('SIGTERM'); } catch { /* ignore */ }
          // Force kill after 5s if SIGTERM didn't work
          setTimeout(() => {
            try { installProcess.kill('SIGKILL'); } catch { /* ignore */ }
          }, 5000);
          reject(new Error(msg));
        }
      }, INSTALL_TIMEOUT_MS);
      
      installProcess.stdout?.on('data', (data) => {
        onLog('stdout', data.toString());
      });
      
      installProcess.stderr?.on('data', (data) => {
        onLog('stderr', data.toString());
      });
      
      installProcess.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        
        if (code === 0) {
          onLog('stdout', `✅ Dependencies installed for ${relativePath}`);
          resolve();
        } else {
          logger.error(`Install failed in ${packagePath} with code ${code}`, { component: 'DependencyInstaller' });
          reject(new Error(`${pm} install failed with code ${code}`));
        }
      });
      
      installProcess.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        
        logger.error(`Install process error in ${packagePath}`, { component: 'DependencyInstaller' }, err);
        reject(err);
      });
    });
  }
  
  /**
   * Identify critical dependencies that must be present for dev server
   */
  identifyCriticalDeps(packageJson: any): string[] {
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
   * Find project root by looking for lock files or workspace config
   */
  findProjectRoot(packagePath: string): string {
    let current = packagePath;
    while (current !== path.dirname(current)) {
      // Check for workspace config files (pnpm-workspace.yaml indicates workspace root)
      if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
        return current;
      }
      
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
  detectPackageManager(projectPath: string): 'pnpm' | 'yarn' | 'npm' {
    if (fs.existsSync(path.join(projectPath, 'pnpm-lock.yaml'))) {
      return 'pnpm';
    }
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) {
      return 'yarn';
    }
    return 'npm';
  }

  /**
   * Check if project is a workspace (monorepo)
   */
  private isWorkspaceProject(projectRoot: string): boolean {
    // Check for pnpm-workspace.yaml
    if (fs.existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'))) {
      return true;
    }
    
    // Check for workspaces in package.json
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    
    return false;
  }

  /**
   * Go dependency install with workspace (go.work) awareness.
   * When a go.work exists in a parent directory, runs `go work sync` once at
   * the workspace root so that local module replacements (e.g. ./shared) are
   * resolved without hitting the network. Subsequent services in the same
   * workspace are skipped because sync already handled them.
   */
  private async installGoDeps(
    packagePath: string,
    displayName: string,
    onLog: LogCallback
  ): Promise<void> {
    if (!fs.existsSync(path.join(packagePath, 'go.mod'))) {
      logger.debug(`No go.mod found, skipping Go dep install`, { component: 'DependencyInstaller' });
      return;
    }

    const workspaceRoot = this.findGoWorkspaceRoot(packagePath);

    if (workspaceRoot) {
      if (this.installedRoots.has(workspaceRoot)) {
        logger.debug(`Go workspace already synced: ${workspaceRoot}`, { component: 'DependencyInstaller' });
        return;
      }

      onLog('stdout', `📦 Go workspace detected — running go work sync...`);
      logger.info(`Running go work sync in: ${workspaceRoot}`, { component: 'DependencyInstaller' });
      await this.runGoCommand(['work', 'sync'], workspaceRoot, onLog, '✅ Go workspace synced');
      this.installedRoots.add(workspaceRoot);
      return;
    }

    onLog('stdout', `📦 Installing go dependencies for ${displayName}...`);
    logger.info(`Running go mod tidy in: ${packagePath}`, { component: 'DependencyInstaller' });
    await this.runGoCommand(['mod', 'tidy'], packagePath, onLog, `✅ Go dependencies installed for ${displayName}`);
  }

  private runGoCommand(
    args: string[],
    cwd: string,
    onLog: LogCallback,
    successMsg: string,
    env?: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const proc = spawn('go', args, {
        cwd,
        shell: true,
        stdio: 'pipe',
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          const msg = `go ${args[0]} timed out after ${INSTALL_TIMEOUT_MS / 1000}s`;
          logger.error(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `❌ ${msg}`);
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
          reject(new Error(msg));
        }
      }, INSTALL_TIMEOUT_MS);

      proc.stdout?.on('data', (data) => onLog('stdout', data.toString()));
      proc.stderr?.on('data', (data) => onLog('stderr', data.toString()));

      proc.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          onLog('stdout', successMsg);
          resolve();
        } else {
          const errMsg = `go ${args.join(' ')} failed with code ${code}`;
          logger.error(`${errMsg} in ${cwd}`, { component: 'DependencyInstaller' });
          reject(new Error(errMsg));
        }
      });

      proc.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        logger.error(`Go process error in ${cwd}`, { component: 'DependencyInstaller' }, err);
        reject(err);
      });
    });
  }

  /**
   * Walk up from startPath looking for a go.work file (Go workspace root).
   */
  private findGoWorkspaceRoot(startPath: string): string | null {
    let current = startPath;
    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, 'go.work'))) {
        return current;
      }
      current = path.dirname(current);
    }
    return null;
  }

  /**
   * Check if workspace needs reinstall
   * Returns true if any workspace package is missing critical dependencies
   */
  private workspaceNeedsReinstall(projectRoot: string): boolean {
    const packagesDir = path.join(projectRoot, 'packages');
    if (!fs.existsSync(packagesDir)) {
      return false;
    }
    
    try {
      const packages = fs.readdirSync(packagesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => path.join(packagesDir, dirent.name));
      
      for (const pkgPath of packages) {
        const packageJsonPath = path.join(pkgPath, 'package.json');
        if (!fs.existsSync(packageJsonPath)) continue;
        
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const criticalDeps = this.identifyCriticalDeps(packageJson);
        
        // For workspace packages, check in root node_modules
        const rootNodeModules = path.join(projectRoot, 'node_modules');
        const missingDeps = criticalDeps.filter(dep => 
          !fs.existsSync(path.join(rootNodeModules, dep))
        );
        
        if (missingDeps.length > 0) {
          logger.info(`Workspace package ${path.basename(pkgPath)} missing: ${missingDeps.join(', ')}`, { component: 'DependencyInstaller' });
          return true;
        }
      }
    } catch (err) {
      logger.warn(`Failed to check workspace packages`, { component: 'DependencyInstaller' }, err);
      return false;
    }
    
    return false;
  }
}
