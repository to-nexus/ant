import { ChunkPort } from "../../../core/ports";
import { ChunkInput, ChunkResult, ChunkStrategy } from "../../../core/chunk/types";
import { ChunkEngine } from "../../../core/chunk/ChunkEngine";
import { getChunkStrategy } from "../../../core/chunk/policies/chunkPolicies";
import { Loader, Splitter, Cleaner, Annotator } from "../../../core/chunk/pipeline";

// Import implementations
import { TextLoader, FileLoader } from "./loaders";
import { MarkdownSplitter } from "./splitters";
import { MarkdownCleaner, PlainCleaner } from "./cleaners";
import { DefaultAnnotator } from "./annotators";

/**
 * ChunkAdapter - Default implementation of ChunkPort
 * 
 * Wires all pipeline components together
 */
export class ChunkAdapter implements ChunkPort {
  private engine: ChunkEngine;
  
  constructor() {
    // Initialize loaders
    const loaders = new Map<string, Loader>();
    loaders.set('text', new TextLoader());
    loaders.set('file', new FileLoader());
    
    // Initialize splitters
    const splitters = new Map<string, Splitter>();
    splitters.set('markdown', new MarkdownSplitter());
    splitters.set('plain', new MarkdownSplitter()); // Fallback
    
    // Initialize cleaners
    const cleaners = new Map<string, Cleaner>();
    cleaners.set('markdown', new MarkdownCleaner());
    cleaners.set('plain', new PlainCleaner());
    
    // Initialize annotator
    const annotator: Annotator = new DefaultAnnotator();
    
    // Create engine
    this.engine = new ChunkEngine({
      loaders,
      splitters,
      cleaners,
      annotator
    });
  }
  
  async process(
    input: ChunkInput, 
    strategy?: ChunkStrategy
  ): Promise<ChunkResult> {
    // Use provided strategy or get from policy
    const finalStrategy = strategy || getChunkStrategy(
      input.metadata.task || 'code',
      input.metadata.type
    );
    
    return this.engine.process(input, finalStrategy);
  }
}

