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
import { ChunkAdapter } from '../../periphery/adapters/chunk/ChunkingAdapter';

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
   * Create Memory (Vector DB) adapter
   */
  static createMemoryAdapter(): MemoryPort {
    return new ChromaMemoryAdapter();
  }

  /**
   * Create Chunking adapter
   */
  static createChunkAdapter(): ChunkPort {
    return new ChunkAdapter();
  }
}
