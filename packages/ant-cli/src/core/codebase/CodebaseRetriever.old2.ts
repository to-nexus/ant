/**
 * ✅ REFACTORED: Find와 Load 완전 분리
 * 
 * 설계 원칙:
 * 1. findRelevantFiles() - 파일 경로만 찾기 (Vector/Keyword + Git boost)
 * 2. loadFileVersions() - 파일 내용 로드 (current + original)
 * 3. retrieve() - 두 단계 조율
 */

import * as fs from "fs";
import * as path from "path";
import { GitPort, MemoryPort } from "../ports";
import { ImportGraphAnalyzer } from "./ImportGraphAnalyzer";

/**
 * Retrieve options
 */
export interface RetrieveOptions {
  maxTokens?: number;       // Max tokens to load (default: 100K ~75KB)
  maxFiles?: number;        // Max number of files (default: 30)
  exclude?: string[];       // Patterns to exclude
  includeContext?: boolean; // Include surrounding files (default: true)
  useAST?: boolean;         // Use AST analysis for precise file finding (default: true)
  useImportGraph?: boolean; // Use import graph for related files (default: true)
  cache?: any;              // Optional cache instance
}

/**
 * Batch result for streaming
 */
export interface BatchResult {
  batchNumber: number;
  files: string[];
  code: string;
  estimatedTokens: number;
}

/**
 * Batch retrieve options
 */
export interface BatchRetrieveOptions {
  batchSize?: number;
  maxBatches?: number;
  maxTokensPerBatch?: number;
  exclude?: string[];
  strategy?: 'ast' | 'grep';
}

/**
 * File with priority and version info
 */
export interface FileInfo {
  path: string;
  priority: 'high' | 'normal';  // high = Git changed
  hasLocalChanges: boolean;
}

/**
 * Code context with versions
 */
export interface CodeContext {
  code: string;             // Current working tree (formatted)
  codeHead?: string;        // Git HEAD version (for changed files only)
  files: string[];          // List of file paths
  strategy: 'vector' | 'keyword';
  stats: {
    filesLoaded: number;
    filesChanged: number;   // Number of files with local changes
    estimatedTokens: number;
  };
}

export class CodebaseRetriever {
  private defaultExclude = [
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.next', '.nuxt', 'target', '*.log', '*.lock',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ];
  
  private importGraph: ImportGraphAnalyzer | null = null;

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Main Entry Point
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async retrieve(
    directive: string,
    workingDir: string,
    deps: { git?: GitPort; vectorDB?: MemoryPort },
    options: { maxTokens?: number; maxFiles?: number; exclude?: string[] } = {}
  ): Promise<CodeContext> {
    const maxTokens = options.maxTokens || 100000;
    const maxFiles = options.maxFiles || 30;
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];

    // Initialize import graph
    if (deps.git) {
      await this.initializeImportGraph(workingDir);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Find relevant files (경로만)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const findResult = await this.findRelevantFiles(
      directive,
      workingDir,
      deps,
      { maxFiles, exclude }
    );

    console.log(`📂 Found ${findResult.files.length} relevant files`);
    console.log(`   🔥 ${findResult.files.filter(f => f.priority === 'high').length} with high priority (Git changed)`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Load file versions (내용 읽기)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const loadedContext = await this.loadFileVersions(
      findResult.files,
      workingDir,
      deps.git,
      maxTokens,
      findResult.strategy
    );

    return loadedContext;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * STEP 1: Find Relevant Files (파일 경로만)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  private async findRelevantFiles(
    directive: string,
    workingDir: string,
    deps: { git?: GitPort; vectorDB?: MemoryPort },
    options: { maxFiles: number; exclude: string[] }
  ): Promise<{ files: FileInfo[]; strategy: 'vector' | 'keyword' }> {
    
    // 1️⃣ Get Git changed files (for boosting)
    let gitChanges: string[] = [];
    if (deps.git) {
      try {
        const hasChanges = await deps.git.hasChanges();
        if (hasChanges) {
          gitChanges = await deps.git.getChangedFiles();
          console.log(`📝 Detected ${gitChanges.length} Git changed files`);
        }
      } catch (error) {
        console.warn('⚠️  Failed to get git changes:', error);
      }
    }

    // 2️⃣ Search for relevant files (Vector or Keyword)
    let relevantFiles: string[];
    let strategy: 'vector' | 'keyword';

    if (deps.vectorDB) {
      // Try Vector DB first
      relevantFiles = await this.searchVector(directive, deps.vectorDB, options);
      if (relevantFiles.length > 0) {
        strategy = 'vector';
        console.log(`🔍 Vector search found ${relevantFiles.length} files`);
      } else {
        // Fallback to keyword
        relevantFiles = await this.searchKeyword(directive, workingDir, options);
        strategy = 'keyword';
        console.log(`⚡ Keyword search found ${relevantFiles.length} files`);
      }
    } else {
      // No Vector DB, use keyword
      relevantFiles = await this.searchKeyword(directive, workingDir, options);
      strategy = 'keyword';
      console.log(`⚡ Keyword search found ${relevantFiles.length} files`);
    }

    // 3️⃣ Boost Git changed files with Import Graph
    const filesWithPriority = await this.boostWithImportGraph(
      relevantFiles,
      gitChanges,
      workingDir
    );

    return { files: filesWithPriority, strategy };
  }

  /**
   * Search files using Vector DB
   * Returns only file paths (no loading)
   */
  private async searchVector(
    directive: string,
    vectorDB: MemoryPort,
    options: { maxFiles: number; exclude: string[] }
  ): Promise<string[]> {
    try {
      const results = await vectorDB.query(directive, 'codebase', {
        k: options.maxFiles * 2,
        minScore: 0.4
      });

      if (results.length === 0) return [];

      // Extract file paths only (no loading!)
      const filePaths = this.extractFilePaths(results);
      return Array.from(new Set(filePaths)).slice(0, options.maxFiles);
    } catch (error) {
      console.warn('⚠️  Vector search failed:', error);
      return [];
    }
  }

  /**
   * Search files using Keyword matching
   * Returns only file paths (no loading)
   */
  private async searchKeyword(
    directive: string,
    workingDir: string,
    options: { maxFiles: number; exclude: string[] }
  ): Promise<string[]> {
    const keywords = this.extractKeywords(directive);
    const matchedFiles = await this.findFilesByKeywords(
      workingDir,
      keywords,
      options.exclude
    );

    const sorted = this.sortByRelevance(matchedFiles, keywords);
    let targetFiles = sorted.slice(0, options.maxFiles);

    // Fallback: load all source files if no matches
    if (targetFiles.length === 0) {
      console.log('⚠️  No keyword matches, loading all source files');
      const allFiles = this.findAllSourceFiles(workingDir, options.exclude);
      targetFiles = allFiles.slice(0, options.maxFiles);
    }

    return targetFiles;
  }

  /**
   * Boost Git changed files using Import Graph
   * Returns files with priority information
   */
  private async boostWithImportGraph(
    relevantFiles: string[],
    gitChanges: string[],
    workingDir: string
  ): Promise<FileInfo[]> {
    
    if (gitChanges.length === 0) {
      // No Git changes, all files normal priority
      return relevantFiles.map(path => ({
        path,
        priority: 'normal' as const,
        hasLocalChanges: false
      }));
    }

    const changedSet = new Set(gitChanges.map(f => path.normalize(f)));
    const relevantSet = new Set(relevantFiles.map(f => path.normalize(f)));

    // With Import Graph
    if (this.importGraph) {
      console.log(`   🔗 Using import graph for intelligent prioritization...`);
      
      const highPriority: FileInfo[] = [];
      const normalPriority: FileInfo[] = [];

      // Check each Git changed file
      for (const changedFile of gitChanges) {
        const normalizedChanged = path.normalize(changedFile);
        
        // Direct match or connected to relevant files
        const isDirectMatch = relevantSet.has(normalizedChanged);
        const isConnected = relevantFiles.some(rf => 
          this.importGraph!.isConnected(normalizedChanged, rf)
        );

        if (isDirectMatch || isConnected) {
          highPriority.push({
            path: normalizedChanged,
            priority: 'high',
            hasLocalChanges: true
          });
          
          if (isConnected && !isDirectMatch) {
            console.log(`   🔗 ${path.basename(normalizedChanged)} connected to relevant files`);
          }
        }
      }

      // Add relevant files (that are not changed)
      for (const relevantFile of relevantFiles) {
        const normalized = path.normalize(relevantFile);
        if (!changedSet.has(normalized)) {
          normalPriority.push({
            path: normalized,
            priority: 'normal',
            hasLocalChanges: false
          });
        }
      }

      console.log(`   🔥 ${highPriority.length} high priority, ${normalPriority.length} normal priority`);
      
      return [...highPriority, ...normalPriority];
    }

    // Without Import Graph (simple overlap)
    const result: FileInfo[] = [];
    
    // High priority: changed + relevant
    for (const file of relevantFiles) {
      const normalized = path.normalize(file);
      result.push({
        path: normalized,
        priority: changedSet.has(normalized) ? 'high' : 'normal',
        hasLocalChanges: changedSet.has(normalized)
      });
    }

    // Sort: high priority first
    result.sort((a, b) => a.priority === b.priority ? 0 : a.priority === 'high' ? -1 : 1);

    return result;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * STEP 2: Load File Versions (파일 내용 읽기)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  private async loadFileVersions(
    filesWithPriority: FileInfo[],
    workingDir: string,
    git: GitPort | undefined,
    maxTokens: number
  ): Promise<CodeContext> {
    
    const currentFiles: Array<{ path: string; content: string }> = [];
    const headFiles: Array<{ path: string; content: string }> = [];
    
    let totalTokens = 0;
    let filesChanged = 0;

    for (const fileInfo of filesWithPriority) {
      const fullPath = path.isAbsolute(fileInfo.path)
        ? fileInfo.path
        : path.join(workingDir, fileInfo.path);

      if (!fs.existsSync(fullPath)) continue;

      // Load current version (working tree)
      const currentContent = fs.readFileSync(fullPath, 'utf8');
      const tokens = this.estimateTokens(currentContent);

      if (totalTokens + tokens > maxTokens) {
        console.warn(`⚠️  Token budget exceeded, stopping at ${currentFiles.length} files`);
        break;
      }

      const relativePath = path.relative(workingDir, fullPath);
      
      currentFiles.push({
        path: relativePath,
        content: currentContent
      });
      totalTokens += tokens;

      // Load Git HEAD version (if file has local changes)
      if (fileInfo.hasLocalChanges && git) {
        try {
          const headContent = await git.getHeadFile(relativePath);
          if (headContent !== null) {
            headFiles.push({
              path: relativePath,
              content: headContent
            });
            filesChanged++;
          }
        } catch (error) {
          console.warn(`⚠️  Failed to load HEAD version for ${relativePath}:`, error);
        }
      }
    }

    console.log(`📂 Loaded ${currentFiles.length} files (~${totalTokens} tokens)`);
    if (filesChanged > 0) {
      console.log(`   🔀 ${filesChanged} files with local changes (HEAD versions loaded)`);
    }

    return {
      code: this.formatCodeBlock(currentFiles),
      codeHead: headFiles.length > 0 ? this.formatCodeBlock(headFiles) : undefined,
      files: currentFiles.map(f => f.path),
      strategy: 'vector',  // TODO: pass from findRelevantFiles
      stats: {
        filesLoaded: currentFiles.length,
        filesChanged,
        estimatedTokens: totalTokens
      }
    };
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Helper Methods
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */

  private extractFilePaths(results: any[]): string[] {
    const filePaths: string[] = [];
    for (const result of results) {
      const filePath = result.metadata?.filePath || result.metadata?.file;
      if (filePath) filePaths.push(filePath);
    }
    return filePaths;
  }

  private extractKeywords(directive: string): string[] {
    const fileMatches = directive.match(/[\w-]+\.(ts|js|tsx|jsx|py|go|rs|java)/g) || [];
    const identifierMatches = directive.match(/[A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]+/g) || [];
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    const filtered = identifierMatches.filter(w => !commonWords.has(w.toLowerCase()));
    return [...fileMatches, ...filtered];
  }

  private async findFilesByKeywords(
    workingDir: string,
    keywords: string[],
    exclude: string[]
  ): Promise<Array<{ path: string; score: number }>> {
    const results: Array<{ path: string; score: number }> = [];
    const allFiles = this.findAllSourceFiles(workingDir, exclude);

    for (const filePath of allFiles) {
      const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
      let score = 0;
      
      for (const keyword of keywords) {
        const matches = (content.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
        score += matches;
      }
      
      if (score > 0) {
        results.push({
          path: path.relative(workingDir, filePath),
          score
        });
      }
    }

    return results;
  }

  private sortByRelevance(
    files: Array<{ path: string; score: number }>,
    keywords: string[]
  ): string[] {
    return files
      .sort((a, b) => b.score - a.score)
      .map(f => f.path);
  }

  private findAllSourceFiles(dir: string, exclude: string[]): string[] {
    const results: string[] = [];
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt'
    ];

    const walk = (currentPath: string) => {
      if (!fs.existsSync(currentPath)) return;
      const stat = fs.statSync(currentPath);
      const relativePath = path.relative(dir, currentPath);

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

    walk(dir);
    return results;
  }

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

  private formatCodeBlock(files: Array<{ path: string; content: string }>): string {
    return files
      .map(f => `FILE: ${f.path}\n${f.content}`)
      .join("\n\n---\n\n");
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private async initializeImportGraph(workingDir: string): Promise<void> {
    if (!this.importGraph) {
      this.importGraph = new ImportGraphAnalyzer();
      await this.importGraph.buildGraph(workingDir);
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Batch Processing (for large-scale refactoring)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */

  /**
   * Retrieve code in batches for large-scale operations
   * Returns async iterator for streaming
   */
  async *retrieveInBatches(
    directive: string,
    workingDir: string,
    deps: {
      git?: GitPort;
      vectorDB?: MemoryPort;
    },
    options: BatchRetrieveOptions = {}
  ): AsyncIterableIterator<BatchResult> {
    const batchSize = options.batchSize || 5;
    const maxBatches = options.maxBatches || 20;
    const maxTokensPerBatch = options.maxTokensPerBatch || 20000;
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];
    const strategy = options.strategy || 'ast';

    // 1. Find all affected files
    const affectedFiles = await this.findAffectedFiles(
      directive,
      workingDir,
      exclude,
      strategy
    );

    if (affectedFiles.length === 0) {
      console.warn('No affected files found for batch processing');
      return;
    }

    console.log(`Found ${affectedFiles.length} affected files`);

    // 2. Split into batches
    const totalBatches = Math.min(
      Math.ceil(affectedFiles.length / batchSize),
      maxBatches
    );

    for (let i = 0; i < totalBatches; i++) {
      const startIdx = i * batchSize;
      const endIdx = Math.min(startIdx + batchSize, affectedFiles.length);
      const batchFiles = affectedFiles.slice(startIdx, endIdx);

      // 3. Load files in batch
      const loadedFiles = batchFiles
        .map(filePath => {
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            return { path: path.relative(workingDir, filePath), content };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ path: string; content: string }>;

      if (loadedFiles.length === 0) continue;

      const code = this.formatCodeBlock(loadedFiles);
      const estimatedTokens = this.estimateTokens(code);

      // 4. Yield batch
      yield {
        batchNumber: i + 1,
        files: loadedFiles.map(f => f.path),
        code,
        estimatedTokens
      };

      // Check token limit
      if (estimatedTokens > maxTokensPerBatch) {
        console.warn(`Batch ${i + 1} exceeds token limit: ${estimatedTokens} > ${maxTokensPerBatch}`);
      }
    }
  }

  /**
   * Find all files affected by directive
   */
  private async findAffectedFiles(
    directive: string,
    workingDir: string,
    exclude: string[],
    strategy: 'ast' | 'grep'
  ): Promise<string[]> {
    // For now, use keyword search (AST analyzer would be separate module)
    console.log('🔍 Using keyword search to find affected files...');
    const keywords = this.extractKeywords(directive);
    const allSourceFiles = this.findAllSourceFiles(workingDir, exclude);

    const matched = allSourceFiles.filter(file => {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lower = content.toLowerCase();
        return keywords.some(kw => lower.includes(kw.toLowerCase()));
      } catch {
        return false;
      }
    });
    
    console.log(`   Found ${matched.length} files via keyword search`);
    return matched;
  }
}

