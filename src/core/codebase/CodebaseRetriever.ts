import * as fs from "fs";
import * as path from "path";
import { GitPort, MemoryPort } from "../ports";

/**
 * Retrieve options
 */
export interface RetrieveOptions {
  maxTokens?: number;       // Max tokens to load (default: 100K ~75KB)
  maxFiles?: number;        // Max number of files (default: 30)
  exclude?: string[];       // Patterns to exclude
  includeContext?: boolean; // Include surrounding files (default: true)
}

/**
 * Code context result
 */
export interface CodeContext {
  code: string;             // Current codebase (working tree)
  codeHead?: string;        // Git HEAD version (if changes exist)
  files: string[];          // List of loaded file paths
  strategy: 'git' | 'vector' | 'keyword';  // Which strategy was used
  stats: {
    filesLoaded: number;
    estimatedTokens: number;
  };
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
 * CodebaseRetriever
 * 
 * Single responsibility: Load relevant code from codebase
 * 
 * Two modes:
 * 1. retrieve() - Load all relevant code at once (for normal execution)
 * 2. retrieveInBatches() - Stream code in batches (for batch execution)
 * 
 * Loading strategy (3-stage fallback):
 * 1. Git diff - Fast, focused on changes
 * 2. Vector DB - Semantic search for relevant code
 * 3. Keyword - Fallback text search
 */
export class CodebaseRetriever {
  private defaultExclude = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    'target',
    '*.log',
    '*.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml'
  ];

  /**
   * Main retrieval method
   * Auto-selects best strategy
   */
  async retrieve(
    directive: string,
    workingDir: string,
    deps: {
      git?: GitPort;
      vectorDB?: MemoryPort;
    },
    options: RetrieveOptions = {}
  ): Promise<CodeContext> {
    const maxTokens = options.maxTokens || 100000;  // ~75KB
    const maxFiles = options.maxFiles || 30;
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];

    // Strategy 1: Git diff (if changes exist)
    if (deps.git) {
      const gitResult = await this.tryGitStrategy(
        directive,
        workingDir,
        deps.git,
        { maxTokens, maxFiles, exclude }
      );
      if (gitResult) {
        console.log('📝 Using git diff strategy');
        return gitResult;
      }
    }

    // Strategy 2: Vector DB search
    if (deps.vectorDB) {
      const vectorResult = await this.tryVectorStrategy(
        directive,
        workingDir,
        deps.vectorDB,
        { maxTokens, maxFiles, exclude }
      );
      if (vectorResult) {
        console.log('🔍 Using vector search strategy');
        return vectorResult;
      }
    }

    // Strategy 3: Keyword fallback
    console.log('⚡ Using keyword fallback strategy');
    return await this.keywordStrategy(
      directive,
      workingDir,
      { maxTokens, maxFiles, exclude }
    );
  }


  /**
   * Strategy 1: Git-based retrieval
   * Best for: Iterative work (Turn 2+)
   */
  private async tryGitStrategy(
    directive: string,
    workingDir: string,
    git: GitPort,
    options: Required<Pick<RetrieveOptions, 'maxTokens' | 'maxFiles' | 'exclude'>>
  ): Promise<CodeContext | null> {
    try {
      const hasChanges = await git.hasChanges();
      if (!hasChanges) return null;

      const changedFiles = await git.getChangedFiles();
      
      // Only use git strategy if changes are reasonable
      if (changedFiles.length === 0 || changedFiles.length > 50) {
        return null;
      }

      // Load changed files + related files
      const targetFiles = await this.expandWithRelated(
        changedFiles,
        workingDir,
        directive,
        options.maxFiles
      );

      // Load working tree
      const code = await this.loadFiles(targetFiles, workingDir, options.maxTokens);

      // Load HEAD versions
      const codeHead = await this.loadHeadVersions(changedFiles, git);

      return {
        code,
        codeHead,
        files: targetFiles,
        strategy: 'git',
        stats: {
          filesLoaded: targetFiles.length,
          estimatedTokens: this.estimateTokens(code)
        }
      };
    } catch (error) {
      console.warn('⚠️  Git strategy failed:', error);
      return null;
    }
  }

  /**
   * Strategy 2: Vector-based retrieval
   * Best for: Initial work, semantic search
   */
  private async tryVectorStrategy(
    directive: string,
    workingDir: string,
    vectorDB: MemoryPort,
    options: Required<Pick<RetrieveOptions, 'maxTokens' | 'maxFiles' | 'exclude'>>
  ): Promise<CodeContext | null> {
    try {
      // Query vector DB
      const results = await vectorDB.query(directive, 'codebase', {
        k: options.maxFiles * 2,  // Get more, filter later
        minScore: 0.4
      });

      if (results.length === 0) return null;

      // Extract file paths from chunks
      const filePaths = this.extractFilePaths(results);
      const uniqueFiles = Array.from(new Set(filePaths)).slice(0, options.maxFiles);

      if (uniqueFiles.length === 0) return null;

      // Load files
      const code = await this.loadFiles(uniqueFiles, workingDir, options.maxTokens);

      return {
        code,
        files: uniqueFiles,
        strategy: 'vector',
        stats: {
          filesLoaded: uniqueFiles.length,
          estimatedTokens: this.estimateTokens(code)
        }
      };
    } catch (error) {
      console.warn('⚠️  Vector strategy failed:', error);
      return null;
    }
  }

  /**
   * Strategy 3: Keyword-based fallback
   * Best for: When Vector DB unavailable
   */
  private async keywordStrategy(
    directive: string,
    workingDir: string,
    options: Required<Pick<RetrieveOptions, 'maxTokens' | 'maxFiles' | 'exclude'>>
  ): Promise<CodeContext> {
    // Extract keywords from directive
    const keywords = this.extractKeywords(directive);
    
    // Find files containing keywords
    const matchedFiles = await this.findFilesByKeywords(
      workingDir,
      keywords,
      options.exclude
    );

    // Sort by relevance and take top N
    const sorted = this.sortByRelevance(matchedFiles, keywords);
    const targetFiles = sorted.slice(0, options.maxFiles);

    // Load files
    const code = await this.loadFiles(targetFiles, workingDir, options.maxTokens);

    return {
      code,
      files: targetFiles,
      strategy: 'keyword',
      stats: {
        filesLoaded: targetFiles.length,
        estimatedTokens: this.estimateTokens(code)
      }
    };
  }

  /**
   * Load files from file system
   */
  private async loadFiles(
    filePaths: string[],
    workingDir: string,
    maxTokens: number
  ): Promise<string> {
    const files: Array<{ path: string; content: string }> = [];
    let totalTokens = 0;

    for (const filePath of filePaths) {
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workingDir, filePath);

      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      const tokens = this.estimateTokens(content);

      if (totalTokens + tokens > maxTokens) {
        console.warn(`⚠️  Token budget exceeded, stopping at ${files.length} files`);
        break;
      }

      files.push({
        path: path.relative(workingDir, fullPath),
        content
      });
      totalTokens += tokens;
    }

    console.log(`📂 Loaded ${files.length} files (~${totalTokens} tokens)`);
    return this.formatCodeBlock(files);
  }

  /**
   * Load HEAD versions for git diff
   */
  private async loadHeadVersions(
    filePaths: string[],
    git: GitPort
  ): Promise<string> {
    const files: Array<{ path: string; content: string }> = [];

    for (const filePath of filePaths) {
      const content = await git.getHeadFile(filePath);
      if (content !== null) {
        files.push({ path: filePath, content });
      }
    }

    if (files.length === 0) return "";

    console.log(`🔀 Loaded ${files.length} HEAD versions`);
    return this.formatCodeBlock(files);
  }

  /**
   * Expand changed files with related files
   */
  private async expandWithRelated(
    changedFiles: string[],
    workingDir: string,
    directive: string,
    maxFiles: number
  ): Promise<string[]> {
    // For now, just return changed files
    // TODO: Add import analysis to find related files
    return changedFiles.slice(0, maxFiles);
  }

  /**
   * Extract file paths from vector search results
   */
  private extractFilePaths(results: any[]): string[] {
    const filePaths: string[] = [];
    
    for (const result of results) {
      // Assuming metadata contains file path
      const filePath = result.metadata?.filePath || result.metadata?.file;
      if (filePath) {
        filePaths.push(filePath);
      }
    }
    
    return filePaths;
  }

  /**
   * Extract keywords from directive
   */
  private extractKeywords(directive: string): string[] {
    // Extract file names
    const fileMatches = directive.match(/[\w-]+\.(ts|js|tsx|jsx|py|go|rs|java)/g) || [];
    
    // Extract identifiers (functions, classes, variables)
    const identifierMatches = directive.match(/[A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]+/g) || [];
    
    // Remove common words
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    const filtered = identifierMatches.filter(w => !commonWords.has(w.toLowerCase()));
    
    return [...fileMatches, ...filtered];
  }

  /**
   * Find files by keywords (simple grep)
   */
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

  /**
   * Sort files by relevance score
   */
  private sortByRelevance(
    files: Array<{ path: string; score: number }>,
    keywords: string[]
  ): string[] {
    return files
      .sort((a, b) => b.score - a.score)
      .map(f => f.path);
  }

  /**
   * Find all source files
   */
  private findAllSourceFiles(dir: string, exclude: string[]): string[] {
    const results: string[] = [];
    const sourceExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.py', '.go', '.rs', '.java',
      '.c', '.cpp', '.h', '.hpp',
      '.rb', '.php', '.swift', '.kt'
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
   * Format files into code block
   */
  private formatCodeBlock(files: Array<{ path: string; content: string }>): string {
    return files
      .map(f => `FILE: ${f.path}\n${f.content}`)
      .join("\n\n---\n\n");
  }

  /**
   * Estimate tokens (rough approximation: 1 token ≈ 4 chars)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

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

    // 1. Find all affected files
    const affectedFiles = await this.findAffectedFiles(
      directive,
      workingDir,
      exclude,
      options.strategy || 'grep'
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
    if (strategy === 'ast') {
      // TODO: AST-based analysis (future)
      console.log('AST-based analysis not implemented, falling back to grep');
    }

    // Grep-based: keyword search
    const keywords = this.extractKeywords(directive);
    const allSourceFiles = this.findAllSourceFiles(workingDir, exclude);

    return allSourceFiles.filter(file => {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lower = content.toLowerCase();
        return keywords.some(kw => lower.includes(kw.toLowerCase()));
      } catch {
        return false;
      }
    });
  }

}

