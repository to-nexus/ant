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
    const batchSize = options.batchSize || 10;

    console.log(`📇 [Indexer] Starting codebase indexing...`);
    console.log(`   Project: ${options.project}`);
    console.log(`   Working dir: ${options.workingDir}`);

    // 1. Get current Git state
    const branch = options.branch || await deps.git.getCurrentBranch();
    
    console.log(`   Branch: ${branch}`);

    // 2. Smart indexing: Check if branch exists in Vector DB
    const branchExists = await this.checkBranchExists(
      deps.vectorDB,
      options.project,
      branch
    );

    let filesToIndex: string[];
    let indexingMode: 'full' | 'incremental';

    // ✅ Force full indexing if explicitly requested or if branch doesn't exist
    if (!branchExists || options.incremental === false) {
      // Full: All source files
      console.log(`   📊 ${!branchExists ? 'Branch not in Vector DB' : 'Full mode requested'} → Full indexing`);
      filesToIndex = await this.getSourceFiles(options.workingDir, exclude);
      indexingMode = 'full';
      console.log(`   Found ${filesToIndex.length} source files`);
    } else {
      // Incremental: Only changed files
      console.log(`   📊 Branch exists in Vector DB → Incremental indexing`);
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
            'HEAD',
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

    return {
      filesIndexed,
      chunksCreated,
      estimatedTokens,
      duration
    };
  }

  /**
   * Check if branch exists in Vector DB
   */
  private async checkBranchExists(
    vectorDB: MemoryPort,
    project: string,
    branch: string
  ): Promise<boolean> {
    try {
      // Query for any codebase document with this branch
      // Use $and operator for multiple conditions
      const results = await vectorDB.query(
        'check branch exists',
        project,
        {
          k: 1,
          where: {
            $and: [
              { type: 'codebase' },
              { branch }
            ]
          }
        }
      );
      
      return results.length > 0;
    } catch (error) {
      console.warn(`   ⚠️  Failed to check branch existence:`, error);
      return false;  // Default to full indexing on error
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

    // Chunk file content
    const result = await deps.chunk.process({
      source: relativePath,
      sourceType: 'file',
      content,
      metadata: {
        type: 'codebase',        // ✅ Type = codebase
        filePath: relativePath,
        project,
        feature: 'index',        // ✅ Required by ChunkMetadata
        branch,
        commitHash,
        language: this.detectLanguage(filePath),
        timestamp: new Date().toISOString()
      }
    });

    // Store chunks to Vector DB
    const documents = result.chunks.map((chunk: any) => ({
      content: chunk.text,
      metadata: chunk.metadata
    }));

    await deps.vectorDB.store(documents, project);

    return {
      chunks: result.chunks.length,
      tokens: result.stats.avgTokens * result.chunks.length
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

