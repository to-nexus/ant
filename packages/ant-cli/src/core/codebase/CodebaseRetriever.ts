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
import { UnifiedSearchStrategy, LessonResult } from "./strategies/UnifiedSearchStrategy";
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
  ): Promise<CodeContext & { lessons?: LessonResult[] }> {
    const maxTokens = options.maxTokens || 100000;
    const exclude = [...this.defaultExclude, ...(options.exclude || [])];
    
    // ✅ Support reference projects (use referenceProject if provided, otherwise use project)
    const project = options.referenceProject || options.project || 'default';
    const actualWorkingDir = options.referenceWorkingDir || workingDir;
    
    const mode = options.mode || 'generate';
    
    // ✅ Mode-aware adjustments
    let maxCodeFiles = 15;
    let maxLessons = 5;
    let minCodeScore = 0.4;  // ✅ Lowered from 0.6 - ChromaDB L2 distance typically gives 0.4-0.5 for relevant matches
    let minLessonScore = 0.35;  // ✅ Lowered from 0.5
    
    if (mode === 'generate') {
      maxLessons = 8;           // More lessons (patterns)
      minLessonScore = 0.4;     // ✅ Lowered from 0.7 - more permissive for pattern matching
      maxCodeFiles = 12;        // Fewer code files (types only)
      minCodeScore = 0.45;      // ✅ Slightly higher for generate mode
    } else if (mode === 'refactor') {
      maxCodeFiles = 20;        // More code (dependencies)
      minCodeScore = 0.35;      // ✅ Lowered from 0.5 - need more context
      maxLessons = 3;           // Fewer lessons
    } else if (mode === 'explain') {
      maxCodeFiles = 10;        // Minimal code (focus)
      maxLessons = 3;           // Fewer lessons
      minLessonScore = 0.4;     // ✅ Lowered from 0.6
    }

    console.log(`📋 Retrieving codebase + lessons (unified, mode: ${mode})...`);
    if (options.referenceProject) {
      console.log(`   📚 Reference project: ${options.referenceProject}${options.referenceBranch ? ` (${options.referenceBranch})` : ''}`);
    }

    // Initialize import graph (if Git is available)
    if (deps.git) {
      await this.initializeImportGraph(actualWorkingDir);
    }

    let codeFiles: import('./types').FileWithSource[];
    let lessons: LessonResult[] = [];

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Unified Search (Code + Lesson)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    if (deps.vectorDB) {
      const unifiedResult = await this.unifiedStrategy.search(
        directive,
        project,
        { vectorDB: deps.vectorDB, git: deps.git },
        {
          maxCodeFiles,
          maxLessons,
          minCodeScore,
          minLessonScore,
          includeGitChanges: true
        }
      );

      codeFiles = unifiedResult.codeFiles;
      lessons = unifiedResult.lessons;

      console.log(`   ✅ Unified search: ${codeFiles.length} files, ${lessons.length} lessons (mode: ${mode})`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ✅ Vector DB empty - NO FALLBACK (retrieve only committed code)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      if (codeFiles.length === 0) {
        console.log(`   ℹ️  Vector DB is empty (no indexed code yet)`);
        console.log(`   💡 Tip: Run 'ant index ${project}' after git commit to index your codebase`);
        // ✅ Don't fallback to keyword search - retrieve should only use Vector DB
        // Uncommitted files will be handled by explore (local changes check)
      }
    } else {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ✅ No Vector DB - return empty result (retrieve requires Vector DB)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      console.log(`   ⚠️  No Vector DB available - retrieve requires Vector DB`);
      console.log(`   💡 Configure Vector DB and run 'ant index ${project}' to enable codebase retrieval`);
      codeFiles = [];  // ✅ Empty result - no fallback to keyword search
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Load file contents
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const result = await this.fileLoader.load(
      codeFiles,
      actualWorkingDir,  // ✅ Use actualWorkingDir for reference support
      deps.git,
      maxTokens
    );

    console.log(`✅ Retrieval complete: ${result.stats.filesLoaded} files, ${lessons.length} lessons, ~${result.stats.estimatedTokens} tokens`);

    // ✅ Track which search method was actually used
    const searchMethod = codeFiles.length === 0 ? 'none' : 'vector-db';

    return {
      ...result,
      lessons,  // ✅ Include lessons in result
      searchMethod  // ✅ Include search method used (always 'vector-db' or 'none')
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
