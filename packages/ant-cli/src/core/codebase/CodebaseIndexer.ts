/**
 * Codebase Indexer
 * 
 * Indexes entire codebase into Vector DB for semantic search.
 * 
 * Usage:
 * - Triggered after feature creation
 * - Triggered after git commit
 * - Manual trigger: `ant index [project]`
 */

import * as fs from "fs";
import * as path from "path";
import { GitPort, MemoryPort, ChunkPort } from "../ports";

export interface IndexOptions {
  project: string;
  workingDir: string;
  branch?: string;       // Default: current branch
  exclude?: string[];    // Files/dirs to exclude
  batchSize?: number;    // Files per batch (default: 10)
  incremental?: boolean; // Only index changed files (default: auto-detect)
}

export interface IndexStats {
  filesIndexed: number;
  chunksCreated: number;
  estimatedTokens: number;
  duration: number;
}

export class CodebaseIndexer {
  private defaultExclude = [
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.next', '.nuxt', 'target', '*.log', '*.lock',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    'test', 'tests', '__tests__', '*.test.*', '*.spec.*'
  ];

  /**
   * Index entire codebase into Vector DB
   * 
   * Strategy:
   * 1. Check if branch exists in Vector DB
   * 2. If exists → Incremental (only changed files)
   * 3. If not exists → Full indexing (all files)
   * 
   * @param deps - Dependencies (Git, VectorDB, Chunker)
   * @param options - Index options
   * @returns Index statistics
   */
  async index(
    deps: {
      git: GitPort;
      vectorDB: MemoryPort;
      chunk: ChunkPort;
    },
    options: IndexOptions
  ): Promise<IndexStats> {
    const startTime = Date.now();
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];
    const batchSize = options.batchSize || 10;  // Restore to 10 (CodeSplitter fixed)

    console.log(`📇 [Indexer] Starting codebase indexing...`);
    console.log(`   Project: ${options.project}`);
    console.log(`   Working dir: ${options.workingDir}`);

    // 1. Get current Git state
    const branch = options.branch || await deps.git.getCurrentBranch();
    const currentCommit = await deps.git.getCurrentCommit();
    
    console.log(`   Branch: ${branch}`);
    console.log(`   Commit: ${currentCommit.substring(0, 8)}`);

    // 2. Smart indexing: Check if branch exists in Vector DB and compare commits
    const indexStatus = await this.checkBranchIndexStatus(
      deps.vectorDB,
      options.project,
      branch,
      currentCommit
    );

    let filesToIndex: string[];
    let indexingMode: 'full' | 'incremental';

    // Force full indexing if explicitly requested, first time, or commit mismatch
    if (indexStatus.needsFullIndex || options.incremental === false) {
      // Full: All source files
      console.log(`   📊 ${indexStatus.reason} → Full indexing`);
      filesToIndex = await this.getSourceFiles(options.workingDir, exclude);
      indexingMode = 'full';
      console.log(`   Found ${filesToIndex.length} source files`);
    } else if (indexStatus.isUpToDate) {
      // Already indexed at current commit
      console.log(`   ✅ Already indexed at current commit`);
      console.log(`   ℹ️  No changes detected, skipping indexing`);
      return {
        filesIndexed: 0,
        chunksCreated: 0,
        estimatedTokens: 0,
        duration: Date.now() - startTime
      };
    } else {
      // Incremental: Only changed files
      console.log(`   📊 Incremental update (from ${indexStatus.lastCommit?.substring(0, 8)} to ${currentCommit.substring(0, 8)})`);
      filesToIndex = await this.getChangedFiles(deps.git, options.workingDir, exclude);
      indexingMode = 'incremental';
      
      if (filesToIndex.length === 0) {
        console.log(`   ℹ️  No changes detected, skipping indexing`);
        return {
          filesIndexed: 0,
          chunksCreated: 0,
          estimatedTokens: 0,
          duration: Date.now() - startTime
        };
      }
      
      console.log(`   Found ${filesToIndex.length} changed files`);
    }

    // 3. Index files in batches
    let filesIndexed = 0;
    let chunksCreated = 0;
    let estimatedTokens = 0;

    for (let i = 0; i < filesToIndex.length; i += batchSize) {
      const batch = filesToIndex.slice(i, Math.min(i + batchSize, filesToIndex.length));
      
      console.log(`   Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filesToIndex.length / batchSize)}: ${batch.length} files`);

      for (const filePath of batch) {
        try {
          const stats = await this.indexFile(
            filePath,
            options.workingDir,
            options.project,
            branch,
            currentCommit,
            deps
          );

          filesIndexed++;
          chunksCreated += stats.chunks;
          estimatedTokens += stats.tokens;
        } catch (error) {
          console.warn(`   ⚠️  Failed to index ${filePath}:`, error);
        }
      }
    }

    const duration = Date.now() - startTime;

    console.log(`✅ [Indexer] Indexing complete (${indexingMode})!`);
    console.log(`   Files indexed: ${filesIndexed}`);
    console.log(`   Chunks created: ${chunksCreated}`);
    console.log(`   Est. tokens: ${estimatedTokens}`);
    console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);

    // Store index completion marker
    // This ensures we can detect incomplete indexing (e.g. due to crash)
    await this.storeIndexCompletionMarker(
      deps.vectorDB,
      options.project,
      branch,
      currentCommit,
      filesIndexed,
      chunksCreated
    );

    return {
      filesIndexed,
      chunksCreated,
      estimatedTokens,
      duration
    };
  }

  /**
   * Check branch index status by comparing commit hashes
   * 
   * Uses index completion marker instead of individual file chunks
   * to ensure indexing was fully completed (not interrupted by errors)
   */
  private async checkBranchIndexStatus(
    vectorDB: MemoryPort,
    project: string,
    branch: string,
    currentCommit: string
  ): Promise<{
    needsFullIndex: boolean;
    isUpToDate: boolean;
    lastCommit?: string;
    reason: string;
  }> {
    try {
      // Query for completion marker (not individual file chunks)
      // This ensures we only consider "complete" indexing sessions
      const results = await vectorDB.query(
        'check index completion marker',
        project,
        {
          k: 1,
          where: {
            $and: [
              { type: 'index_completion' },
              { branch }
            ]
          }
        }
      );
      
      if (results.length === 0) {
        // No completion marker exists - need full index
        return {
          needsFullIndex: true,
          isUpToDate: false,
          reason: 'No index completion marker found'
        };
      }
      
      const lastCommit = results[0].metadata?.commitHash;
      
      if (!lastCommit) {
        // Marker exists but missing commit hash (shouldn't happen)
        return {
          needsFullIndex: true,
          isUpToDate: false,
          reason: 'Index marker missing commit hash'
        };
      }
      
      if (lastCommit === currentCommit) {
        // Same commit - already fully indexed
        return {
          needsFullIndex: false,
          isUpToDate: true,
          lastCommit,
          reason: 'Already indexed at current commit'
        };
      }
      
      // Different commit - incremental update
      return {
        needsFullIndex: false,
        isUpToDate: false,
        lastCommit,
        reason: 'Commit has changed since last index'
      };
      
    } catch (error) {
      console.warn(`   ⚠️  Failed to check branch index status:`, error);
      return {
        needsFullIndex: true,
        isUpToDate: false,
        reason: 'Error checking index (defaulting to full)'
      };
    }
  }
  
  /**
   * Store index completion marker
   * 
   * Only called after successful completion of ALL files.
   * Acts as a "commit" for the indexing transaction.
   * If indexing crashes, marker won't be stored and next attempt will re-index.
   */
  private async storeIndexCompletionMarker(
    vectorDB: MemoryPort,
    project: string,
    branch: string,
    commitHash: string,
    filesIndexed: number,
    chunksCreated: number
  ): Promise<void> {
    try {
      const marker = {
        content: `Index completion marker for ${project}/${branch} at commit ${commitHash}`,
        metadata: {
          type: 'index_completion',
          project,
          branch,
          commitHash,
          filesIndexed,
          chunksCreated,
          timestamp: new Date().toISOString(),
          feature: 'index'
        }
      };
      
      await vectorDB.store([marker], project);
      console.log(`   ✅ Stored index completion marker (commit: ${commitHash.substring(0, 8)})`);
    } catch (error) {
      console.warn(`   ⚠️  Failed to store completion marker:`, error);
      // Don't throw - indexing was successful, just marker storage failed
    }
  }

  /**
   * Get changed files (Git diff)
   */
  private async getChangedFiles(
    git: GitPort,
    workingDir: string,
    exclude: string[]
  ): Promise<string[]> {
    try {
      const changedFiles = await git.getChangedFiles();
      
      // Filter by source extensions and exclude patterns
      const sourceExtensions = [
        '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
        '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
        '.vue', '.svelte'
      ];
      
      return changedFiles
        .filter((file: string) => {
          const ext = path.extname(file);
          return sourceExtensions.includes(ext);
        })
        .filter((file: string) => !this.shouldExclude(file, exclude))
        .map((file: string) => path.join(workingDir, file));
        
    } catch (error) {
      console.warn(`   ⚠️  Failed to get changed files:`, error);
      return [];  // Return empty to trigger full indexing
    }
  }

  /**
   * Index a single file
   * 
   * Deletes old chunks before storing new ones for incremental safety.
   */
  private async indexFile(
    filePath: string,
    workingDir: string,
    project: string,
    branch: string,
    commitHash: string,
    deps: {
      vectorDB: MemoryPort;
      chunk: ChunkPort;
    }
  ): Promise<{ chunks: number; tokens: number }> {
    
    // Ensure we're reading from absolute path
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workingDir, filePath);
    
    // Read file content
    const content = fs.readFileSync(absolutePath, 'utf8');
    const relativePath = path.relative(workingDir, absolutePath);
    
    // Skip very large files (>2MB) to prevent memory issues
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB (reasonable limit)
    if (content.length > MAX_FILE_SIZE) {
      console.log(`   ⚠️  Skipping large file (${(content.length / 1024).toFixed(0)}KB): ${relativePath}`);
      return { chunks: 0, tokens: 0 };
    }
    
    // ✅ Delete old chunks for this file before storing new ones
    // This prevents duplicate/stale chunks during incremental indexing
    await deps.vectorDB.delete(project, {
      $and: [
        { type: 'codebase' },
        { filePath: relativePath },
        { branch }
      ]
    });

    // ✅ Chunk file content using pre-loaded content (avoid double file reading)
    const result = await deps.chunk.process({
      source: relativePath,
      sourceType: 'text',  // Use TextLoader with pre-loaded content
      content,
      metadata: {
        type: 'codebase',
        filePath: relativePath,
        project,
        feature: 'index',
        branch,
        commitHash,
        language: this.detectLanguage(filePath),
        timestamp: new Date().toISOString()
      }
    });

    // Store all chunks at once (CodeSplitter now produces manageable chunk counts)
    const documents = result.chunks.map((chunk: any) => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));

    await deps.vectorDB.store(documents, project);

    return {
      chunks: documents.length,
      tokens: result.stats.avgTokens * documents.length
    };
  }

  /**
   * Get all source files (respects .gitignore if Git is available)
   */
  private async getSourceFiles(
    workingDir: string,
    exclude: string[]
  ): Promise<string[]> {
    const results: string[] = [];
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt',
      '.vue', '.svelte'
    ];

    const walk = (currentPath: string) => {
      if (!fs.existsSync(currentPath)) return;
      const stat = fs.statSync(currentPath);
      const relativePath = path.relative(workingDir, currentPath);

      if (this.shouldExclude(relativePath, exclude)) return;

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(currentPath);
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          walk(path.join(currentPath, entry));
        }
      } else if (stat.isFile()) {
        const ext = path.extname(currentPath);
        if (sourceExtensions.includes(ext)) {
          results.push(currentPath);
        }
      }
    };

    walk(workingDir);
    return results;
  }

  /**
   * Check if path should be excluded
   */
  private shouldExclude(relativePath: string, exclude: string[]): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    
    for (const pattern of exclude) {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(normalizedPath)) return true;
      } else {
        if (normalizedPath === pattern || 
            normalizedPath.startsWith(pattern + '/') ||
            normalizedPath.includes('/' + pattern + '/')) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript-react',
      '.js': 'javascript',
      '.jsx': 'javascript-react',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c-header',
      '.hpp': 'cpp-header',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.vue': 'vue',
      '.svelte': 'svelte'
    };

    return langMap[ext] || 'unknown';
  }
}

