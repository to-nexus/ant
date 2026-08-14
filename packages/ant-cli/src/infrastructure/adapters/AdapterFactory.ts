/**
 * Adapter Factory
 * 
 * Central factory for creating adapter instances.
 * This respects hexagonal architecture by keeping adapter implementations
 * in the periphery layer and providing them through this infrastructure layer.
 */

import { GitPort } from '../../core/ports/git';
import { FileSystemPort } from '../../core/ports/filesystem';
import { MemoryPort } from '../../core/ports/memory';
import { ChunkPort } from '../../core/ports';
import { SimpleGitAdapter } from '../../periphery/adapters/git/SimpleGitAdapter';
import { FileSystemAdapter } from '../../periphery/adapters/filesystem/FileSystemAdapter';
import { ChromaMemoryAdapter } from '../../periphery/adapters/memory/ChromaMemoryAdapter';
import { NoopMemoryAdapter } from '../../periphery/adapters/memory/NoopMemoryAdapter';
import { ChunkAdapter } from '../../periphery/adapters/chunk/ChunkingAdapter';
import { isVectorDbEnabled } from '../../core/config/vectorDbCapability';
import { isLocalServerMode } from '../../core/config/serverMode';

export class AdapterFactory {
  /**
   * Create Git adapter (simple version for commands)
   */
  static createGitAdapter(workingDir: string, projectName?: string): GitPort {
    // For simple CLI commands, use working directory directly
    const simpleConfig = { repoType: 'local', localPath: workingDir };
    return new SimpleGitAdapter(projectName || 'default', simpleConfig, workingDir);
  }

  /**
   * Create Git adapter (full version for orchestrator)
   */
  static createGitAdapterWithConfig(projectName: string, config: any, projectPath: string): GitPort {
    return new SimpleGitAdapter(projectName, config, projectPath);
  }

  /**
   * Create FileSystem adapter (POSIX-compatible: local, NFS, EFS)
   */
  static createFileSystemAdapter(): FileSystemPort {
    // For simple use cases without workspace context
    return new FileSystemAdapter(process.cwd());
  }

  /**
   * Create FileSystem adapter with specific base path
   * Works with local filesystem, NFS mounts, or EFS mounts
   */
  static createFileSystemAdapterWithPath(basePath: string): FileSystemPort {
    return new FileSystemAdapter(basePath);
  }

  /**
   * Create Memory (Vector DB) adapter.
   *
   * Returns a `NoopMemoryAdapter` when `ANT_VECTOR_DB_ENABLED` is not set
   * to a truthy value (the default). See
   * [`vectorDbCapability.ts`](../../core/config/vectorDbCapability.ts).
   */
  static createMemoryAdapter(userContext?: { organizationId: string; userId: string }): MemoryPort {
    if (!isVectorDbEnabled()) {
      return new NoopMemoryAdapter();
    }
    // Collections are keyed by projectId, which is unique per tenant and not
    // globally — so in a shared deployment the caller's tenant has to be part
    // of the key (M-006). Local mode is single-tenant and keeps the legacy
    // unscoped names, so existing indexes stay readable.
    const scope =
      !isLocalServerMode() && userContext?.organizationId && userContext?.userId
        ? { organizationId: userContext.organizationId, userId: userContext.userId }
        : null;
    return new ChromaMemoryAdapter(scope);
  }

  /**
   * Create Chunking adapter
   */
  static createChunkAdapter(): ChunkPort {
    return new ChunkAdapter();
  }
}
