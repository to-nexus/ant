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
import { FileTreeUpdatePort } from '../ports';
import { UserContext } from '../types/user';
import { 
  getRealtimeBroadcastChannel,
  FileTreeBroadcastMessage,
  BroadcasterOptions 
} from './types';
import { REDIS_KEYS, REDIS_TTL } from '../../infrastructure/state/redisConstants';
import { isTemplateContent } from '../utils/templateDetector';

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

interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileTreeNode[];
  size?: number;
  modifiedTime?: string;
  isTemplate?: boolean;
}

export class FileTreeBroadcaster implements FileTreeUpdatePort {
  private pubRedis: Redis;
  private readonly projectPath: string;
  private readonly userContext?: UserContext;
  
  constructor(options: BroadcasterOptions & { projectPath: string }) {
    const isTLS = options.redisUrl.startsWith('rediss://');
    const tlsOptions = isTLS ? { tls: { checkServerIdentity: () => undefined as undefined } } : {};
    this.pubRedis = new Redis(options.redisUrl, {
      ...tlsOptions,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
    });
    this.projectPath = options.projectPath;
    this.userContext = options.userContext;
    
    // Error & connection event handlers for diagnostics
    this.pubRedis.on('error', (err) => console.error(`❌ [FileTreeBroadcaster] pubRedis error:`, err.message));
    this.pubRedis.on('ready', () => console.log(`🟢 [FileTreeBroadcaster] pubRedis ready`));
    
    console.log(`✅ [FileTreeBroadcaster] Initialized for path: ${this.projectPath}`);
  }

  /**
   * Notify file tree update
   * Implements FileTreeUpdatePort interface
   */
  notifyFileTreeUpdate(projectId: string, featureName: string, userContext?: UserContext): void {
    // Fire-and-forget with error logging
    this.broadcastFileTree(projectId, featureName, userContext || this.userContext)
      .catch(err => {
        console.warn(`[FileTreeBroadcaster] Failed to notify file tree update:`, err.message);
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
      // 1. Build file tree from filesystem
      const tree = await this.buildFileTree(this.projectPath);

      // 2. Cache in Redis for cross-pod initial state (bypasses NFS attribute caching)
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
   * Build file tree from filesystem
   */
  private async buildFileTree(dirPath: string, relativePath: string = ''): Promise<FileTreeNode[]> {
    const nodes: FileTreeNode[] = [];
    
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        // Skip excluded patterns
        if (EXCLUDE_PATTERNS.some(pattern => entry.name === pattern || entry.name.startsWith('.'))) {
          continue;
        }
        
        const fullPath = path.join(dirPath, entry.name);
        const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;
        
        if (entry.isDirectory()) {
          // Recursively build children
          const children = await this.buildFileTree(fullPath, relPath);
          nodes.push({
            name: entry.name,
            type: 'directory',
            path: relPath,
            children,
          });
        } else if (entry.isFile()) {
          try {
            const stats = await fs.promises.stat(fullPath);
            const node: FileTreeNode = {
              name: entry.name,
              type: 'file',
              path: relPath,
              size: stats.size,
              modifiedTime: stats.mtime.toISOString(),
            };

            if (relPath.startsWith('inputs/sources/')) {
              try {
                const content = await fs.promises.readFile(fullPath, 'utf-8');
                if (isTemplateContent(content)) {
                  node.isTemplate = true;
                }
              } catch { /* skip read failures */ }
            }

            nodes.push(node);
          } catch {
            nodes.push({
              name: entry.name,
              type: 'file',
              path: relPath,
            });
          }
        }
      }
      
      // Sort: directories first, then alphabetically
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      
    } catch (error: any) {
      // Return empty if directory doesn't exist or can't be read
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
