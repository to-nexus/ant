import { MemoryPort, GitPort } from "../../ports";
import { FileWithSource, FileSource } from "../types";

/**
 * Unified Search Strategy
 * 
 * 통합 검색: code + lesson을 한 번의 쿼리로 검색
 * - 유사도 기반 자동 우선순위
 * - Git 변경사항 boost
 * - 관련성 높은 것만 선택
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
    totalResults: number;
    codeResults: number;
    lessonResults: number;
    avgCodeScore: number;
    avgLessonScore: number;
  };
}

export class UnifiedSearchStrategy {
  
  /**
   * Unified search for code + lessons
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
      maxCodeFiles: number;      // 15
      maxLessons: number;         // 5
      minCodeScore: number;       // 0.6
      minLessonScore: number;     // 0.5
      includeGitChanges: boolean; // true
    }
  ): Promise<UnifiedSearchResult> {
    
    console.log(`🔍 [Unified Search] Querying: "${directive.substring(0, 50)}..."`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. Single query for ALL types (code + lesson)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const allResults = await deps.vectorDB.query(directive, project, {
      k: options.maxCodeFiles + options.maxLessons + 30,  // Extra candidates
      minScore: Math.min(options.minCodeScore, options.minLessonScore)
      // ✅ NO where filter! Get both types
    });
    
    console.log(`   📊 Total results: ${allResults.length}`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. Separate by type, maintaining score order
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const codeResults = allResults
      .filter(r => r.metadata?.type === 'codebase')
      .filter(r => r.score >= options.minCodeScore);
    
    const lessonResults = allResults
      .filter(r => r.metadata?.type === 'lesson')
      .filter(r => r.score >= options.minLessonScore);
    
    console.log(`   📁 Code results: ${codeResults.length} (score >= ${options.minCodeScore})`);
    console.log(`   📚 Lesson results: ${lessonResults.length} (score >= ${options.minLessonScore})`);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. Extract and format code files
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let codeFiles = this.extractCodeFiles(codeResults);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. Boost git-changed files
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. Limit to top N
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const topCodeFiles = codeFiles.slice(0, options.maxCodeFiles);
    const topLessons = this.extractLessons(lessonResults).slice(0, options.maxLessons);
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 6. Calculate stats
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const stats = {
      totalResults: allResults.length,
      codeResults: topCodeFiles.length,
      lessonResults: topLessons.length,
      avgCodeScore: this.calculateAvgScore(topCodeFiles.map(f => 
        f.sources.find(s => s.type === 'vector')?.score || 0
      )),
      avgLessonScore: this.calculateAvgScore(topLessons.map(l => l.score))
    };
    
    console.log(`   ✅ Selected: ${stats.codeResults} code files, ${stats.lessonResults} lessons`);
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
    
    for (const result of results) {
      const filePath = result.metadata?.filePath || result.metadata?.file;
      const score = result.score || 0;
      
      if (!filePath) continue;
      
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
    
    return Array.from(filesMap.values());
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

