/**
 * FileTreeBroadcaster
 * 
 * Direct Redis Pub/Sub implementation for File Tree updates.
 * Replaces HTTP-based FileTreeHttpClient for Job Worker child processes.
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
];

interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileTreeNode[];
  size?: number;
  modifiedTime?: string;
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

      // 2. Broadcast via user-scoped Redis Pub/Sub channel
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
      
      console.log(`[FileTreeBroadcaster] ✅ File tree update sent to ${channel} for ${projectId}/${featureName}`);
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
            nodes.push({
              name: entry.name,
              type: 'file',
              path: relPath,
              size: stats.size,
              modifiedTime: stats.mtime.toISOString(),
            });
          } catch {
            // Skip files we can't stat
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
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.pubRedis.quit();
  }
}
