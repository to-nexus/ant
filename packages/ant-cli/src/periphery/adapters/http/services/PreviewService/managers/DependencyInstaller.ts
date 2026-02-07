import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback } from '../types';

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
   * Install dependencies if needed
   */
  async installIfNeeded(
    packagePath: string, 
    displayName: string,
    onLog: LogCallback
  ): Promise<void> {
    const nodeModulesPath = path.join(packagePath, 'node_modules');
    const relativePath = displayName || path.basename(packagePath);
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
    // Check if node_modules exists
    if (!fs.existsSync(nodeModulesPath)) {
      logger.info(`Installing dependencies (no node_modules): ${relativePath}`, { component: 'DependencyInstaller' });
      return this.runInstall(packagePath, relativePath, onLog);
    }
    
    // Verify critical dependencies are actually installed
    const packageJsonPath = path.join(packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      logger.warn(`No package.json found at ${packagePath}`, { component: 'DependencyInstaller' });
      return;
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const criticalDeps = this.identifyCriticalDeps(packageJson);
    
    // Check if critical deps exist in node_modules
    const missingDeps = criticalDeps.filter(dep => 
      !fs.existsSync(path.join(nodeModulesPath, dep))
    );
    
    if (missingDeps.length > 0) {
      logger.info(`Missing critical deps for ${relativePath}: ${missingDeps.join(', ')} (re-install)`, { component: 'DependencyInstaller' });
      onLog('stdout', `⚠️  Missing critical dependencies: ${missingDeps.join(', ')}`);
      return this.runInstall(packagePath, relativePath, onLog);
    }
    
    logger.debug(`Dependencies already installed: ${packagePath}`, { component: 'DependencyInstaller' });
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
      const installProcess = spawn(command, args, {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe'
      });
      
      installProcess.stdout?.on('data', (data) => {
        onLog('stdout', data.toString());
      });
      
      installProcess.stderr?.on('data', (data) => {
        onLog('stderr', data.toString());
      });
      
      installProcess.on('close', (code) => {
        if (code === 0) {
          onLog('stdout', `✅ Dependencies installed for ${relativePath}`);
          resolve();
        } else {
          logger.error(`Install failed in ${packagePath} with code ${code}`, { component: 'DependencyInstaller' });
          reject(new Error(`${pm} install failed with code ${code}`));
        }
      });
      
      installProcess.on('error', (err) => {
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
