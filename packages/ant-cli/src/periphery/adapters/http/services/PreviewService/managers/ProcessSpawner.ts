import { spawn, ChildProcess } from 'child_process';
import { PackageInfo } from '../types';
import { logger } from '../../../../../../utils/logger';

export type LogCallback = (type: 'stdout' | 'stderr', message: string) => void;
export type ExitCallback = (code: number | null, signal: NodeJS.Signals | null) => void;

export interface SpawnOptions {
  serverKey: string;
  extraEnv?: Record<string, string | undefined>;
  onLog: LogCallback;
  onExit: ExitCallback;
  onError: (error: Error) => void;
}

/**
 * ProcessSpawner
 * 
 * Handles spawning dev server processes for different package types.
 * Supports Vite, Next.js, React Scripts, and generic npm scripts.
 */
export class ProcessSpawner {
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
      // Prevent auto-opening browser (Vite, CRA, Next.js)
      BROWSER: 'none',
      BROWSER_ARGS: '--no-sandbox',
      ...(options.extraEnv || {})
    };
    
    logger.info(`Starting ${pkg.type}: ${pkg.name} on port ${port}`, { component: 'ProcessSpawner' });
    options.onLog('stdout', `🚀 Starting ${pkg.name} (${pkg.type}) on port ${port}...`);
    
    logger.debug(`Spawning: ${command} ${args.join(' ')} in ${pkg.path}`, { component: 'ProcessSpawner' });
    
    const childProcess = spawn(command, args, {
      cwd: pkg.path,
      shell: true,
      env,
      stdio: 'pipe'
    });
    
    logger.debug(`Process spawned PID=${childProcess.pid}`, { component: 'ProcessSpawner' });
    
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
