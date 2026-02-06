import { spawn, ChildProcess, execSync } from 'child_process';
import { PackageInfo, LogCallback, ExitCallback } from '../types';
import { logger } from '../../../../../../utils/logger';

export interface SpawnOptions {
  serverKey: string;
  extraEnv?: Record<string, string | undefined>;
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
   * Spawn dev process for a package
   */
  spawn(pkg: PackageInfo, port: number, options: SpawnOptions): ChildProcess {
    const pkgJson = pkg.packageJson;
    const devScript = pkgJson.scripts?.dev || pkgJson.scripts?.start;
    
    let command: string;
    let args: string[] = [];
    
    // Determine command based on package type and script content
    if (pkg.type === 'frontend') {
      if (devScript?.includes('vite')) {
        command = 'npx';
        args = ['vite', '--port', port.toString(), '--host', '0.0.0.0'];
      } else if (devScript?.includes('next')) {
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
    
    const env = {
      ...process.env,
      PORT: port.toString(),
      NODE_ENV: 'development',
      // Prevent auto-opening browser (Vite, CRA, Next.js)
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
      ...(options.extraEnv || {})
    };
    
    logger.warn(`[Preview] Starting ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    logger.warn(`[Preview] Command: ${command} ${args.join(' ')}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    options.onLog('stdout', `📋 Command: ${command} ${args.join(' ')}`);
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
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
   * Kill a process
   */
  kill(process: ChildProcess): boolean {
    try {
      if (!process.killed) {
        process.kill();
        return true;
      }
      return false;
    } catch (error) {
      logger.warn(`Failed to kill process`, { component: 'ProcessSpawner' }, error);
      return false;
    }
  }
}
