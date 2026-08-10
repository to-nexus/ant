import { spawn, execFileSync } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../../../../utils/logger';
import type { LogCallback } from '../types';
import { loadProjectEnv, composeChildEnv } from './envAssembly';
import { getComposeServices } from '../detectors/ConnectionDetector/enrichCompose';

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'unhealthy' | 'unknown';
}

/**
 * Structured outcome of an infrastructure bring-up. `composePresent=false`
 * means the project ships no compose file (nothing to do → `ok:true`). When
 * `composePresent=true` and `ok=false`, `stage` says where it failed so the
 * caller can fail-fast with an actionable error instead of spawning the app
 * against missing/half-ready infrastructure.
 */
export interface InfraStartResult {
  ok: boolean;
  composePresent: boolean;
  stage?: 'docker-missing' | 'compose-up' | 'readiness' | 'cancelled';
  detail?: string;
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
   * Start infrastructure services via docker compose.
   *
   * Returns a structured result so the caller can fail-fast: a project that
   * ships a compose file but whose infra fails to come up (or is up but not
   * accepting connections) MUST NOT have its app spawned against missing
   * infrastructure — that only produces cryptic runtime errors at the wrong
   * layer.
   */
  async startInfrastructure(
    projectPath: string,
    onLog: LogCallback,
    projectName?: string,
    signal?: AbortSignal,
  ): Promise<InfraStartResult> {
    const composeFile = this.findComposeFile(projectPath);
    if (!composeFile) {
      logger.debug('No docker-compose file found, skipping infrastructure startup', { component: 'InfrastructureManager' });
      return { ok: true, composePresent: false };
    }

    if (signal?.aborted) return { ok: false, composePresent: true, stage: 'cancelled' };

    const dockerAvailable = await this.isDockerAvailable();
    if (!dockerAvailable) {
      const msg = '❌ This project ships a docker-compose infrastructure but Docker is not available. Start Docker (or use a runtime that provides it) and retry.';
      logger.warn(msg, { component: 'InfrastructureManager' });
      onLog('stderr', msg + '\n');
      return { ok: false, composePresent: true, stage: 'docker-missing', detail: 'Docker not available' };
    }

    // Pre-cleanup: remove stale containers/volumes from crashed previous runs
    await this.preCleanup(composeFile, projectName, onLog);

    if (signal?.aborted) return { ok: false, composePresent: true, stage: 'cancelled' };

    const composeDir = path.dirname(composeFile);
    const composeName = path.basename(composeFile);
    // Pass the project's .env so compose `${VAR}` interpolation resolves
    // (image tags, registry hosts, credentials). Without this, compose only
    // sees the bare process env and silently substitutes empty strings.
    const composeEnv = composeChildEnv(loadProjectEnv(projectPath));

    logger.info(`🐳 Starting infrastructure services from ${composeName}`, { component: 'InfrastructureManager' });
    onLog('stdout', `🐳 Starting infrastructure services (${composeName})...\n`);

    const upResult = await new Promise<InfraStartResult>((resolve) => {
      if (signal?.aborted) {
        resolve({ ok: false, composePresent: true, stage: 'cancelled' });
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
        env: composeEnv,
      });

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
          resolve({ ok: false, composePresent: true, stage: 'cancelled' });
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          const msg = `❌ Infrastructure startup timed out after ${this.STARTUP_TIMEOUT / 1000}s.`;
          logger.warn(msg, { component: 'InfrastructureManager' });
          onLog('stderr', msg + '\n');
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          resolve({ ok: false, composePresent: true, stage: 'compose-up', detail: `timed out after ${this.STARTUP_TIMEOUT / 1000}s` });
        }
      }, this.STARTUP_TIMEOUT);

      child.stdout?.on('data', (data: Buffer) => {
        onLog('stdout', data.toString());
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
          logger.info('✅ Infrastructure containers started', { component: 'InfrastructureManager' });
          resolve({ ok: true, composePresent: true });
        } else {
          const tail = stderr.slice(-500).trim();
          const msg = `❌ docker compose up exited with code ${code}.`;
          logger.warn(`${msg} stderr: ${tail}`, { component: 'InfrastructureManager' });
          onLog('stderr', msg + '\n');
          resolve({ ok: false, composePresent: true, stage: 'compose-up', detail: tail || `exit code ${code}` });
        }
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);

        const msg = `❌ Failed to start infrastructure: ${error.message}`;
        logger.warn(msg, { component: 'InfrastructureManager' });
        onLog('stderr', msg + '\n');
        resolve({ ok: false, composePresent: true, stage: 'compose-up', detail: error.message });
      });
    });

    if (!upResult.ok) return upResult;

    // Readiness probe: `--wait` only guarantees containers reached `running`;
    // services without a healthcheck are "ready" the instant they spawn. Probe
    // each published host port so the app never connects before the DB accepts.
    const readiness = await this.probeReadiness(projectPath, onLog, signal);
    if (!readiness.ok) return readiness;

    onLog('stdout', '✅ Infrastructure services ready\n');
    return { ok: true, composePresent: true };
  }

  private readonly READINESS_TIMEOUT = 30_000;
  private readonly READINESS_INTERVAL = 500;

  /**
   * TCP-probe every published compose host port until it accepts a connection
   * or the budget is exhausted. Stack-neutral readiness gate that closes the
   * `docker compose up --wait` false-positive for healthcheck-less services.
   */
  private async probeReadiness(projectPath: string, onLog: LogCallback, signal?: AbortSignal): Promise<InfraStartResult> {
    const ports = Array.from(
      new Set(getComposeServices(projectPath).map(s => s.port).filter((p): p is number => typeof p === 'number')),
    );
    if (ports.length === 0) return { ok: true, composePresent: true };

    const deadline = Date.now() + this.READINESS_TIMEOUT;
    for (const port of ports) {
      let ready = false;
      while (Date.now() < deadline) {
        if (signal?.aborted) return { ok: false, composePresent: true, stage: 'cancelled' };
        if (await this.canConnect(port)) { ready = true; break; }
        await new Promise(r => setTimeout(r, this.READINESS_INTERVAL));
      }
      if (!ready) {
        const msg = `❌ Infrastructure service on port ${port} did not accept connections within ${this.READINESS_TIMEOUT / 1000}s.`;
        logger.warn(msg, { component: 'InfrastructureManager' });
        onLog('stderr', msg + '\n');
        return { ok: false, composePresent: true, stage: 'readiness', detail: `port ${port} not accepting connections` };
      }
    }
    return { ok: true, composePresent: true };
  }

  private canConnect(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(2000);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
      socket.connect(port, host);
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
    const composeEnv = composeChildEnv(loadProjectEnv(projectPath));

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
        env: composeEnv,
      });

      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          logger.warn('Infrastructure shutdown timed out, escalating to SIGKILL', { component: 'InfrastructureManager' });
          try { child.kill('SIGTERM'); } catch { /* ignore */ }
          // Escalate if `docker compose down` itself hangs (stuck container stop).
          setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
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
        env: composeChildEnv(loadProjectEnv(path.dirname(composeFile))),
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
        env: composeChildEnv(loadProjectEnv(projectPath)),
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
