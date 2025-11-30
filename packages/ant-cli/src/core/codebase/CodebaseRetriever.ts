/**
 * CodebaseRetriever (Unified Search)
 * 
 * Main orchestrator for unified codebase + lesson retrieval.
 * 
 * Architecture:
 * 1. UnifiedSearch: Code + Lesson in single query
 * 2. Boosters: ImportGraphBooster (Git + Import connections)
 * 3. Loaders: FileLoader (current + HEAD versions)
 */

import { GitPort, MemoryPort } from "../ports";
import { CodeContext, RetrieveOptions, BatchRetrieveOptions, BatchResult } from "./types";
import { UnifiedSearchStrategy, LessonResult, DocumentResult } from "./strategies/UnifiedSearchStrategy";
import { KeywordSearchStrategy } from "./strategies/KeywordSearchStrategy";
import { ImportGraphBooster } from "./boosters/ImportGraphBooster";
import { FileLoader } from "./loaders/FileLoader";
import { ImportGraphAnalyzer } from "./ImportGraphAnalyzer";

export class CodebaseRetriever {
  private defaultExclude = [
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.next', '.nuxt', 'target', '*.log', '*.lock',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ];
  
  private importGraph: ImportGraphAnalyzer | null = null;
  
  // Strategy instances
  private unifiedStrategy = new UnifiedSearchStrategy();
  private keywordStrategy = new KeywordSearchStrategy();  // Fallback
  private gitBooster = new ImportGraphBooster();
  private fileLoader = new FileLoader();

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Main Entry Point
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async retrieve(
    directive: string,
    workingDir: string,
    deps: { git?: GitPort; vectorDB?: MemoryPort },
    options: RetrieveOptions = {}
  ): Promise<CodeContext & { lessons?: LessonResult[]; documents?: DocumentResult[] }> {
    const maxTokens = options.maxTokens || 100000;
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];
    const project = options.project || 'default';
    const mode = options.mode || 'generate';
    
    // ✅ Mode-aware adjustments
    let maxCodeFiles = 15;
    let maxLessons = 5;
    let minCodeScore = 0.6;
    let minLessonScore = 0.5;
    
    if (mode === 'generate') {
      maxLessons = 8;           // More lessons (patterns)
      minLessonScore = 0.7;     // Higher quality
      maxCodeFiles = 12;        // Fewer code files (types only)
    } else if (mode === 'refactor') {
      maxCodeFiles = 20;        // More code (dependencies)
      minCodeScore = 0.5;       // Lower threshold (context)
      maxLessons = 3;           // Fewer lessons
    } else if (mode === 'explain') {
      maxCodeFiles = 10;        // Minimal code (focus)
      maxLessons = 3;           // Fewer lessons
      minLessonScore = 0.6;
    }

    console.log(`📋 Retrieving codebase + lessons (unified, mode: ${mode})...`);

    // Initialize import graph (if Git is available)
    if (deps.git) {
      await this.initializeImportGraph(workingDir);
    }

    let codeFiles;
    let lessons: LessonResult[] = [];
    let documents: DocumentResult[] = [];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Unified Search (Code + Lesson + Document)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (deps.vectorDB) {
      const unifiedResult = await this.unifiedStrategy.search(
        directive,
        project,
        { vectorDB: deps.vectorDB, git: deps.git },
        {
          maxCodeFiles,
          maxLessons,
          maxDocuments: 0,  // Documents disabled by default (retrieved separately if needed)
          minCodeScore,
          minLessonScore,
          includeGitChanges: true,
          includeDocuments: false  // Disable for now
        }
      );

      codeFiles = unifiedResult.codeFiles;
      lessons = unifiedResult.lessons;
      documents = unifiedResult.documents;

      console.log(`   ✅ Unified search: ${codeFiles.length} files, ${lessons.length} lessons (mode: ${mode})`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // 🔥 CRITICAL: Hybrid fallback to keyword search if Vector DB is empty
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (codeFiles.length === 0 && deps.git) {
        console.log(`   🔄 Vector DB empty - falling back to keyword search (hybrid mode)`);
        const keywordResults = await this.keywordStrategy.search(
          directive,
          workingDir,
          { maxFiles: maxCodeFiles, exclude },
          deps.git
        );
        
        // Convert keyword results to FileWithSource format
        codeFiles = keywordResults.map(r => ({
          path: r.path,
          sources: [r.source],
          priority: 'normal' as const,
          hasLocalChanges: false
        }));
        
        console.log(`   ✅ Keyword fallback: ${codeFiles.length} files found`);
      }
    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Fallback: Keyword search only (no Vector DB)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log(`   ⚠️  No Vector DB, falling back to keyword search`);
      const keywordResults = await this.keywordStrategy.search(
        directive,
        workingDir,
        { maxFiles: maxCodeFiles, exclude },
        deps.git
      );
      
      // Convert keyword results to FileWithSource format
      codeFiles = keywordResults.map(r => ({
        path: r.path,
        sources: [r.source],
        priority: 'normal' as const,
        hasLocalChanges: false
      }));
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Load file contents
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const result = await this.fileLoader.load(
      codeFiles,
      workingDir,
      deps.git,
      maxTokens
    );

    console.log(`✅ Retrieval complete: ${result.stats.filesLoaded} files, ${lessons.length} lessons, ~${result.stats.estimatedTokens} tokens`);

    return {
      ...result,
      lessons,    // ✅ Include lessons in result
      documents   // ✅ Include documents in result
    };
  }

  /**
   * Initialize import graph (lazy)
   */
  private async initializeImportGraph(workingDir: string): Promise<void> {
    if (!this.importGraph) {
      try {
        this.importGraph = new ImportGraphAnalyzer();
        await this.importGraph.buildGraph(workingDir);
      } catch (error) {
        console.warn('   ⚠️  Import graph initialization failed:', error);
        this.importGraph = null;
      }
    }
  }

  /**
   * Log source breakdown
   */
  private logSourceBreakdown(breakdown: {
    vectorSearch: number;
    keywordSearch: number;
    gitChanged: number;
    importGraph: number;
  }): void {
    console.log(`   📊 Sources: Vector(${breakdown.vectorSearch}), Keyword(${breakdown.keywordSearch}), Git(${breakdown.gitChanged}), ImportGraph(${breakdown.importGraph})`);
  }
}

// Re-export types
export * from "./types";

