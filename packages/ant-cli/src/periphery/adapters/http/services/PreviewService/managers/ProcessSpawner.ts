import { spawn, ChildProcess, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PackageInfo, LogCallback, ExitCallback } from '../types';
import { ServiceConnection } from '../../../../../../core/ports/portRegistry';
import { toUrlKey } from '../utils/serverKeyUtils';
import { logger } from '../../../../../../utils/logger';

export interface SpawnOptions {
  serverKey: string;
  /** Project root path for loading root-level .env (monorepo support). */
  projectRoot?: string;
  extraEnv?: Record<string, string | undefined>;
  connections?: ServiceConnection[];
  /** Package subdirectory relative to project root (e.g. 'packages/frontend'). Used to filter connections by source. */
  packageSource?: string;
  onLog: LogCallback;
  onExit: ExitCallback;
  onError: (error: Error) => void;
}

export interface OrphanProcess {
  pid: number;
  command: string;
  cwd?: string;
}

/**
 * ProcessSpawner
 * 
 * Handles spawning dev server processes for different package types.
 * Supports Vite, Next.js, React Scripts, and generic npm scripts.
 */
export class ProcessSpawner {
  /**
   * Find orphan processes running in a specific codebase path
   * These are processes that were spawned previously but lost tracking
   */
  findOrphanProcesses(codebasePath: string): OrphanProcess[] {
    const orphans: OrphanProcess[] = [];
    
    try {
      // Find node processes running with the codebase path
      // This works on macOS and Linux
      const psOutput = execSync(
        `ps aux | grep -E "node|next|vite|npm" | grep "${codebasePath}" | grep -v grep`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      
      if (!psOutput) {
        return orphans;
      }
      
      const lines = psOutput.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            orphans.push({
              pid,
              command: parts.slice(10).join(' '),
              cwd: codebasePath
            });
          }
        }
      }
      
      logger.debug(`Found ${orphans.length} orphan process(es) in ${codebasePath}`, { component: 'ProcessSpawner' });
    } catch (error: any) {
      // grep returns exit code 1 if no matches - this is expected
      if (error.status !== 1) {
        logger.debug(`Error finding orphan processes: ${error.message}`, { component: 'ProcessSpawner' });
      }
    }
    
    return orphans;
  }
  
  /**
   * Kill orphan processes found in a codebase path
   * Returns number of processes killed
   */
  killOrphanProcesses(codebasePath: string): number {
    const orphans = this.findOrphanProcesses(codebasePath);
    let killed = 0;
    
    for (const orphan of orphans) {
      try {
        process.kill(orphan.pid, 'SIGTERM');
        killed++;
        logger.info(`Killed orphan process PID=${orphan.pid}`, { component: 'ProcessSpawner' });
      } catch (error: any) {
        // Process might have already exited
        if (error.code !== 'ESRCH') {
          logger.warn(`Failed to kill orphan process PID=${orphan.pid}: ${error.message}`, { component: 'ProcessSpawner' });
        }
      }
    }
    
    if (killed > 0) {
      logger.info(`Cleaned up ${killed} orphan process(es) in ${codebasePath}`, { component: 'ProcessSpawner' });
    }
    
    return killed;
  }
  
  /**
   * Check if a port is in use
   */
  async isPortInUse(port: number): Promise<boolean> {
    try {
      const output = execSync(
        `lsof -i :${port} -t 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      
      return output.length > 0;
    } catch {
      return false;
    }
  }
  
  /**
   * Kill process using a specific port
   */
  killProcessOnPort(port: number): boolean {
    try {
      const pids = execSync(
        `lsof -i :${port} -t 2>/dev/null || true`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      
      if (!pids) {
        return false;
      }
      
      for (const pidStr of pids.split('\n')) {
        const pid = parseInt(pidStr.trim(), 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 'SIGTERM');
            logger.info(`Killed process on port ${port}: PID=${pid}`, { component: 'ProcessSpawner' });
          } catch (error: any) {
            if (error.code !== 'ESRCH') {
              logger.warn(`Failed to kill PID=${pid}: ${error.message}`, { component: 'ProcessSpawner' });
            }
          }
        }
      }
      
      return true;
    } catch (error: any) {
      logger.debug(`Error killing process on port ${port}: ${error.message}`, { component: 'ProcessSpawner' });
      return false;
    }
  }
  /**
   * Load environment variables from .env files.
   *
   * Two-level loading (like Nx / Docker Compose):
   *   1. projectRoot .env / .env.local  (workspace-level defaults)
   *   2. packagePath .env / .env.local  (package-level overrides)
   *
   * Package-level values take precedence over project-root values.
   */
  loadProjectEnv(packagePath: string, projectRoot?: string): Record<string, string> {
    const result: Record<string, string> = {};

    const dirsToLoad: string[] = [];
    if (projectRoot && path.resolve(projectRoot) !== path.resolve(packagePath)) {
      dirsToLoad.push(projectRoot);
    }
    dirsToLoad.push(packagePath);

    for (const dir of dirsToLoad) {
      for (const fileName of ['.env', '.env.local']) {
        const filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) continue;

        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex === -1) continue;
            const key = trimmed.substring(0, eqIndex).trim();
            let value = trimmed.substring(eqIndex + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            result[key] = value;
          }
        } catch (err) {
          logger.warn(`[ProcessSpawner] Failed to parse ${filePath}: ${err}`, { component: 'ProcessSpawner' });
        }
      }
    }

    return result;
  }

  /**
   * Build merged environment from connections, filtered by package source.
   * Only injects env vars belonging to the target package (or global '*').
   */
  private connectionsToEnv(connections?: ServiceConnection[], packageSource?: string): Record<string, string> {
    if (!connections?.length) return {};
    const result: Record<string, string> = {};
    for (const conn of connections) {
      if (!conn.envVar || !conn.value) continue;
      if (conn.source === '*' || !packageSource || conn.source === packageSource) {
        result[conn.envVar] = conn.value;
      }
    }
    return result;
  }

  /**
   * Spawn dev process for a package.
   * Dispatches to language-specific spawn based on projectProfile.
   */
  spawn(pkg: PackageInfo, port: number, options: SpawnOptions): ChildProcess {
    const lang = (pkg.projectProfile?.language || 'typescript').toLowerCase();
    
    switch (lang) {
      case 'typescript':
      case 'javascript':
        return this.spawnNode(pkg, port, options);
      case 'go':
      case 'python':
      case 'rust':
      case 'java':
      default:
        return this.spawnByLanguage(pkg, port, lang, options);
    }
  }
  
  /**
   * Spawn Node.js / TypeScript dev process (vite, next, npm run dev, etc.)
   */
  private spawnNode(pkg: PackageInfo, port: number, options: SpawnOptions): ChildProcess {
    const pkgJson = pkg.packageJson;
    const devScript = pkgJson?.scripts?.dev || pkgJson?.scripts?.start;
    
    let command: string;
    let args: string[] = [];
    
    // Determine command based on package type and script content
    const isNextJs = devScript?.includes('next');
    
    if (pkg.type === 'frontend') {
      if (devScript?.includes('vite')) {
        command = 'npx';
        args = ['vite', '--port', port.toString(), '--host', '0.0.0.0'];
      } else if (isNextJs) {
        command = 'npx';
        args = ['next', 'dev', '-p', port.toString(), '--hostname', '0.0.0.0'];
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
    
    // Inject base path environment variables for ALL frontend frameworks.
    // Every framework uses its native base path mechanism so that
    // the proxy can always keep the URL key prefix and stream responses
    // without any HTML rewriting.
    //
    // Framework-specific env vars:
    //   Next.js:  NEXT_PUBLIC_BASE_PATH  → next.config.js basePath
    //   Vite:     VITE_BASE_PATH         → vite.config.ts base
    // Universal:  ANT_BASE_PATH          → generic fallback for custom setups
    const basePathEnv: Record<string, string> = {};
    if (pkg.type === 'frontend' && options.serverKey) {
      const urlKey = toUrlKey(options.serverKey);
      const basePath = `/${urlKey}`;

      // Universal env var (always injected for frontend packages)
      basePathEnv.ANT_BASE_PATH = basePath;

      if (isNextJs) {
        basePathEnv.NEXT_PUBLIC_BASE_PATH = basePath;
      } else if (devScript?.includes('vite')) {
        basePathEnv.VITE_BASE_PATH = basePath;
      }
    }
    
    // Environment variable priority (low to high):
    //   1. process.env (system)
    //   2. project root .env / .env.local (workspace-level)
    //   3. package .env / .env.local (package-level override)
    //   4. connections[].envVar=value
    //   5. platform injected (PORT, base path, polling)
    //   6. extraEnv (caller override)
    const projectEnv = this.loadProjectEnv(pkg.path, options.projectRoot);
    const connectionsEnv = this.connectionsToEnv(options.connections, options.packageSource);

    const env = {
      ...process.env,
      ...projectEnv,
      ...connectionsEnv,
      PORT: port.toString(),
      NODE_ENV: 'development',
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
      CHOKIDAR_USEPOLLING: 'true',
      CHOKIDAR_INTERVAL: '3000',
      WATCHPACK_POLLING: 'true',
      ...basePathEnv,
      ...(options.extraEnv || {})
    };
    
    logger.warn(`[Preview] Starting ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    logger.warn(`[Preview] Command: ${command} ${args.join(' ')}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    options.onLog('stdout', `📋 Command: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      detached: true,
      env,
      stdio: 'pipe'
    });
    
    logger.warn(`[Preview] Process spawned PID=${childProcess.pid}`, { component: 'ProcessSpawner' });
    
    // Setup logging
    childProcess.stdout?.on('data', (data) => {
      options.onLog('stdout', data.toString());
    });
    
    childProcess.stderr?.on('data', (data) => {
      options.onLog('stderr', data.toString());
    });
    
    childProcess.on('close', (code, signal) => {
      logger.info(`Process exited PID=${childProcess.pid} code=${code}`, { component: 'ProcessSpawner' });
      options.onExit(code, signal);
    });
    
    childProcess.on('error', (error) => {
      logger.error(`Process error PID=${childProcess.pid}: ${error.message}`, { component: 'ProcessSpawner' }, error);
      options.onError(error);
    });
    
    return childProcess;
  }
  
  /**
   * Spawn dev process by language (Go, Python, Rust, Java, etc.).
   * Checks Makefile first for dev/run/serve targets, then uses language-specific commands.
   */
  private spawnByLanguage(pkg: PackageInfo, port: number, language: string, options: SpawnOptions): ChildProcess {
    let command: string;
    let args: string[] = [];
    
    // Check Makefile for dev/run/serve targets first (language-agnostic)
    const makefileTarget = this.detectMakefileTarget(pkg.path);
    if (makefileTarget) {
      const requiredCommand = this.getRequiredCommand(language);
      if (requiredCommand && !this.isCommandAvailable(requiredCommand)) {
        options.onLog('stderr', `❌ ${language} toolchain (${requiredCommand}) is not installed. Makefile target '${makefileTarget}' will likely fail.`);
        throw new Error(`${language} toolchain not found in PATH. Cannot start dev server.`);
      }
      command = 'make';
      args = [makefileTarget];
    } else {
      // Language-specific fallback
      switch (language) {
        case 'go':
          if (!this.isCommandAvailable('go')) {
            options.onLog('stderr', '❌ Go toolchain is not installed in this environment. Install Go (https://go.dev/dl/) or use a runtime image that includes it.');
            throw new Error('Go toolchain not found in PATH. Cannot start Go dev server.');
          }
          command = 'go';
          args = ['run', '.'];
          break;
        case 'python': {
          const framework = pkg.projectProfile?.framework?.toLowerCase();
          if (framework === 'django') {
            command = 'python';
            args = ['manage.py', 'runserver', `0.0.0.0:${port}`];
          } else if (framework === 'fastapi') {
            command = 'uvicorn';
            args = ['main:app', '--host', '0.0.0.0', '--port', port.toString(), '--reload'];
          } else if (framework === 'flask') {
            command = 'flask';
            args = ['run', '--host', '0.0.0.0', '--port', port.toString()];
          } else {
            command = 'python';
            args = ['main.py'];
          }
          break;
        }
        case 'rust':
          command = 'cargo';
          args = ['run'];
          break;
        case 'java':
          if (fs.existsSync(path.join(pkg.path, 'gradlew'))) {
            command = './gradlew';
            args = ['bootRun'];
          } else {
            command = 'mvn';
            args = ['spring-boot:run'];
          }
          break;
        default:
          // Unknown language: try make or fail gracefully
          command = 'echo';
          args = [`Unsupported language: ${language}`];
          break;
      }
    }
    
    this.ensureConfigFiles(pkg.path, options.onLog);

    const projectEnv = this.loadProjectEnv(pkg.path, options.projectRoot);
    const connectionsEnv = this.connectionsToEnv(options.connections, options.packageSource);

    const env = {
      ...process.env,
      ...projectEnv,
      ...connectionsEnv,
      PORT: port.toString(),
      ...(options.extraEnv || {})
    };
    
    logger.warn(`[Preview] Starting ${language} ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    logger.warn(`[Preview] Command: ${command} ${args.join(' ')}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${language}) on port ${port}...`);
    options.onLog('stdout', `📋 Command: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      detached: true,
      env,
      stdio: 'pipe'
    });
    
    logger.warn(`[Preview] Process spawned PID=${childProcess.pid}`, { component: 'ProcessSpawner' });
    
    childProcess.stdout?.on('data', (data) => options.onLog('stdout', data.toString()));
    childProcess.stderr?.on('data', (data) => options.onLog('stderr', data.toString()));
    
    childProcess.on('close', (code, signal) => {
      logger.info(`Process exited PID=${childProcess.pid} code=${code}`, { component: 'ProcessSpawner' });
      options.onExit(code, signal);
    });
    
    childProcess.on('error', (error) => {
      logger.error(`Process error PID=${childProcess.pid}: ${error.message}`, { component: 'ProcessSpawner' }, error);
      options.onError(error);
    });
    
    return childProcess;
  }
  
  /**
   * Copy *.example config files to their actual counterparts if missing.
   * Skips .env.example (handled separately by connection detection).
   * Searches project root and immediate subdirectories (depth 1).
   */
  private ensureConfigFiles(projectPath: string, onLog: LogCallback): void {
    const dirsToScan = [projectPath];

    try {
      for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'vendor') {
          const subdir = path.join(projectPath, entry.name);
          dirsToScan.push(subdir);
          // depth 2: one more level for patterns like services/api-server/
          try {
            for (const sub of fs.readdirSync(subdir, { withFileTypes: true })) {
              if (sub.isDirectory() && !sub.name.startsWith('.') && sub.name !== 'node_modules' && sub.name !== 'vendor') {
                dirsToScan.push(path.join(subdir, sub.name));
              }
            }
          } catch { /* permission errors, etc. */ }
        }
      }
    } catch { /* permission errors, etc. */ }

    for (const dir of dirsToScan) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (!file.endsWith('.example')) continue;
          if (file === '.env.example') continue;

          const actualName = file.replace(/\.example$/, '');
          const examplePath = path.join(dir, file);
          const actualPath = path.join(dir, actualName);

          if (!fs.existsSync(actualPath)) {
            try {
              fs.copyFileSync(examplePath, actualPath);
              const relPath = path.relative(projectPath, actualPath);
              logger.info(`[Preview] Auto-created ${relPath} from ${file}`, { component: 'ProcessSpawner' });
              onLog('stdout', `📋 Auto-created ${relPath} from ${file}\n`);
            } catch (err) {
              logger.warn(`[Preview] Failed to copy ${examplePath}: ${err}`, { component: 'ProcessSpawner' });
            }
          }
        }
      } catch { /* skip unreadable dirs */ }
    }
  }

  private getRequiredCommand(language: string): string | null {
    const toolchainMap: Record<string, string> = {
      go: 'go',
      python: 'python',
      rust: 'cargo',
      java: 'java',
    };
    return toolchainMap[language] ?? null;
  }

  /**
   * Detect runnable Makefile target (dev, run, serve)
   */
  private detectMakefileTarget(projectPath: string): string | null {
    try {
      const makefilePath = path.join(projectPath, 'Makefile');
      if (!fs.existsSync(makefilePath)) return null;
      
      const content = fs.readFileSync(makefilePath, 'utf-8');
      // Prefer 'dev' > 'run' > 'serve' order
      for (const target of ['dev', 'run', 'serve']) {
        if (new RegExp(`^${target}:`, 'm').test(content)) {
          return target;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
  
  /**
   * Kill a process and its entire process group.
   * Processes are spawned with detached:true (new process group), so killing
   * with -pid sends the signal to the shell, make/npm, and the actual binary.
   */
  kill(childProcess: ChildProcess): boolean {
    try {
      if (childProcess.killed) return false;
      const pid = childProcess.pid;
      if (pid != null) {
        try {
          // Kill the entire process group (negative PID = group signal)
          process.kill(-pid, 'SIGTERM');
        } catch (groupErr: any) {
          if (groupErr.code !== 'ESRCH') {
            // Fallback: kill just the direct process
            childProcess.kill('SIGTERM');
          }
        }
      } else {
        childProcess.kill('SIGTERM');
      }
      return true;
    } catch (error) {
      logger.warn(`Failed to kill process`, { component: 'ProcessSpawner' }, error);
      return false;
    }
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
