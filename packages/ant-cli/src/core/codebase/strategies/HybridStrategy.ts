import { FileSource, FileWithSource } from "../types";

/**
 * Hybrid Strategy
 * 
 * Merges results from multiple search strategies:
 * - Vector search (semantic)
 * - Keyword search (text-based)
 * - Git changes (priority boost)
 * - Import graph (structural connections)
 */
export class HybridStrategy {
  
  /**
   * Merge results from multiple strategies
   * 
   * Priority:
   * 1. Files found by multiple strategies (higher confidence)
   * 2. Vector search results (semantic relevance)
   * 3. Keyword search results (text relevance)
   * 
   * @param vectorResults - Results from vector search
   * @param keywordResults - Results from keyword search
   * @param maxFiles - Maximum number of files to return
   * @returns Merged and deduplicated results with source tracking
   */
  merge(
    vectorResults: Array<{ path: string; source: FileSource }>,
    keywordResults: Array<{ path: string; source: FileSource }>,
    maxFiles: number
  ): FileWithSource[] {
    
    // Build map: path -> FileWithSource
    const fileMap = new Map<string, FileWithSource>();

    // Add vector results
    for (const result of vectorResults) {
      this.addOrMergeFile(fileMap, result.path, result.source);
    }

    // Add keyword results
    for (const result of keywordResults) {
      this.addOrMergeFile(fileMap, result.path, result.source);
    }

    // Convert to array and calculate priority
    const files = Array.from(fileMap.values()).map(file => ({
      ...file,
      priority: this.calculatePriority(file) as 'high' | 'normal',
      hasLocalChanges: false  // Will be updated by GitBooster
    }));

    // Sort by priority and confidence
    const sorted = files.sort((a, b) => {
      // Multiple sources = higher confidence
      const aConfidence = a.sources.length;
      const bConfidence = b.sources.length;
      
      if (aConfidence !== bConfidence) {
        return bConfidence - aConfidence;
      }
      
      // Vector score
      const aVectorScore = this.getVectorScore(a);
      const bVectorScore = this.getVectorScore(b);
      
      return bVectorScore - aVectorScore;
    });

    const result = sorted.slice(0, maxFiles);

    // Log merge statistics
    this.logMergeStats(result, vectorResults.length, keywordResults.length);

    return result;
  }

  /**
   * Add file to map or merge sources if already exists
   */
  private addOrMergeFile(
    fileMap: Map<string, FileWithSource>,
    path: string,
    source: FileSource
  ): void {
    const existing = fileMap.get(path);
    
    if (existing) {
      // File already exists, add source
      existing.sources.push(source);
    } else {
      // New file
      fileMap.set(path, {
        path,
        sources: [source],
        priority: 'normal',
        hasLocalChanges: false
      });
    }
  }

  /**
   * Calculate priority based on sources
   * (Will be overridden by GitBooster for changed files)
   */
  private calculatePriority(file: FileWithSource): 'high' | 'normal' {
    // Files with multiple sources get higher priority
    if (file.sources.length >= 2) {
      return 'high';
    }
    
    return 'normal';
  }

  /**
   * Get vector score from sources
   */
  private getVectorScore(file: FileWithSource): number {
    for (const source of file.sources) {
      if (source.type === 'vector') {
        return source.score;
      }
    }
    return 0;
  }

  /**
   * Log merge statistics
   */
  private logMergeStats(
    result: FileWithSource[],
    vectorCount: number,
    keywordCount: number
  ): void {
    const multiSource = result.filter(f => f.sources.length > 1).length;
    const vectorOnly = result.filter(f => 
      f.sources.length === 1 && f.sources[0].type === 'vector'
    ).length;
    const keywordOnly = result.filter(f => 
      f.sources.length === 1 && f.sources[0].type === 'keyword'
    ).length;

    console.log(`   🔀 Hybrid merge: ${result.length} files total`);
    console.log(`      └─ Multi-source: ${multiSource}, Vector-only: ${vectorOnly}, Keyword-only: ${keywordOnly}`);
    console.log(`      └─ Input: Vector(${vectorCount}) + Keyword(${keywordCount})`);
  }
}

