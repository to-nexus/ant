import { CodeContext } from "./types";
import * as crypto from "crypto";

/**
 * Cache entry
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
}

/**
 * CodebaseCache
 * 
 * LRU cache for codebase retrieval results
 * Reduces Vector DB calls and file I/O
 */
export class CodebaseCache {
  private cache: Map<string, CacheEntry<CodeContext>> = new Map();
  private maxSize: number;
  private ttl: number;
  
  constructor(options: {
    maxSize?: number;  // Max number of entries (default: 100)
    ttl?: number;      // Time to live in seconds (default: 3600 = 1 hour)
  } = {}) {
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 3600;
  }
  
  /**
   * Get cached result
   */
  get(key: string): CodeContext | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    // Update hits
    entry.hits++;
    
    return entry.value;
  }
  
  /**
   * Set cache entry
   */
  set(key: string, value: CodeContext): void {
    // Evict if at max size
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0
    });
  }
  
  /**
   * Generate cache key from params
   */
  static generateKey(
    directive: string,
    workingDir: string,
    options: any
  ): string {
    const parts = [
      directive,
      workingDir,
      JSON.stringify(options)
    ];
    
    return crypto
      .createHash('md5')
      .update(parts.join('|'))
      .digest('hex');
  }
  
  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache stats
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgHits: number;
  } {
    let totalHits = 0;
    let totalEntries = 0;
    
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
      totalEntries++;
    }
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: totalEntries > 0 ? totalHits / totalEntries : 0,
      avgHits: totalEntries > 0 ? totalHits / totalEntries : 0
    };
  }
  
  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    let lowestHits = Infinity;
    
    // Find entry with lowest hits and oldest timestamp
    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < lowestHits || 
          (entry.hits === lowestHits && entry.timestamp < oldestTime)) {
        oldestKey = key;
        oldestTime = entry.timestamp;
        lowestHits = entry.hits;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

