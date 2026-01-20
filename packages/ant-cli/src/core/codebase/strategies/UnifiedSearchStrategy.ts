import { MemoryPort, GitPort } from "../../ports";
import { FileWithSource, FileSource } from "../types";

/**
 * Unified Search Strategy
 * 
 * ✅ Multi-Collection Parallel Search:
 * - code: codebase-{project}
 * - lessons: lessons-{project}
 * 
 * Features:
 * - Parallel queries for performance
 * - Git changes boost
 * - Cross-collection relevance ranking
 */

export interface LessonResult {
  content: string;
  score: number;
  relatedFiles: string[];
  tags: string[];
  timestamp: string;
  directive?: string;
}

export interface UnifiedSearchResult {
  codeFiles: FileWithSource[];
  lessons: LessonResult[];
  stats: {
    totalCodeResults: number;
    totalLessonResults: number;
    avgCodeScore: number;
    avgLessonScore: number;
  };
}

export class UnifiedSearchStrategy {
  
  /**
   * Unified search across multiple collections
   * 
   * ✅ Parallel queries:
   * 1. codebase-{project} → code files
   * 2. lessons-{project} → lessons
   * 
   * @param directive - User's directive/query
   * @param project - Project name
   * @param deps - Dependencies (vectorDB, git)
   * @param options - Search options
   * @returns Unified search result
   */
  async search(
    directive: string,
    project: string,
    deps: {
      vectorDB: MemoryPort;
      git?: GitPort;
    },
    options: {
      maxCodeFiles: number;       // 15
      maxLessons: number;         // 5
      minCodeScore: number;       // 0.6
      minLessonScore: number;     // 0.5
      includeGitChanges: boolean; // true
    }
  ): Promise<UnifiedSearchResult> {
    
    console.log(`🔍 [Unified Search] Multi-collection parallel query...`);
    console.log(`   🔑 Project: "${project}" (collection: codebase-${project})`);
    console.log(`   📝 Directive: "${directive.substring(0, 100)}..."`);
    console.log(`   📊 Params: k=${options.maxCodeFiles * 2}, minScore=${options.minCodeScore}`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Parallel search across 2 collections
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const [codeResults, lessonResults] = await Promise.all([
      // Code search (codebase collection)
      deps.vectorDB.query(directive, project, {
        k: options.maxCodeFiles * 2,
        minScore: options.minCodeScore,
        collectionType: 'codebase'
      }),
      
      // Lesson search (lessons collection)
      deps.vectorDB.query(directive, project, {
        k: options.maxLessons * 2,
        minScore: options.minLessonScore,
        collectionType: 'lessons'
      })
    ]);
    
    console.log(`   📊 Results: ${codeResults.length} code, ${lessonResults.length} lessons`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Process code files
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let codeFiles = this.extractCodeFiles(codeResults);
    
    // Boost git-changed files
    if (options.includeGitChanges && deps.git) {
      try {
        const hasChanges = await deps.git.hasChanges();
        if (hasChanges) {
          const gitChanges = await deps.git.getChangedFiles();
          codeFiles = this.boostChangedFiles(codeFiles, gitChanges);
          console.log(`   🔥 Boosted ${gitChanges.length} git-changed files`);
        }
      } catch (error) {
        console.warn('   ⚠️  Failed to get git changes:', error);
      }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Process lessons
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const lessons = this.extractLessons(lessonResults);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Limit to top N
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const topCodeFiles = codeFiles.slice(0, options.maxCodeFiles);
    const topLessons = lessons.slice(0, options.maxLessons);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. Calculate stats
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const stats = {
      totalCodeResults: topCodeFiles.length,
      totalLessonResults: topLessons.length,
      avgCodeScore: this.calculateAvgScore(topCodeFiles.map(f => 
        f.sources.find(s => s.type === 'vector')?.score || 0
      )),
      avgLessonScore: this.calculateAvgScore(topLessons.map(l => l.score))
    };
    
    console.log(`   ✅ Selected: ${stats.totalCodeResults} code, ${stats.totalLessonResults} lessons`);
    console.log(`   📊 Avg scores: code=${stats.avgCodeScore.toFixed(2)}, lesson=${stats.avgLessonScore.toFixed(2)}`);
    
    return {
      codeFiles: topCodeFiles,
      lessons: topLessons,
      stats
    };
  }
  
  /**
   * Extract code files from search results
   */
  private extractCodeFiles(results: any[]): FileWithSource[] {
    const filesMap = new Map<string, FileWithSource>();
    
    console.log(`   🔎 [extractCodeFiles] Processing ${results.length} raw results...`);
    
    for (const result of results) {
      const filePath = result.metadata?.filePath || result.metadata?.file;
      const score = result.score || 0;
      
      if (!filePath) {
        console.log(`   ⚠️  Skipping result without filePath:`, JSON.stringify(result.metadata).substring(0, 200));
        continue;
      }
      
      const existing = filesMap.get(filePath);
      if (!existing || score > (existing.sources[0] as any).score) {
        filesMap.set(filePath, {
          path: filePath,
          sources: [{ type: 'vector', score }],
          priority: score >= 0.8 ? 'high' : 'normal',
          hasLocalChanges: false
        });
      }
    }
    
    const files = Array.from(filesMap.values());
    console.log(`   ✅ Extracted ${files.length} unique files`);
    if (files.length > 0) {
      console.log(`   📄 Sample files:`, files.slice(0, 3).map(f => f.path));
    }
    
    return files;
  }
  
  /**
   * Extract lessons from search results
   */
  private extractLessons(results: any[]): LessonResult[] {
    return results.map(r => ({
      content: r.content || r.document || '',
      score: r.score || 0,
      relatedFiles: r.metadata?.relatedFiles || [],
      tags: r.metadata?.tags || [],
      timestamp: r.metadata?.timestamp || '',
      directive: r.metadata?.directive
    }));
  }
  
  /**
   * Boost git-changed files in the results
   */
  private boostChangedFiles(
    files: FileWithSource[],
    gitChanges: string[]
  ): FileWithSource[] {
    const changedSet = new Set(gitChanges.map(f => f.replace(/\\/g, '/')));
    
    // Mark changed files and boost priority
    for (const file of files) {
      const normalizedPath = file.path.replace(/\\/g, '/');
      if (changedSet.has(normalizedPath)) {
        file.hasLocalChanges = true;
        file.priority = 'high';
        file.sources.push({ type: 'git-changed' });
      }
    }
    
    // Sort: git-changed files first, then by score
    return files.sort((a, b) => {
      if (a.hasLocalChanges && !b.hasLocalChanges) return -1;
      if (!a.hasLocalChanges && b.hasLocalChanges) return 1;
      
      const scoreA = a.sources.find(s => s.type === 'vector')?.score || 0;
      const scoreB = b.sources.find(s => s.type === 'vector')?.score || 0;
      return scoreB - scoreA;
    });
  }
  
  /**
   * Calculate average score
   */
  private calculateAvgScore(scores: number[]): number {
    if (scores.length === 0) return 0;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }
}
