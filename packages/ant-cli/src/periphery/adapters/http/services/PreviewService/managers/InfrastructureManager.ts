import { spawn, execSync } from 'child_process';
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
      execSync('docker info', { 
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
  ): Promise<boolean> {
    const composeFile = this.findComposeFile(projectPath);
    if (!composeFile) {
      logger.debug('No docker-compose file found, skipping infrastructure startup', { component: 'InfrastructureManager' });
      return true; // No infrastructure needed = success
    }

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      const msg = '⚠️ Docker not found. Infrastructure services will not be started. App may fail to connect to external services.';
      logger.warn(msg, { component: 'InfrastructureManager' });
      onLog('stderr', msg + '\n');
      return false;
    }

    const composeDir = path.dirname(composeFile);
    const composeName = path.basename(composeFile);

    logger.info(`🐳 Starting infrastructure services from ${composeName}`, { component: 'InfrastructureManager' });
    onLog('stdout', `🐳 Starting infrastructure services (${composeName})...\n`);

    return new Promise((resolve) => {
      const args = ['compose', '-f', composeFile];

      // Use project name for isolation between different projects
      if (projectName) {
        args.push('-p', projectName);
      }

      args.push('up', '-d', '--wait');

      const child = spawn('docker', args, {
        cwd: composeDir,
        shell: false,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
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
        // Docker compose writes progress to stderr, treat as stdout for display
        onLog('stdout', chunk);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

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

      args.push('down');

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
        // Docker compose writes progress to stderr
        onLog('stdout', data.toString());
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

      const output = execSync(['docker', ...args].join(' '), {
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

  private parseServiceState(state: string): ServiceStatus['status'] {
    const lower = state.toLowerCase();
    if (lower.includes('running') || lower.includes('up')) return 'running';
    if (lower.includes('unhealthy')) return 'unhealthy';
    if (lower.includes('exited') || lower.includes('stopped') || lower.includes('dead')) return 'stopped';
    return 'unknown';
  }
}
