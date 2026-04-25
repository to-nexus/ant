/**
 * FileTreeBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for File Tree updates.
 * 
 * Architecture:
 * - Implements FileTreeUpdatePort for compatibility
 * - Reads file tree directly from filesystem (Job Worker has access)
 * - Broadcasts via Redis Pub/Sub
 * - No HTTP intermediary required
 * 
 * Flow:
 *   Job Worker Child → FileTreeBroadcaster → Redis Pub/Sub → Realtime Server → SSE
 */

import { Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import type { FileNode } from '@ant/shared';
import { FileTreeUpdatePort } from '../ports';
import { UserContext } from '../types/user';
import { 
  getRealtimeBroadcastChannel,
  FileTreeBroadcastMessage,
  BroadcasterOptions 
} from './types';
import { REDIS_KEYS, REDIS_TTL } from '../constants/redis';
import { computeFileMeta, shouldEvaluateTemplate } from '../utils/computeFileMeta';
import { ensureCanonicalStructure } from '../utils/sessionPaths';
import { GitStateBroadcaster } from './GitStateBroadcaster';

// File patterns to exclude from tree
const EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  '.cache',
  '.DS_Store',
  '__pycache__',
  '.env',
  '.env.local',
  'codebase',  // Git worktree directory — browsed via IDE, not Explorer
];


export class FileTreeBroadcaster implements FileTreeUpdatePort {
  private pubRedis: Redis;
  private readonly projectPath: string;
  private readonly userContext?: UserContext;
  private readonly gitStateBroadcaster?: GitStateBroadcaster;
  
  constructor(
    options: BroadcasterOptions & { projectPath: string },
    gitStateBroadcaster?: GitStateBroadcaster
  ) {
    const isTLS = options.redisUrl.startsWith('rediss://');
    const tlsOptions = isTLS ? { tls: { checkServerIdentity: () => undefined as undefined } } : {};
    this.pubRedis = new Redis(options.redisUrl, {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    this.projectPath = options.projectPath;
    this.userContext = options.userContext;
    this.gitStateBroadcaster = gitStateBroadcaster;

    // Error & connection event handlers for diagnostics
    this.pubRedis.on('error', (err) => console.error(`❌ [FileTreeBroadcaster] pubRedis error:`, err.message));
    this.pubRedis.on('ready', () => console.log(`🟢 [FileTreeBroadcaster] pubRedis ready`));
    
    console.log(`✅ [FileTreeBroadcaster] Initialized for path: ${this.projectPath}`);
  }

  /**
   * Notify file tree update
   * Implements FileTreeUpdatePort interface
   */
  async notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: UserContext): Promise<void> {
    const ctx = userContext || this.userContext;
    // Fire-and-forget with error logging
    this.broadcastFileTree(projectId, featureName, ctx)
      .catch(err => {
        console.warn(`[FileTreeBroadcaster] Failed to notify file tree update:`, err.message);
      });

    // Co-emit the unified `gitState` (cause='workingTreeChange') so the
    // frontend refreshes its git snapshot whenever the working tree is
    // mutated — including plain file writes that don't touch `.git/index`
    // (GitWatcherService can't detect those). Covered non-git paths
    // (session JSON writes etc.) produce an inexpensive debounced refetch.
    this.gitStateBroadcaster
      ?.notifyWorkingTreeChange(projectId, featureName, ctx)
      .catch(err => {
        console.warn(`[FileTreeBroadcaster] Failed to co-emit gitState:`, err?.message ?? err);
      });
  }

  /**
   * Broadcast file tree via user-scoped Redis Pub/Sub channel
   */
  private async broadcastFileTree(
    projectId: string, 
    featureName: string,
    userContext?: UserContext
  ): Promise<void> {
    // Require userContext for user-scoped channel
    if (!userContext?.organizationId || !userContext?.userId) {
      console.warn(`[FileTreeBroadcaster] ⚠️ Cannot broadcast without userContext`);
      return;
    }
    
    try {
      // 1. Reconcile canonical structure BEFORE scanning so the cached tree always
      // reflects the current CANONICAL_FEATURE_DIRS. Without this the worker
      // overwrites the API-server-reconciled tree (from FileOperationService.getFileTree)
      // with a stale snapshot, which hides newly added canonical dirs for 24h (cache TTL).
      await ensureCanonicalStructure(this.projectPath);

      // 2. Build file tree from filesystem
      const tree = await this.buildFileTree(this.projectPath);

      // 3. Cache in Redis for cross-pod initial state (bypasses NFS attribute caching)
      const cacheKey = `${REDIS_KEYS.ARTIFACTS.FILETREE}${userContext.userId}:${projectId}:${featureName}`;
      await this.pubRedis.set(cacheKey, JSON.stringify(tree), 'EX', REDIS_TTL.ARTIFACTS.FILETREE);

      // 3. Broadcast via user-scoped Redis Pub/Sub channel
      const message: FileTreeBroadcastMessage = {
        projectId,
        featureName,
        type: 'fileTree',
        data: {
          type: 'update',
          tree,
        },
        userContext,
      };

      const channel = getRealtimeBroadcastChannel(userContext.organizationId, userContext.userId);
      await this.pubRedis.publish(channel, JSON.stringify(message));
      
      console.log(`[FileTreeBroadcaster] ✅ File tree cached + sent to ${channel} for ${projectId}/${featureName}`);
    } catch (error: any) {
      console.error(`[FileTreeBroadcaster] ❌ Error building file tree:`, error.message);
      throw error;
    }
  }

  /**
   * Build file tree from filesystem. All meta computation routes through
   * `computeFileMeta` — no inline template evaluation here.
   */
  private async buildFileTree(dirPath: string, relativePath: string = ''): Promise<FileNode[]> {
    const nodes: FileNode[] = [];

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (EXCLUDE_PATTERNS.some(pattern => entry.name === pattern || entry.name.startsWith('.'))) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (entry.isDirectory()) {
          const children = await this.buildFileTree(fullPath, relPath);
          nodes.push({
            name: entry.name,
            type: 'directory',
            path: relPath,
            children,
          });
          continue;
        }

        if (!entry.isFile()) continue;

        let size = 0;
        let mtimeMs = 0;
        try {
          const stats = await fs.promises.stat(fullPath);
          size = stats.size;
          mtimeMs = stats.mtimeMs;
        } catch { /* skip stat failures */ }

        let content: string | null = null;
        if (shouldEvaluateTemplate(relPath)) {
          try {
            content = await fs.promises.readFile(fullPath, 'utf-8');
          } catch { /* skip read failures */ }
        }

        const meta = computeFileMeta({
          relativePath: relPath,
          content,
          size,
          mtime: mtimeMs,
        });

        nodes.push({
          name: entry.name,
          type: 'file',
          path: relPath,
          meta,
        });
      }

      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.warn(`[FileTreeBroadcaster] Warning reading ${dirPath}:`, error.message);
      }
    }

    return nodes;
  }

  /**
   * Add unseen artifact paths and broadcast update via SSE.
   * Called by job nodes after generating output files.
   */
  async addUnseenArtifacts(
    projectId: string,
    featureName: string,
    artifactPaths: string[],
    userContext?: UserContext
  ): Promise<void> {
    const ctx = userContext || this.userContext;
    if (!ctx?.organizationId || !ctx?.userId) {
      console.warn(`[FileTreeBroadcaster] ⚠️ Cannot add unseen artifacts without userContext`);
      return;
    }
    if (artifactPaths.length === 0) return;

    try {
      // 1. Add to Redis Set
      const key = `${REDIS_KEYS.ARTIFACTS.UNSEEN}${ctx.userId}:${projectId}:${featureName}`;
      await this.pubRedis.sadd(key, ...artifactPaths);
      await this.pubRedis.expire(key, REDIS_TTL.ARTIFACTS.UNSEEN);

      // 2. Broadcast full unseen list via SSE
      const allUnseen = await this.pubRedis.smembers(key);
      const channel = getRealtimeBroadcastChannel(ctx.organizationId, ctx.userId);
      await this.pubRedis.publish(channel, JSON.stringify({
        projectId,
        featureName,
        type: 'unseenArtifacts',
        data: {
          type: 'update',
          paths: allUnseen,
        },
        userContext: ctx,
      }));

      console.log(`[FileTreeBroadcaster] ✅ Unseen artifacts added: ${artifactPaths.length} paths → ${key}`);
    } catch (error: any) {
      console.warn(`[FileTreeBroadcaster] ⚠️ Failed to add unseen artifacts: ${error.message}`);
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.pubRedis.quit();
  }
}
