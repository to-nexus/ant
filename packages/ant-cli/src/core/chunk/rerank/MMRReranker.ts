import { QueryResult } from "../../ports/memory";

/**
 * MMR (Maximal Marginal Relevance) Reranker
 * 
 * Balances relevance and diversity in search results
 * 
 * Algorithm:
 * 1. Start with highest relevance result
 * 2. Iteratively select next result that maximizes:
 *    MMR = λ * Relevance - (1-λ) * MaxSimilarity
 *    where MaxSimilarity is similarity to already selected results
 * 3. Lambda (λ) controls relevance vs diversity tradeoff
 * 
 * Benefits:
 * - Reduces redundant results
 * - Increases information diversity
 * - Better coverage of topic space
 */

export interface MMRConfig {
  /** Lambda parameter (0-1): 1 = pure relevance, 0 = pure diversity */
  lambda?: number;
  
  /** Number of results to return */
  k?: number;
}

export class MMRReranker {
  private lambda: number;
  
  constructor(config: MMRConfig = {}) {
    this.lambda = config.lambda ?? 0.7;  // Default: 70% relevance, 30% diversity
  }
  
  /**
   * Rerank results using MMR algorithm
   * 
   * @param results - Original search results sorted by relevance
   * @param k - Number of results to return (default: all)
   * @returns Reranked results with diversity
   */
  rerank(results: QueryResult[], k?: number): QueryResult[] {
    if (results.length === 0) return [];
    
    const targetK = k || results.length;
    const selected: QueryResult[] = [];
    const remaining = [...results];
    
    // Step 1: Select the most relevant result first
    const first = remaining.shift()!;
    selected.push(first);
    
    // Step 2: Iteratively select remaining results
    while (selected.length < targetK && remaining.length > 0) {
      let maxMMR = -Infinity;
      let maxIndex = 0;
      
      // Find result that maximizes MMR score
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        
        // Calculate maximum similarity to already selected results
        const maxSim = Math.max(
          ...selected.map(s => this.similarity(candidate.content, s.content))
        );
        
        // MMR score: λ * relevance - (1-λ) * similarity
        const mmr = this.lambda * candidate.score - (1 - this.lambda) * maxSim;
        
        if (mmr > maxMMR) {
          maxMMR = mmr;
          maxIndex = i;
        }
      }
      
      // Select the result with highest MMR
      selected.push(remaining.splice(maxIndex, 1)[0]);
    }
    
    return selected;
  }
  
  /**
   * Calculate similarity between two documents
   * 
   * Uses simple token-based Jaccard similarity for efficiency
   * Can be replaced with more sophisticated methods (embedding similarity, etc.)
   */
  private similarity(doc1: string, doc2: string): number {
    const tokens1 = new Set(this.tokenize(doc1));
    const tokens2 = new Set(this.tokenize(doc2));
    
    // Jaccard similarity: intersection / union
    const intersection = new Set([...tokens1].filter(t => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  }
  
  /**
   * Simple tokenization (can be improved)
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);  // Filter short tokens
  }
}

