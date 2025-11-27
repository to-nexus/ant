import * as fs from "fs";
import * as path from "path";
import { GitPort, MemoryPort } from "../ports";
import { ImportGraphAnalyzer } from "./ImportGraphAnalyzer";
import { ASTAnalyzer } from "./ASTAnalyzer";
import { CodebaseCache } from "./CodebaseCache";

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
  cache?: CodebaseCache;    // Optional cache instance
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
  
  private importGraph: ImportGraphAnalyzer | null = null;
  private astAnalyzer: ASTAnalyzer = new ASTAnalyzer();

  /**
   * Main retrieval method
   * Auto-selects best strategy
   * 
   * ✅ NEW: Smart hybrid approach
   * - Always search for relevant files (Vector/Keyword)
   * - Boost priority of Git changed files if they're relevant
   * - Never return Git changes without relevance check
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
    const useAST = options.useAST ?? true;
    const useImportGraph = options.useImportGraph ?? true;
    const cache = options.cache;

    // Check cache first
    if (cache) {
      const cacheKey = CodebaseCache.generateKey(directive, workingDir, { maxTokens, maxFiles, exclude });
      const cached = cache.get(cacheKey);
      
      if (cached) {
        console.log('💾 Cache hit! Using cached result');
        return cached;
      }
    }

    // Initialize import graph if needed
    if (useImportGraph && deps.git) {
      try {
        await this.initializeImportGraph(workingDir);
      } catch (error) {
        console.warn('Failed to initialize import graph:', error);
      }
    }

    let result: CodeContext;

    // ✅ NEW: Get Git changed files (for priority boosting)
    let gitChanges: string[] = [];
    if (deps.git) {
      try {
        const hasChanges = await deps.git.hasChanges();
        if (hasChanges) {
          gitChanges = await deps.git.getChangedFiles();
          console.log(`📝 Detected ${gitChanges.length} changed files (will boost if relevant)`);
        }
      } catch (error) {
        console.warn('⚠️  Failed to get git changes:', error);
      }
    }

    // Strategy 1: Vector DB search (if available)
    if (deps.vectorDB) {
      const vectorResult = await this.tryVectorStrategy(
        directive,
        workingDir,
        deps.vectorDB,
        { maxTokens, maxFiles, exclude }
      );
      if (vectorResult) {
        console.log('🔍 Using vector search strategy');
        
        // ✅ Boost git changed files if they're in vector results
        result = await this.boostChangedFiles(vectorResult, gitChanges, deps.git);
        
        // Cache result
        if (cache) {
          const cacheKey = CodebaseCache.generateKey(directive, workingDir, { maxTokens, maxFiles, exclude });
          cache.set(cacheKey, result);
        }
        
        return result;
      }
    }

    // Strategy 2: Keyword search (fallback)
    console.log('⚡ Using keyword search strategy');
    const keywordResult = await this.keywordStrategy(
      directive,
      workingDir,
      { maxTokens, maxFiles, exclude }
    );
    
    // ✅ Boost git changed files if they're in keyword results
    result = await this.boostChangedFiles(keywordResult, gitChanges, deps.git);
    
    // Cache result
    if (cache) {
      const cacheKey = CodebaseCache.generateKey(directive, workingDir, { maxTokens, maxFiles, exclude });
      cache.set(cacheKey, result);
    }
    
    return result;
  }


  /**
   * Boost priority of Git changed files in search results
   * 
   * Strategy (Option 3: Smart Import Graph):
   * 1. Find changed files that are CONNECTED to search results (via imports)
   * 2. Prioritize them at the front
   * 3. Include their dependencies automatically
   * 
   * Example:
   *   directive: "Add login button"
   *   searchResults: ['Login.tsx', 'Button.tsx']
   *   gitChanges: ['Auth.ts', 'README.md']
   *   importGraph: Auth.ts → Login.tsx (connected!)
   *   
   *   Result: ['Auth.ts', 'Login.tsx', 'Button.tsx']  (Auth.ts boosted, README excluded)
   * 
   * @param searchResult - Files found by Vector/Keyword search
   * @param gitChanges - Files changed in working tree
   * @param git - Git port for loading HEAD versions
   */
  private async boostChangedFiles(
    searchResult: CodeContext,
    gitChanges: string[],
    git?: GitPort
  ): Promise<CodeContext> {
    if (gitChanges.length === 0 || !git) {
      return searchResult;  // No changes, return as-is
    }

    // Normalize paths for comparison
    const changedSet = new Set(gitChanges.map(f => path.normalize(f)));
    const searchFiles = searchResult.files.map(f => path.normalize(f));
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Option 3: Smart Import Graph
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    if (this.importGraph) {
      console.log(`   🔗 Using import graph for intelligent file selection...`);
      
      const connectedFiles = new Set<string>();
      const changedAndConnected: string[] = [];
      
      // For each changed file, check if it's connected to relevant files
      for (const changedFile of gitChanges) {
        const normalizedChanged = path.normalize(changedFile);
        
        // Direct match (changed file is also relevant)
        if (searchFiles.includes(normalizedChanged)) {
          changedAndConnected.push(normalizedChanged);
          connectedFiles.add(normalizedChanged);
          continue;
        }
        
        // Check import graph connection
        const connected = searchFiles.filter(searchFile => {
          return this.importGraph!.isConnected(normalizedChanged, searchFile);
        });
        
        if (connected.length > 0) {
          // Changed file is connected to relevant files!
          changedAndConnected.push(normalizedChanged);
          connectedFiles.add(normalizedChanged);
          connected.forEach(f => connectedFiles.add(f));
          
          console.log(`   🔗 ${path.basename(normalizedChanged)} connected to ${connected.length} relevant files`);
        }
      }
      
      if (changedAndConnected.length === 0) {
        console.log(`   ℹ️  No import connections between ${gitChanges.length} changed and ${searchFiles.length} relevant files`);
        return searchResult;
      }
      
      // Build final file list: connected files first, then other relevant files
      const otherRelevant = searchFiles.filter(f => !connectedFiles.has(f));
      const reorderedFiles = [
        ...changedAndConnected,  // Changed files with connections (highest priority)
        ...searchFiles.filter(f => connectedFiles.has(f) && !changedSet.has(f)),  // Connected relevant files
        ...otherRelevant  // Other relevant files
      ];
      
      console.log(`   🔥 Boosted ${changedAndConnected.length} changed+connected files to front`);
      
      return {
        ...searchResult,
        files: reorderedFiles,
        strategy: searchResult.strategy === 'vector' ? 'vector' : 'keyword',
        stats: {
          ...searchResult.stats,
          filesLoaded: reorderedFiles.length
        }
      };
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Fallback: Simple overlap check (no import graph)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    const changedAndRelevant = searchFiles.filter(f => changedSet.has(f));
    const onlyRelevant = searchFiles.filter(f => !changedSet.has(f));
    
    if (changedAndRelevant.length === 0) {
      console.log(`   ℹ️  No overlap between ${gitChanges.length} changed and ${searchFiles.length} relevant files`);
      return searchResult;
    }
    
    console.log(`   🔥 Boosting ${changedAndRelevant.length} changed+relevant files to front (simple mode)`);
    
    // Reorder: changed+relevant first, then others
    const reorderedFiles = [
      ...changedAndRelevant,
      ...onlyRelevant
    ];
    
    return {
      ...searchResult,
      files: reorderedFiles,
      strategy: searchResult.strategy === 'vector' ? 'vector' : 'keyword',
      stats: {
        ...searchResult.stats,
        filesLoaded: reorderedFiles.length
      }
    };
  }

  /**
   * Strategy 1: Git-based retrieval
   * Best for: Iterative work (Turn 2+)
   * 
   * ⚠️  DEPRECATED: This strategy is no longer used as primary.
   * Git changes are now used as a priority boost, not a standalone strategy.
   */
  private async tryGitStrategy(
    directive: string,
    workingDir: string,
    git: GitPort,
    options: Required<Pick<RetrieveOptions, 'maxTokens' | 'maxFiles' | 'exclude'>> & { useImportGraph?: boolean }
  ): Promise<CodeContext | null> {
    try {
      const hasChanges = await git.hasChanges();
      if (!hasChanges) return null;

      const changedFiles = await git.getChangedFiles();
      
      // Only use git strategy if changes are reasonable
      if (changedFiles.length === 0 || changedFiles.length > 50) {
        return null;
      }

      // Expand with import graph if available
      let targetFiles = changedFiles.map(f => path.join(workingDir, f));
      
      if (options.useImportGraph && this.importGraph) {
        console.log('🔗 Expanding files using import graph...');
        targetFiles = this.importGraph.getRelatedFiles(targetFiles, {
          depth: 2,
          includeImporters: true,
          includeImportees: true
        });
        console.log(`   ${changedFiles.length} → ${targetFiles.length} files (with dependencies)`);
      } else {
        // Fallback to keyword expansion
        targetFiles = await this.expandWithRelated(
          changedFiles,
          workingDir,
          directive,
          options.maxFiles
        );
      }

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
    let targetFiles = sorted.slice(0, options.maxFiles);

    // ✅ FALLBACK: If no files matched (e.g., non-English directive or no keywords),
    // load all source files up to maxFiles limit
    if (targetFiles.length === 0) {
      console.log('⚠️  No keyword matches found - loading all source files as fallback');
      const allFiles = this.findAllSourceFiles(workingDir, options.exclude);
      targetFiles = allFiles.slice(0, options.maxFiles);
    }

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
    const strategy = options.strategy || 'ast';  // Default to AST for batch processing

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
    if (strategy === 'ast') {
      console.log('🔍 Using AST analysis to find affected files...');
      try {
        const affectedFiles = await this.astAnalyzer.getAffectedFiles(directive, workingDir);
        console.log(`   Found ${affectedFiles.length} files via AST`);
        
        if (affectedFiles.length > 0) {
          return affectedFiles;
        }
        
        console.log('   AST found no files, falling back to grep');
      } catch (error) {
        console.warn('   AST analysis failed, falling back to grep:', error);
      }
    }

    // Grep-based: keyword search
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

  /**
   * Initialize import graph (call before using git strategy with import graph)
   */
  async initializeImportGraph(workingDir: string): Promise<void> {
    if (!this.importGraph) {
      this.importGraph = new ImportGraphAnalyzer();
      await this.importGraph.buildGraph(workingDir);
    }
  }

}

