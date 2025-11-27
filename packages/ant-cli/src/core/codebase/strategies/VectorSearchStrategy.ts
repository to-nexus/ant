import { MemoryPort } from "../../ports";
import { FileSource } from "../types";

/**
 * Vector Search Strategy
 * 
 * Uses Vector DB (embeddings) for semantic similarity search.
 */
export class VectorSearchStrategy {
  
  /**
   * Search files using Vector DB semantic search
   * 
   * @param directive - User's directive/query
   * @param vectorDB - Vector database port
   * @param options - Search options
   * @returns Array of file paths with scores
   */
  async search(
    directive: string,
    vectorDB: MemoryPort,
    options: {
      maxFiles: number;
      minScore?: number;
    }
  ): Promise<Array<{ path: string; source: FileSource }>> {
    try {
      const results = await vectorDB.query(directive, 'codebase', {
        k: options.maxFiles * 2,  // Get more candidates
        minScore: options.minScore || 0.4,
        where: { type: 'codebase' }  // ✅ Query codebase, not learning
      });

      if (results.length === 0) {
        console.log('   🔍 Vector search: no results');
        return [];
      }

      // Extract file paths with scores
      const files = this.extractFilesWithScores(results);
      
      // Deduplicate and sort by score
      const uniqueFiles = this.deduplicateByPath(files);
      const topFiles = uniqueFiles
        .sort((a, b) => b.source.type === 'vector' && a.source.type === 'vector' 
          ? b.source.score - a.source.score 
          : 0)
        .slice(0, options.maxFiles);

      console.log(`   🔍 Vector search: ${topFiles.length} files (scores: ${this.formatScoreRange(topFiles)})`);
      
      return topFiles;
    } catch (error) {
      console.warn('   ⚠️  Vector search failed:', error);
      return [];
    }
  }

  /**
   * Extract file paths from vector search results
   */
  private extractFilesWithScores(
    results: any[]
  ): Array<{ path: string; source: FileSource }> {
    const files: Array<{ path: string; source: FileSource }> = [];
    
    for (const result of results) {
      const filePath = result.metadata?.filePath || result.metadata?.file;
      const score = result.score || result.similarity || 0;
      
      if (filePath) {
        files.push({
          path: filePath,
          source: { type: 'vector', score }
        });
      }
    }
    
    return files;
  }

  /**
   * Deduplicate files by path (keep highest score)
   */
  private deduplicateByPath(
    files: Array<{ path: string; source: FileSource }>
  ): Array<{ path: string; source: FileSource }> {
    const map = new Map<string, { path: string; source: FileSource }>();
    
    for (const file of files) {
      const existing = map.get(file.path);
      if (!existing) {
        map.set(file.path, file);
      } else if (
        file.source.type === 'vector' && 
        existing.source.type === 'vector' &&
        file.source.score > existing.source.score
      ) {
        map.set(file.path, file);
      }
    }
    
    return Array.from(map.values());
  }

  /**
   * Format score range for logging
   */
  private formatScoreRange(
    files: Array<{ path: string; source: FileSource }>
  ): string {
    if (files.length === 0) return 'none';
    
    const scores = files
      .map(f => f.source.type === 'vector' ? f.source.score : 0)
      .filter(s => s > 0);
    
    if (scores.length === 0) return 'none';
    
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    
    return `${min.toFixed(2)}-${max.toFixed(2)}`;
  }
}

