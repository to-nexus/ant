/**
 * IDEService
 * 
 * Manages user-specific IDE containers.
 * Each user gets their own isolated IDE environment.
 */

import Docker from 'dockerode';
import { UserContext } from '../../../core/types/user';
import { PortManager } from '../../../infrastructure/networking/PortManager';
import { PortRegistryPort } from '../../../core/ports/portRegistry';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { logger } from '../../../utils/logger';
import { WorkspacePathResolver } from '../../../core/config/WorkspacePathResolver';
import { GitHelper } from '../http/services/GitService/helper/GitHelper';
import { RESERVED_FEATURE_NAME } from '../../../core/utils/branchUtils';

export interface IDEInstance {
  containerId: string;
  port: number;
  url: string;
  workspacePath: string;  // ✅ Docker 내부 경로 추가
  tenantId: string;
  projectId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  lastAccessedAt: Date;
}

export class IDEService {
  private docker: Docker;  // Docker instance
  private portManager: PortManager;
  private portRegistry: PortRegistryPort;
  private instances: Map<string, IDEInstance> = new Map();
  private idleCheckInterval?: NodeJS.Timeout;
  
  private readonly IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  // ✅ Default to OpenVSCode Server (matches @ant/ide usage). Override via ANT_IDE_IMAGE.
  private readonly IMAGE = process.env.ANT_IDE_IMAGE || 'gitpod/openvscode-server:latest';
  
  constructor(portManager: PortManager, portRegistry: PortRegistryPort) {
    this.docker = new Docker();
    this.portManager = portManager;
    this.portRegistry = portRegistry;
  }

  /**
   * Stop+remove all IDE containers for a project (all features) and optionally delete the IDE home directory.
   * This is the "Docker dashboard trash" equivalent triggered by project deletion.
   */
  async cleanupProject(userContext: UserContext, projectId: string, options?: { deleteHome?: boolean }): Promise<void> {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    const deleteHome = options?.deleteHome !== false; // default: true

    // 1) Stop tracked instances (normal path)
    const trackedKeys = Array.from(this.instances.keys()).filter(k => k.startsWith(`${tenantId}:${projectId}:`));
    for (const key of trackedKeys) {
      const parts = key.split(':');
      const [orgId, userId, projId, ...featureParts] = parts;
      const feat = featureParts.join(':') || RESERVED_FEATURE_NAME;
      await this.stopIDE(`${orgId}:${userId}`, projId, feat).catch((e) => {
        logger.warn(`Failed to stop tracked IDE during project cleanup`, { component: 'IDEService', organizationId: orgId, userId, projectId: projId, featureName: feat }, e);
      });
    }

    // 2) Best-effort: remove any remaining containers by labels (covers server restarts)
    // IMPORTANT: Do NOT use name-prefix matching. Project IDs like "ant-news" and "ant-news-desk"
    // collide under prefix matching and can delete the wrong project's containers.
    try {
      const containers = await this.docker.listContainers({ all: true });
      const matches = containers.filter((c: any) => {
        const labels = (c as any).Labels || {};
        return labels['ant.kind'] === 'ide'
          && labels['ant.org'] === userContext.organizationId
          && labels['ant.user'] === userContext.userId
          && labels['ant.project'] === projectId;
      });
      for (const cInfo of matches) {
        const c = this.docker.getContainer(cInfo.Id);
        // stop() can fail when the container is already stopped — that's
        // expected, log + proceed. remove({force: true}) is the source of
        // truth; if THAT fails the container is genuinely stuck.
        try {
          await c.stop();
        } catch (stopErr: any) {
          logger.debug(`IDE container stop returned non-fatal error (likely already stopped)`, {
            component: 'IDEService',
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            projectId,
          }, { containerId: cInfo.Id, error: stopErr?.message });
        }
        try {
          await c.remove({ force: true });
          logger.info(`Removed IDE container (project cleanup)`, {
            component: 'IDEService',
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            projectId,
          }, { containerId: cInfo.Id, name: (cInfo.Names || [])[0] });
        } catch (removeErr) {
          logger.warn(`Failed to remove IDE container (project cleanup)`, {
            component: 'IDEService',
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            projectId,
          }, removeErr);
        }
      }
    } catch (e) {
      logger.warn(`Failed to scan/remove IDE containers (project cleanup)`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId }, e);
    }

    // 3) Delete IDE home directory (host) if requested
    if (deleteHome) {
      const ideHomeBase = process.env.ANT_IDE_HOME_BASE_PATH
        || path.join(WorkspacePathResolver.getPhysicalWorkspacesPath(), '.ide-homes');
      
      // ✅ Sanitize path components to avoid directory traversal
      const sanitizePathComponent = (str: string) => str.replace(/[/\\:*?"<>|]/g, '-');
      
      const ideHomeProjectPath = path.join(
        ideHomeBase, 
        sanitizePathComponent(userContext.organizationId), 
        sanitizePathComponent(userContext.userId), 
        sanitizePathComponent(projectId)
      );
      try {
        await fs.promises.rm(ideHomeProjectPath, { recursive: true, force: true });
        logger.info(`Deleted IDE home directory (project cleanup)`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId }, { ideHomeProjectPath });
      } catch (e) {
        logger.warn(`Failed to delete IDE home directory (project cleanup)`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId }, e);
      }
    }
  }

  private getProjectRootPath(projectId: string): string {
    // Always project mode:
    // - mount project codebase to /{projectId} (sanitized)
    // - avoid colliding with system directory names
    const reserved = new Set([
      'bin', 'sbin', 'etc', 'usr', 'lib', 'lib64', 'proc', 'sys', 'dev', 'run', 'var', 'tmp', 'opt', 'home', 'root',
    ]);
    const safeProject = projectId
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 48) || 'project';
    const normalized = reserved.has(safeProject) ? `project-${safeProject}` : safeProject;
    return `/${normalized}`;
  }

  private getInitialHostname(userContext: UserContext, projectId: string): string {
    // Hostname constraints:
    // - cannot contain ":"
    // - if it contains ".", bash prompt (\h) may display only first label before "."
    // Modes:
    // - (default): {user} only (requested) - keep prompt minimal; project is visible via cwd
    // - containerid: initial ant-ide, then best-effort exec to set containerId after start
    const mode = (process.env.ANT_IDE_HOSTNAME_MODE || '').toLowerCase();
    if (mode === 'containerid') return 'ant-ide';

    const raw = `${userContext.userId}`;
    return raw
      .replace(/[^a-zA-Z0-9-]/g, '-') // also converts dots to dashes
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 63) || 'ant-ide';
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      promise
        .then((v) => {
          clearTimeout(t);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  }

  private async setContainerHostname(container: any, hostname: string): Promise<void> {
    // Best-effort: not all images allow changing hostname at runtime, but with root it usually works.
    try {
      const safe = hostname.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 63);
      const exec = await container.exec({
        Cmd: ['/bin/sh', '-lc', `hostname ${safe}`],
        AttachStdout: true,
        AttachStderr: true,
        User: 'root',
      });
      await new Promise<void>((resolve, reject) => {
        exec.start({} as any, (err: any, stream: any) => {
          if (err) return reject(err);
          if (!stream) return resolve();
          // Drain stream so 'end' reliably fires
          try { stream.resume?.(); } catch {}
          stream.on('end', resolve);
          stream.on('error', reject);
        });
      });
    } catch (e) {
      logger.debug(`Failed to set container hostname (ignored)`, { component: 'IDEService' }, e);
    }
  }

  private async waitForIdePortReady(port: number, timeoutMs: number = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const done = (result: boolean) => {
          socket.removeAllListeners();
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(800);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
      });
      if (ok) return;
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`IDE port not ready in ${timeoutMs}ms (port=${port})`);
  }

  // ✅ More strict readiness: confirm the HTTP server responds (prevents "connection reset" first load)
  private async waitForIdeHttpReady(port: number, timeoutMs: number = 15_000): Promise<void> {
    const start = Date.now();
    const url = `http://127.0.0.1:${port}/`;
    while (Date.now() - start < timeoutMs) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1000);
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal });
        // 200/302/401 etc are fine; we just want the server to be alive and speaking HTTP.
        if (res.status > 0 && res.status < 500) return;
      } catch {
        // ignore until ready
      } finally {
        clearTimeout(t);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`IDE HTTP not ready in ${timeoutMs}ms (port=${port})`);
  }
  
  /**
   * Start IDE for user/project/feature
   * 
   * IDE is feature-level: each feature gets its own isolated IDE container
   * with its own worktree-based codebase.
   */
  async startIDE(userContext: UserContext, projectId: string, workspacePath: string, feature: string = RESERVED_FEATURE_NAME): Promise<IDEInstance> {
    const tenantId = `${userContext.organizationId}:${userContext.userId}`;
    const key = `${tenantId}:${projectId}:${feature}`;

    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_.-]/g, '-');
    const containerName = sanitize(`ant-ide-${userContext.organizationId}-${userContext.userId}-${projectId}-${feature}`);
    const hostname = this.getInitialHostname(userContext, projectId);
    
    // Base path for reverse proxy: /ide/org:user:project:feature (4-part key)
    const serverKey = `${userContext.organizationId}:${userContext.userId}:${projectId}:${feature}`;
    const serverBasePath = `/ide/${serverKey}`;
    
    // Check if already running
    const existing = this.instances.get(key);
    if (existing && existing.status === 'running') {
      existing.lastAccessedAt = new Date();
      
      // Update last access in registry (IDE is feature-level)
      await this.portRegistry.touchIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      );
      
      logger.info(`IDE already running`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature });
      return existing;
    }
    
    logger.info(`Starting IDE`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { workspacePath });
    
    // Allocate port (from IDE port range: 32500-35000)
    const port = await this.portManager.allocate('ide');
    logger.debug(`IDE port allocated`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { port });
    
    // ✅ Always project mode (requested): /{projectId}
    const dockerWorkspacePath = this.getProjectRootPath(projectId);
    logger.debug(`IDE workspace path resolved`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { dockerWorkspacePath });
    
    const ideHomeBase = process.env.ANT_IDE_HOME_BASE_PATH
      || path.join(WorkspacePathResolver.getPhysicalWorkspacesPath(), '.ide-homes');
    
    // ✅ Sanitize path components to avoid directory traversal or invalid paths
    const sanitizePathComponent = (str: string) => str.replace(/[/\\:*?"<>|]/g, '-');
    
    const ideHomeHostPath = path.join(
      ideHomeBase,
      sanitizePathComponent(userContext.organizationId),
      sanitizePathComponent(userContext.userId),
      sanitizePathComponent(projectId),
      sanitizePathComponent(feature)
    );
    
    logger.debug(`IDE home path calculation`, { 
      component: 'IDEService', 
      organizationId: userContext.organizationId, 
      userId: userContext.userId, 
      projectId, 
      featureName: feature 
    }, { 
      ideHomeBase, 
      ideHomeHostPath,
      physicalWorkspacesPath: WorkspacePathResolver.getPhysicalWorkspacesPath()
    });
    
    // Ensure per-project home exists (persists extensions/settings per project)
    await fs.promises.mkdir(ideHomeHostPath, { recursive: true });
    
    try {
      // Register in PortRegistry (IDE is feature-level)
      await this.portRegistry.registerIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        port,
        'localhost',
        containerName,  // podId (container name for Docker)
        feature
      );
      logger.debug(`IDE registered in PortRegistry`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { port });

      // ✅ Defensive: if a previous container with the same name exists (server restart),
      // remove it to avoid "Conflict. The container name is already in use".
      try {
        const existingContainers = await this.docker.listContainers({ all: true });
        const sameName = existingContainers.find((c: any) => (c.Names || []).includes(`/${containerName}`));
        if (sameName) {
          logger.warn(`Removing existing IDE container with same name`, {
            component: 'IDEService',
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            projectId,
            featureName: feature
          }, { containerName, containerId: sameName.Id });
          const c = this.docker.getContainer(sameName.Id);
          // stop may fail if not running
          await c.stop().catch(() => undefined);
          await c.remove({ force: true }).catch(() => undefined);
        }
      } catch (e) {
        logger.debug(`Container pre-cleanup skipped`, { component: 'IDEService' }, e);
      }
      
      // Create container
      // Resolve additional bind mounts needed for git worktree support.
      // Worktree .git files reference the main repo's .git directory via absolute host paths;
      // these must be accessible inside the container at the same paths.
      const worktreeBinds = GitHelper.resolveWorktreeBindMounts(workspacePath);
      
      const createContainer = async () => {
        const binds = [
          `${workspacePath}:${dockerWorkspacePath}:rw`,
          `${ideHomeHostPath}:/home/coder:rw`,
          `${ideHomeHostPath}:/home/openvscode:rw`,
          `${ideHomeHostPath}:/home/openvscode-server:rw`,
          ...worktreeBinds,
        ];

        return await this.docker.createContainer({
        Image: this.IMAGE,
        name: containerName,
        Hostname: hostname,
        Labels: {
          'ant.kind': 'ide',
          'ant.org': userContext.organizationId,
          'ant.user': userContext.userId,
          'ant.project': projectId,
          'ant.feature': feature,
        },
        Env: [
          `USER_ID=${userContext.userId}`,
          `ORG_ID=${userContext.organizationId}`,
          `PROJECT_ID=${projectId}`,
          `FEATURE=${feature}`,
          `DEFAULT_WORKSPACE=${dockerWorkspacePath}`,
          `WORKSPACE=${dockerWorkspacePath}`,
        ],
        ExposedPorts: {
          '3000/tcp': {}
        },
        HostConfig: {
          Binds: binds,
          PortBindings: {
            '3000/tcp': [{ HostPort: port.toString() }]
          },
          Memory: 2 * 1024 * 1024 * 1024, // 2GB
          NanoCpus: 2 * 1000000000, // 2 CPUs
        },
        WorkingDir: dockerWorkspacePath,
        Cmd: [
          '/home/.openvscode-server/bin/openvscode-server',
          '--host', '0.0.0.0',
          '--without-connection-token',
          '--server-base-path', serverBasePath
        ]
      });
      };

      let container: any;  // Docker.Container (dockerode has no types)
      try {
        container = await this.withTimeout(createContainer(), 20_000, 'docker.createContainer');
      } catch (err: any) {
        const msg = String(err?.message || err);
        // ✅ Auto-pull image if missing, then retry once
        if (msg.includes('No such image') || msg.includes('no such image')) {
          logger.warn(`IDE image missing. Pulling...`, { component: 'IDEService' }, { image: this.IMAGE });
          await new Promise<void>((resolve, reject) => {
            this.docker.pull(this.IMAGE, (pullErr: any, stream: any) => {
              if (pullErr) return reject(pullErr);
              if (!stream) return resolve();
              this.docker.modem.followProgress(stream, (progressErr: any) => {
                if (progressErr) reject(progressErr);
                else resolve();
              });
            });
          });
          container = await this.withTimeout(createContainer(), 20_000, 'docker.createContainer(afterPull)');
        } else {
          throw err;
        }
      }
      
      logger.debug(`IDE container created`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { containerId: (container as any)?.id, containerName, image: this.IMAGE });
      
      // Start container
      await this.withTimeout(container.start(), 30_000, 'docker.container.start');
      logger.debug(`IDE container started`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { port });
      
      // ✅ Optional: set hostname to containerId (best-effort, never blocks)
      if ((process.env.ANT_IDE_HOSTNAME_MODE || '').toLowerCase() === 'containerid') {
        this.setContainerHostname(container, container.id.slice(0, 12)).catch(() => undefined);
      }
      
      // ✅ Wait until the port is accepting connections (prevents iframe race)
      await this.withTimeout(this.waitForIdePortReady(port), 30_000, 'ide.portReady');
      logger.debug(`IDE port is ready`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { port });

      // ✅ Then wait for HTTP response (short bounded) to avoid first-load "connection reset" in iframe.
      await this.withTimeout(this.waitForIdeHttpReady(port), 20_000, 'ide.httpReady');
      logger.debug(`IDE HTTP is ready`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, { port });
      
      const instance: IDEInstance = {
        containerId: container.id,
        port,
        url: serverBasePath,  // 4-part: /ide/org:user:project:feature (feature-level)
        workspacePath: dockerWorkspacePath,  // ✅ Docker 내부 경로 저장
        tenantId,
        projectId,
        status: 'running',
        createdAt: new Date(),
        lastAccessedAt: new Date()
      };
      
      this.instances.set(key, instance);
      
      logger.info(`IDE started on port ${port}`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature });
      
      return instance;
      
    } catch (error) {
      logger.error(`Failed to start IDE`, { component: 'IDEService', organizationId: userContext.organizationId, userId: userContext.userId, projectId, featureName: feature }, error);
      // Rollback port allocation and registry
      this.portManager.release(port);
      await this.portRegistry.unregisterIDE(
        userContext.organizationId,
        userContext.userId,
        projectId,
        feature
      ).catch(console.error);
      throw error;
    }
  }
  
  /**
   * Stop IDE
   */
  async stopIDE(tenantId: string, projectId: string, feature: string = RESERVED_FEATURE_NAME): Promise<void> {
    const key = `${tenantId}:${projectId}:${feature}`;
    const instance = this.instances.get(key);
    
    if (!instance) {
      logger.debug(`IDE not found: ${key}`, { component: 'IDEService' });
      return;
    }
    
    logger.info(`Stopping IDE: ${key}`, { component: 'IDEService' });
    
    try {
      const container = this.docker.getContainer(instance.containerId);
      await container.stop();
      await container.remove();
      
      logger.info(`IDE stopped: ${key}`, { component: 'IDEService' });
      
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.reason;
      const isNotFound = statusCode === 404
        || String(error?.message || '').includes('no such container')
        || String(error?.message || '').includes('No such container');
      
      if (isNotFound) {
        // Container already gone (crashed, manually removed, Docker pruned, etc.)
        // Proceed with cleanup of in-memory state and port/registry.
        logger.warn(`IDE container already removed, cleaning up stale entry: ${key}`, { component: 'IDEService' }, { containerId: instance.containerId });
      } else {
        // Genuine error (e.g. Docker daemon unreachable) — still clean up in-memory state
        // to avoid infinite retry loops from the idle checker.
        logger.error(`Failed to stop IDE container: ${key}`, { component: 'IDEService' }, error);
      }
    }
    
    // Always clean up in-memory state, port, and registry — even if container stop/remove failed.
    // This prevents stale entries from causing repeated errors in the idle checker.
    try {
      this.portManager.release(instance.port);
    } catch (e) {
      logger.debug(`Failed to release port for IDE: ${key}`, { component: 'IDEService' }, e);
    }
    
    try {
      const [orgId, userId] = tenantId.split(':');
      await this.portRegistry.unregisterIDE(orgId, userId, projectId, feature);
    } catch (e) {
      logger.debug(`Failed to unregister IDE from PortRegistry: ${key}`, { component: 'IDEService' }, e);
    }
    
    this.instances.delete(key);
  }
  
  /**
   * Get IDE status
   */
  async getIDEStatus(tenantId: string, projectId: string, feature: string = RESERVED_FEATURE_NAME): Promise<IDEInstance | null> {
    const key = `${tenantId}:${projectId}:${feature}`;
    const instance = this.instances.get(key);
    
    if (!instance) {
      return null;
    }
    
    // Update last accessed
    instance.lastAccessedAt = new Date();
    
    // Update in registry (IDE is feature-level)
    const [orgId, userId] = tenantId.split(':');
    await this.portRegistry.touchIDE(orgId, userId, projectId, feature);
    
    return instance;
  }
  
  /**
   * List all running IDEs
   */
  listIDEs(): IDEInstance[] {
    return Array.from(this.instances.values());
  }
  
  /**
   * Start idle checker (auto-shutdown)
   */
  startIdleChecker(): void {
    if (this.idleCheckInterval) {
      return;
    }
    
    this.idleCheckInterval = setInterval(async () => {
      await this.checkIdleContainers();
    }, 60 * 1000); // Check every minute
    
    logger.info(`Idle checker started (timeout: ${this.IDLE_TIMEOUT / 1000}s)`, { component: 'IDEService' });
  }
  
  /**
   * Stop idle checker
   */
  stopIdleChecker(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = undefined;
      logger.info(`Idle checker stopped`, { component: 'IDEService' });
    }
  }
  
  /**
   * Check and stop idle containers
   */
  private async checkIdleContainers(): Promise<void> {
    const now = Date.now();
    
    for (const [key, instance] of this.instances.entries()) {
      const idleTime = now - instance.lastAccessedAt.getTime();
      
      if (idleTime > this.IDLE_TIMEOUT) {
        logger.info(`Stopping idle IDE: ${key} (idle: ${Math.round(idleTime / 1000)}s)`, { component: 'IDEService' });
        
        try {
          const parts = key.split(':');
          if (parts.length >= 3) {
            const [orgId, userId, projId, ...featureParts] = parts;
            const tenantId = `${orgId}:${userId}`;
            const feat = featureParts.join(':') || RESERVED_FEATURE_NAME;
            await this.stopIDE(tenantId, projId, feat);
          }
        } catch (error) {
          logger.warn(`Failed to stop idle IDE: ${key}`, { component: 'IDEService' }, error);
        }
      }
    }
  }
  
  /**
   * Cleanup all IDEs
   */
  async cleanup(): Promise<void> {
    logger.info(`Cleaning up all IDEs...`, { component: 'IDEService' });
    
    this.stopIdleChecker();
    
    const keys = Array.from(this.instances.keys());
    
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length >= 3) {
        const [orgId, userId, projectId, ...featureParts] = parts;
        const tenantId = `${orgId}:${userId}`;
        const feature = featureParts.join(':') || RESERVED_FEATURE_NAME;
        
        try {
          await this.stopIDE(tenantId, projectId, feature);
        } catch (error) {
          logger.warn(`Failed to cleanup IDE: ${key}`, { component: 'IDEService' }, error);
        }
      }
    }
    
    logger.info(`Cleanup complete`, { component: 'IDEService' });
  }
}

