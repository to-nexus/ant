import { spawn, execSync, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import { detectPackageManager, buildInstallCommand, findProjectRoot, type PackageManager } from '../../../../../../utils/packageManager';
import { atomicWriteFile } from '../../../../../../core/utils/atomicWriteFile';
import type { ProjectProfile } from '@ant/shared';
import type { LogCallback } from '../types';
import { resolveSpawnLanguage } from '../utils/projectFacts';
import { composeChildEnv } from './envAssembly';
import { childSpawnIdentity } from '../../../../../../core/config/childIdentity';

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
  // In-process memo: project root → manifest hash at last successful install.
  // Keyed by hash (not mere presence) so a job that edits package.json between
  // restarts is not short-circuited by a stale memo.
  private installedRoots: Map<string, string> = new Map();

  /**
   * Install dependencies if needed.
   * Dispatches to language-specific install based on projectProfile.
   * Pass an AbortSignal to allow cancellation of long-running installs.
   */
  async installIfNeeded(
    packagePath: string, 
    displayName: string,
    onLog: LogCallback,
    projectProfile?: ProjectProfile,
    credentialEnv?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    const relativePath = displayName || path.basename(packagePath);
    const lang = resolveSpawnLanguage(projectProfile);

    switch (lang) {
      case 'typescript':
      case 'javascript':
        return this.installNodeDeps(packagePath, relativePath, onLog, credentialEnv, signal);
      case 'go':
      case 'python':
      case 'rust':
      case 'java':
        return this.installByLanguage(packagePath, relativePath, lang, onLog, credentialEnv, signal);
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
    onLog: LogCallback,
    credentialEnv?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    const nodeModulesPath = path.join(packagePath, 'node_modules');
    const projectRoot = this.findProjectRoot(packagePath);
    const isWorkspace = this.isWorkspaceProject(projectRoot);

    // For workspace projects, only install once at root
    if (isWorkspace) {
      const expectedHash = this.manifestHash(projectRoot, this.listWorkspaceMemberManifests(projectRoot));
      if (this.installedRoots.get(projectRoot) === expectedHash) {
        logger.debug(`Workspace already installed: ${projectRoot}`, { component: 'DependencyInstaller' });
        return;
      }

      const rootNodeModules = path.join(projectRoot, 'node_modules');
      const needsInstall =
        !fs.existsSync(rootNodeModules)
        || this.workspaceNeedsReinstall(projectRoot)
        // Manifest changed since the last successful install (a job added a
        // dep the critical-dep scan cannot see) — the stamp is the witness.
        || (await this.readInstallStamp(projectRoot)) !== expectedHash;

      if (needsInstall) {
        logger.info(`Installing workspace dependencies at root: ${projectRoot}`, { component: 'DependencyInstaller' });
        await this.runInstall(projectRoot, 'workspace root', onLog, credentialEnv, signal);
        await this.recordInstall(projectRoot, this.listWorkspaceMemberManifests(projectRoot));
        return;
      }

      this.installedRoots.set(projectRoot, expectedHash);
      logger.debug(`Workspace dependencies OK: ${projectRoot}`, { component: 'DependencyInstaller' });
      return;
    }

    // Non-workspace: install per package
    if (!fs.existsSync(nodeModulesPath)) {
      logger.info(`Installing dependencies (no node_modules): ${displayName}`, { component: 'DependencyInstaller' });
      await this.runInstall(packagePath, displayName, onLog, credentialEnv, signal);
      await this.recordInstall(packagePath);
      return;
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
      await this.runInstall(packagePath, displayName, onLog, credentialEnv, signal);
      await this.recordInstall(packagePath);
      return;
    }

    // The critical-dep whitelist cannot see ordinary new deps (e.g. a job
    // adding `three`): compare the manifest content-hash against the stamp
    // written at the last successful install. Content-hash, not mtime —
    // EFS attribute caching makes mtimes unreliable across pods.
    const expectedHash = this.manifestHash(packagePath);
    if ((await this.readInstallStamp(packagePath)) !== expectedHash) {
      logger.info(`Manifest changed since last install: ${displayName} (re-install)`, { component: 'DependencyInstaller' });
      onLog('stdout', `📦 package.json changed since last install — installing dependencies`);
      await this.runInstall(packagePath, displayName, onLog, credentialEnv, signal);
      await this.recordInstall(packagePath);
      return;
    }

    logger.debug(`Dependencies already installed: ${packagePath}`, { component: 'DependencyInstaller' });
  }

  // ── Install stamp (manifest content-hash under node_modules/) ──────────
  //
  // `node_modules/.ant-install-stamp` records the sha256 of package.json +
  // lockfile(s) (+ workspace member manifests) at the last successful
  // install. Lives inside node_modules so deleting node_modules deletes the
  // stamp (fail-open to install) and generated .gitignore already covers it.

  private stampPath(installRoot: string): string {
    return path.join(installRoot, 'node_modules', '.ant-install-stamp');
  }

  private manifestHash(installRoot: string, extraManifests: string[] = []): string {
    const parts: string[] = [];
    const tryRead = (p: string) => {
      try { parts.push(`${p}\n${fs.readFileSync(p, 'utf8')}`); } catch { /* absent */ }
    };
    tryRead(path.join(installRoot, 'package.json'));
    for (const lock of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']) {
      tryRead(path.join(installRoot, lock));
    }
    for (const m of extraManifests) tryRead(m);
    return createHash('sha256').update(parts.join('\x00')).digest('hex');
  }

  /** `packages/*` member manifests — mirrors `workspaceNeedsReinstall`'s scan scope. */
  private listWorkspaceMemberManifests(projectRoot: string): string[] {
    const packagesDir = path.join(projectRoot, 'packages');
    try {
      return fs.readdirSync(packagesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(packagesDir, e.name, 'package.json'))
        .filter((p) => fs.existsSync(p));
    } catch {
      return [];
    }
  }

  private async readInstallStamp(installRoot: string): Promise<string | null> {
    try {
      return (await fs.promises.readFile(this.stampPath(installRoot), 'utf-8')).trim();
    } catch {
      return null;
    }
  }

  /** Write the stamp (atomic tmp+rename) and refresh the in-process memo. */
  private async recordInstall(installRoot: string, extraManifests: string[] = []): Promise<void> {
    const hash = this.manifestHash(installRoot, extraManifests);
    try {
      await atomicWriteFile(this.stampPath(installRoot), hash);
    } catch (err) {
      // Non-fatal: worst case the next restart re-installs.
      logger.warn(`Failed to write install stamp at ${installRoot}: ${(err as Error).message}`, { component: 'DependencyInstaller' });
    }
    this.installedRoots.set(installRoot, hash);
  }
  
  /**
   * Language-specific dependency install (Go, Python, Rust, Java)
   */
  private async installByLanguage(
    packagePath: string,
    displayName: string,
    language: string,
    onLog: LogCallback,
    credentialEnv?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    let command: string;
    let args: string[];
    
    switch (language) {
      case 'go':
        return this.installGoDeps(packagePath, displayName, onLog, credentialEnv, signal);
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
      if (signal?.aborted) {
        reject(new Error('Installation cancelled'));
        return;
      }

      let settled = false;
      
      // No credentialEnv here on purpose. `GIT_CONFIG_*` only rewrites git URLs,
      // which python / rust / java resolvers do not use — but `cargo build`,
      // `mvn` plugins and `./gradlew` all evaluate user-authored build code, so
      // passing the PAT would hand it to that code for no functional gain
      // (M-NEW-001, same axis as the node two-pass install above). Go still gets
      // it: private module fetch needs it and Go runs no dependency code at
      // install time — see `installGoDeps`.
      const installProcess = spawn(command, args, {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe',
        env: composeChildEnv(),
        ...childSpawnIdentity(),
      });

      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          const msg = `${command} ${args[0]} cancelled by user`;
          logger.info(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `⏹️ ${msg}`);
          try { installProcess.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { installProcess.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
          reject(new Error(msg));
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
        logger.error(`Install process error in ${packagePath}`, { component: 'DependencyInstaller' }, err);
        reject(err);
      });
    });
  }
  
  /**
   * Run package manager install
   */
  /**
   * Install node dependencies in two passes, so a user's GitHub PAT never reaches
   * attacker-authored code.
   *
   * `buildCredentialEnv` puts the PAT in `GIT_CONFIG_KEY_0` as a raw value, and a
   * single install pass hands that environment to every `preinstall` /
   * `install` / `postinstall` script in the dependency tree — a malicious package
   * only has to read its own environment (M-NEW-001). The two passes separate the
   * two needs that were conflated:
   *
   *   1. ACQUIRE — credentialed, `--ignore-scripts`. Resolves, fetches and links
   *      the tree, including private git dependencies. Runs no dependency code.
   *   2. LIFECYCLE — no credentials, scripts enabled. Everything is already on
   *      disk, so no network authentication is needed; native builds and legitimate
   *      lifecycle scripts run exactly as before, just without the PAT in reach.
   *
   * Pass 2 is skipped when there was no credential to protect — a plain install is
   * one pass, as it always was.
   */
  private async runInstall(
    packagePath: string,
    relativePath: string,
    onLog: LogCallback,
    credentialEnv?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    const projectRoot = this.findProjectRoot(packagePath);
    const pm = this.detectPackageManager(projectRoot);
    const credentialed = credentialEnv !== undefined && Object.keys(credentialEnv).length > 0;

    onLog('stdout', `📦 Installing dependencies for ${relativePath}...`);
    logger.info(`Running ${pm} install in: ${packagePath}`, { component: 'DependencyInstaller' });

    if (!credentialed) {
      const plain = buildInstallCommand(pm);
      await this.spawnInstallPass(plain, { packagePath, relativePath, pm, onLog, signal });
      return;
    }

    const acquire = buildInstallCommand(pm, { ignoreScripts: true });
    await this.spawnInstallPass(acquire, {
      packagePath, relativePath, pm, onLog, signal, credentialEnv,
      label: 'dependency fetch',
    });

    const lifecycle = buildInstallCommand(pm);
    await this.spawnInstallPass(lifecycle, {
      packagePath, relativePath, pm, onLog, signal,
      label: 'build scripts',
    });
  }

  /** One install invocation. Owns the timeout / abort / stream / exit contract. */
  private spawnInstallPass(
    invocation: { command: string; args: string[] },
    ctx: {
      packagePath: string;
      relativePath: string;
      pm: PackageManager;
      onLog: LogCallback;
      signal?: AbortSignal;
      credentialEnv?: Record<string, string>;
      label?: string;
    },
  ): Promise<void> {
    const { command, args } = invocation;
    const { packagePath, relativePath, pm, onLog, signal, credentialEnv, label } = ctx;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Installation cancelled'));
        return;
      }

      let settled = false;
      
      const installProcess = spawn(command, args, {
        cwd: packagePath,
        shell: true,
        stdio: 'pipe',
        env: composeChildEnv({ COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' }, credentialEnv),
        ...childSpawnIdentity(),
      });

      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          const msg = `${pm} install cancelled by user`;
          logger.info(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `⏹️ ${msg}`);
          try { installProcess.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { installProcess.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
          reject(new Error(msg));
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      
      // Timeout: kill the process if install takes too long (e.g., EFS network hang)
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          const msg = `${pm} install timed out after ${INSTALL_TIMEOUT_MS / 1000}s`;
          logger.error(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `❌ ${msg}`);
          try { installProcess.kill('SIGTERM'); } catch { /* ignore */ }
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
        signal?.removeEventListener('abort', onAbort);
        
        if (code === 0) {
          onLog('stdout', label
            ? `✅ ${relativePath}: ${label} complete`
            : `✅ Dependencies installed for ${relativePath}`);
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
        signal?.removeEventListener('abort', onAbort);
        
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
   * Find project root by looking for lock files or workspace config.
   * Delegates to the shared SSOT in utils/packageManager.
   */
  findProjectRoot(packagePath: string): string {
    return findProjectRoot(packagePath);
  }
  
  /**
   * Detect package manager for a project
   */
  detectPackageManager(projectPath: string): PackageManager {
    return detectPackageManager(projectPath);
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
   *
   * Dependency install is best-effort: if `go` is not found (exit 127),
   * we log a warning and continue so the preview can still attempt to start.
   */
  private async installGoDeps(
    packagePath: string,
    displayName: string,
    onLog: LogCallback,
    credentialEnv?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    if (!fs.existsSync(path.join(packagePath, 'go.mod'))) {
      logger.debug(`No go.mod found, skipping Go dep install`, { component: 'DependencyInstaller' });
      return;
    }

    if (!this.isCommandAvailable('go')) {
      const msg = 'Go toolchain not found in PATH — skipping dependency install. The dev server may fail to start.';
      logger.warn(msg, { component: 'DependencyInstaller' });
      onLog('stderr', `⚠️  ${msg}`);
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
      await this.runGoCommand(['work', 'sync'], workspaceRoot, onLog, '✅ Go workspace synced', credentialEnv, signal);
      // Go workspaces have no manifest-hash stamp (JS-only); the memo value
      // is a sentinel — `has()` is the only read on this path.
      this.installedRoots.set(workspaceRoot, 'go-work-synced');
      return;
    }

    onLog('stdout', `📦 Installing go dependencies for ${displayName}...`);
    logger.info(`Running go mod tidy in: ${packagePath}`, { component: 'DependencyInstaller' });
    await this.runGoCommand(['mod', 'tidy'], packagePath, onLog, `✅ Go dependencies installed for ${displayName}`, credentialEnv, signal);
  }

  private runGoCommand(
    args: string[],
    cwd: string,
    onLog: LogCallback,
    successMsg: string,
    env?: Record<string, string>,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Installation cancelled'));
        return;
      }

      let settled = false;

      const proc = spawn('go', args, {
        cwd,
        shell: true,
        stdio: 'pipe',
        env: composeChildEnv(env),
        ...childSpawnIdentity(),
      });

      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          const msg = `go ${args[0]} cancelled by user`;
          logger.info(msg, { component: 'DependencyInstaller' });
          onLog('stderr', `⏹️ ${msg}`);
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
          reject(new Error(msg));
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
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
        signal?.removeEventListener('abort', onAbort);
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

  /**
   * Check if a CLI command is available in the current PATH.
   */
  private isCommandAvailable(cmd: string): boolean {
    try {
      execFileSync('which', [cmd], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
