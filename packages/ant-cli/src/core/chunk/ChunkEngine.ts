import { Loader, Splitter, Cleaner, Annotator } from "./pipeline";
import { ChunkInput, ChunkResult, ChunkStrategy } from "./types";

/**
 * ChunkEngine Dependencies
 */
export interface ChunkEngineDeps {
  /** Loader implementations (indexed by source type) */
  loaders: Map<string, Loader>;
  
  /** Splitter implementations (indexed by content type) */
  splitters: Map<string, Splitter>;
  
  /** Cleaner implementations (indexed by content type) */
  cleaners: Map<string, Cleaner>;
  
  /** Annotator implementation (universal) */
  annotator: Annotator;
}

/**
 * ChunkEngine - 6-Stage Pipeline Orchestrator
 * 
 * Orchestrates the complete chunking pipeline:
 * 1. Loader - Load content from source
 * 2. Splitter - Split into meaningful chunks
 * 3. Cleaner - Remove noise
 * 4. Annotator - Add metadata
 * 5. (Encoder - handled by MemoryPort)
 * 6. (VectorSink - handled by MemoryPort)
 * 
 * Similar to PromptEngine: orchestrates multiple components
 */
export class ChunkEngine {
  constructor(private deps: ChunkEngineDeps) {}
  
  /**
   * Process content through the full pipeline
   * 
   * @param input - Input specification
   * @param strategy - Chunk strategy
   * @returns Chunked result with statistics
   */
  async process(
    input: ChunkInput,
    strategy: ChunkStrategy
  ): Promise<ChunkResult> {
    const startTime = Date.now();
    
    // Stage 1: Load content
    const loader = this.selectLoader(input.sourceType);
    const loaded = await loader.load(input);
    
    console.log(`📥 Loaded ${loaded.text.length} chars from ${input.source}`);
    
    // Stage 2: Split into chunks
    const splitter = this.selectSplitter(loaded.contentType);
    const rawChunks = await splitter.split(loaded, strategy);
    
    console.log(`✂️  Split into ${rawChunks.length} raw chunks`);
    
    // Stage 3: Clean chunks
    const cleaner = this.selectCleaner(loaded.contentType);
    const cleanedChunks = await cleaner.clean(rawChunks);
    
    console.log(`🧹 Cleaned ${cleanedChunks.length} chunks`);
    
    // Stage 4: Annotate with metadata
    const annotatedChunks = await this.deps.annotator.annotate(cleanedChunks);
    
    console.log(`📝 Annotated ${annotatedChunks.length} final chunks`);
    
    // Calculate statistics
    const stats = {
      originalLength: loaded.text.length,
      totalChunks: annotatedChunks.length,
      avgChunkSize: Math.round(
        annotatedChunks.reduce((sum, c) => sum + c.text.length, 0) / annotatedChunks.length
      ),
      avgTokens: Math.round(
        annotatedChunks.reduce((sum, c) => sum + c.tokens, 0) / annotatedChunks.length
      )
    };
    
    const elapsed = Date.now() - startTime;
    console.log(`⏱️  Chunking completed in ${elapsed}ms`);
    
    return {
      chunks: annotatedChunks,
      stats
    };
  }
  
  /**
   * Select appropriate loader for source type
   */
  private selectLoader(sourceType: string): Loader {
    const loader = this.deps.loaders.get(sourceType);
    if (!loader) {
      throw new Error(`No loader found for source type: ${sourceType}`);
    }
    return loader;
  }
  
  /**
   * Select appropriate splitter for content type
   */
  private selectSplitter(contentType: string): Splitter {
    const splitter = this.deps.splitters.get(contentType);
    if (!splitter) {
      // Fallback to markdown splitter
      const fallback = this.deps.splitters.get('markdown');
      if (!fallback) {
        throw new Error(`No splitter found for content type: ${contentType}`);
      }
      console.warn(`No splitter for ${contentType}, using markdown fallback`);
      return fallback;
    }
    return splitter;
  }
  
  /**
   * Select appropriate cleaner for content type
   */
  private selectCleaner(contentType: string): Cleaner {
    const cleaner = this.deps.cleaners.get(contentType);
    if (!cleaner) {
      // Fallback to basic cleaner
      const fallback = this.deps.cleaners.get('plain');
      if (!fallback) {
        throw new Error(`No cleaner found for content type: ${contentType}`);
      }
      console.warn(`No cleaner for ${contentType}, using plain fallback`);
      return fallback;
    }
    return cleaner;
  }
}

