import { spawn, execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback } from '../types';

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unhealthy' | 'unknown';
}

/**
 * InfrastructureManager
 * 
 * Manages Docker Compose infrastructure services for preview servers.
 * Detects docker-compose.yml in the project, starts/stops services,
 * and provides status information.
 * 
 * Follows the same pattern as Ant CLI's own dev:infra scripts:
 *   "dev:infra": "docker compose up -d"
 *   "dev:infra:down": "docker compose down"
 */
export class InfrastructureManager {
  private readonly DOCKER_COMPOSE_FILES = [
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ];

  private readonly STARTUP_TIMEOUT = 60_000; // 60 seconds for docker compose up --wait
  private readonly SHUTDOWN_TIMEOUT = 30_000; // 30 seconds for docker compose down

  /**
   * Check if Docker is available on the system
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      execFileSync('docker', ['info'], { 
        encoding: 'utf-8', 
        timeout: 5000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find docker-compose file in the project
   */
  findComposeFile(projectPath: string): string | null {
    for (const fileName of this.DOCKER_COMPOSE_FILES) {
      const filePath = path.join(projectPath, fileName);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    return null;
  }

  /**
   * Start infrastructure services via docker compose
   * 
   * @returns true if services started successfully, false otherwise
   */
  async startInfrastructure(
    projectPath: string,
    onLog: LogCallback,
    projectName?: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const composeFile = this.findComposeFile(projectPath);
    if (!composeFile) {
      logger.debug('No docker-compose file found, skipping infrastructure startup', { component: 'InfrastructureManager' });
      return true; // No infrastructure needed = success
    }

    if (signal?.aborted) return false;

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      const msg = '⚠️ Docker not found. Infrastructure services will not be started. App may fail to connect to external services.';
      logger.warn(msg, { component: 'InfrastructureManager' });
      onLog('stderr', msg + '\n');
      return false;
    }

    // Pre-cleanup: remove stale containers/volumes from crashed previous runs
    await this.preCleanup(composeFile, projectName, onLog);

    if (signal?.aborted) return false;

    const composeDir = path.dirname(composeFile);
    const composeName = path.basename(composeFile);

    logger.info(`🐳 Starting infrastructure services from ${composeName}`, { component: 'InfrastructureManager' });
    onLog('stdout', `🐳 Starting infrastructure services (${composeName})...\n`);

    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }

      const args = ['compose', '-f', composeFile];

      // Use project name for isolation between different projects
      if (projectName) {
        args.push('-p', projectName);
      }

      args.push('up', '-d', '--wait', '--quiet-pull', '--force-recreate', '--remove-orphans');

      const child = spawn('docker', args, {
        cwd: composeDir,
        shell: false,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const onAbort = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          logger.info('Infrastructure startup cancelled by user', { component: 'InfrastructureManager' });
          onLog('stderr', '⏹️ Infrastructure startup cancelled\n');
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
          resolve(false);
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          const msg = `⚠️ Infrastructure startup timed out after ${this.STARTUP_TIMEOUT / 1000}s. Continuing anyway.`;
          logger.warn(msg, { component: 'InfrastructureManager' });
          onLog('stderr', msg + '\n');
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          resolve(false);
        }
      }, this.STARTUP_TIMEOUT);

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        onLog('stdout', chunk);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        const filtered = this.filterDockerProgress(chunk);
        if (filtered) {
          onLog('stdout', filtered);
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);

        if (code === 0) {
          logger.info('✅ Infrastructure services started successfully', { component: 'InfrastructureManager' });
          onLog('stdout', '✅ Infrastructure services ready\n');
          resolve(true);
        } else {
          const msg = `⚠️ docker compose up exited with code ${code}. Continuing anyway.`;
          logger.warn(`${msg} stderr: ${stderr.slice(-500)}`, { component: 'InfrastructureManager' });
          onLog('stderr', msg + '\n');
          resolve(false);
        }
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);

        const msg = `⚠️ Failed to start infrastructure: ${error.message}`;
        logger.warn(msg, { component: 'InfrastructureManager' });
        onLog('stderr', msg + '\n');
        resolve(false);
      });
    });
  }

  /**
   * Stop infrastructure services via docker compose
   * 
   * Best-effort: errors are logged but do not block cleanup
   */
  async stopInfrastructure(
    projectPath: string,
    onLog: LogCallback,
    projectName?: string,
  ): Promise<void> {
    const composeFile = this.findComposeFile(projectPath);
    if (!composeFile) {
      return; // No infrastructure to stop
    }

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return; // Can't stop what we can't reach
    }

    const composeDir = path.dirname(composeFile);

    logger.info('🐳 Stopping infrastructure services', { component: 'InfrastructureManager' });
    onLog('stdout', '🐳 Stopping infrastructure services...\n');

    return new Promise((resolve) => {
      const args = ['compose', '-f', composeFile];

      if (projectName) {
        args.push('-p', projectName);
      }

      args.push('down', '-v');

      const child = spawn('docker', args, {
        cwd: composeDir,
        shell: false,
        stdio: 'pipe',
      });

      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          logger.warn('Infrastructure shutdown timed out, continuing cleanup', { component: 'InfrastructureManager' });
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          resolve();
        }
      }, this.SHUTDOWN_TIMEOUT);

      child.stdout?.on('data', (data: Buffer) => {
        onLog('stdout', data.toString());
      });

      child.stderr?.on('data', (data: Buffer) => {
        const filtered = this.filterDockerProgress(data.toString());
        if (filtered) {
          onLog('stdout', filtered);
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        if (code === 0) {
          logger.info('✅ Infrastructure services stopped', { component: 'InfrastructureManager' });
          onLog('stdout', '✅ Infrastructure services stopped\n');
        } else {
          logger.warn(`docker compose down exited with code ${code}`, { component: 'InfrastructureManager' });
        }
        resolve();
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        logger.warn(`Failed to stop infrastructure: ${error.message}`, { component: 'InfrastructureManager' });
        resolve(); // Best-effort: don't block cleanup
      });
    });
  }

  /**
   * Best-effort pre-cleanup: tear down stale containers and volumes from previous runs.
   * Handles the case where a prior `docker compose down -v` timed out, the Pod crashed,
   * or the stop request was routed to a different Pod that couldn't reach these containers.
   */
  private async preCleanup(composeFile: string, projectName: string | undefined, onLog: LogCallback): Promise<void> {
    const PRE_CLEANUP_TIMEOUT = 15_000;
    return new Promise((resolve) => {
      const args = ['compose', '-f', composeFile];
      if (projectName) args.push('-p', projectName);
      args.push('down', '-v', '--remove-orphans');

      const child = spawn('docker', args, {
        cwd: path.dirname(composeFile),
        shell: false,
        stdio: 'pipe',
      });

      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          logger.warn('Pre-cleanup timed out, proceeding with startup', { component: 'InfrastructureManager' });
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          resolve();
        }
      }, PRE_CLEANUP_TIMEOUT);

      child.stderr?.on('data', () => {}); // drain
      child.stdout?.on('data', () => {}); // drain

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (code === 0) {
          logger.debug('Pre-cleanup completed (stale containers/volumes removed)', { component: 'InfrastructureManager' });
        } else {
          logger.debug(`Pre-cleanup exited with code ${code} (no stale containers or already clean)`, { component: 'InfrastructureManager' });
        }
        resolve();
      });

      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }

  /**
   * Get status of infrastructure services
   */
  async getInfraStatus(projectPath: string, projectName?: string): Promise<ServiceStatus[]> {
    const composeFile = this.findComposeFile(projectPath);
    if (!composeFile) {
      return [];
    }

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      return [];
    }

    try {
      const args = ['compose', '-f', composeFile];
      if (projectName) {
        args.push('-p', projectName);
      }
      args.push('ps', '--format', 'json');

      const output = execFileSync('docker', args, {
        cwd: path.dirname(composeFile),
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: 'pipe',
      });

      if (!output.trim()) {
        return [];
      }

      // docker compose ps --format json outputs one JSON object per line
      const services: ServiceStatus[] = [];
      for (const line of output.trim().split('\n')) {
        try {
          const svc = JSON.parse(line);
          services.push({
            name: svc.Service || svc.Name || 'unknown',
            status: this.parseServiceState(svc.State || svc.Status || ''),
          });
        } catch {
          // Skip unparseable lines
        }
      }

      return services;
    } catch {
      return [];
    }
  }

  private static readonly DOCKER_PROGRESS_RE = /^[a-f0-9]{12}\s+(Pulling|Downloading|Extracting|Waiting|Verifying|Already exists|Pull complete|Download complete)/i;

  /**
   * Filter out Docker image pull/push progress lines from stderr output.
   * Returns the filtered string, or empty string if nothing meaningful remains.
   */
  private filterDockerProgress(chunk: string): string {
    const filtered = chunk.split('\n')
      .filter(line => !InfrastructureManager.DOCKER_PROGRESS_RE.test(line.trim()))
      .join('\n');
    return filtered.trim() ? filtered : '';
  }

  private parseServiceState(state: string): ServiceStatus['status'] {
    const lower = state.toLowerCase();
    if (lower.includes('running') || lower.includes('up')) return 'running';
    if (lower.includes('unhealthy')) return 'unhealthy';
    if (lower.includes('exited') || lower.includes('stopped') || lower.includes('dead')) return 'stopped';
    return 'unknown';
  }
}
