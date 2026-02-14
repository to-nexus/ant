/**
 * StreamOrchestrator - Main coordinator for LLM streaming pipeline
 * 
 * Orchestrates the single-pipeline flow:
 * 1. Receive LLM tokens
 * 2. Parse incrementally (XMLStreamParser)
 * 3. Render actions (CommonRenderStrategy)
 * 4. Track files (FileRegistry)
 * 
 * Design goals:
 * - Single pipeline (no dual-pipeline issues)
 * - Real-time parsing (token-level incremental)
 * - Duplicate prevention (via FileRegistry)
 * - Reusable across all agent nodes (code/design/learn)
 */

import { IStreamParser } from './parsers/IStreamParser';
import { IRenderStrategy } from './strategies/IRenderStrategy';
import { StreamState } from './state/StreamState';
import { FileRegistry } from './state/FileRegistry';
import { LLMStreamEvent } from '../ports/llm';
import { StreamResult } from './types';

export interface StreamOrchestratorConfig {
  parser: IStreamParser;
  renderStrategy: IRenderStrategy;
  existingFiles: Set<string>;
  fileSystem?: any;  // ✅ FileSystemPort for disk checks (optional)
  codebaseRel?: string;  // ✅ Codebase directory relative to workspace (for path normalization)
}

export class StreamOrchestrator {
  private parser: IStreamParser;
  private renderStrategy: IRenderStrategy;
  private state: StreamState;
  private registry: FileRegistry;
  private streamStarted: boolean = false;  // ✅ Track if stream has started
  
  constructor(config: StreamOrchestratorConfig) {
    this.parser = config.parser;
    this.renderStrategy = config.renderStrategy;
    this.registry = new FileRegistry(config.existingFiles, config.fileSystem, config.codebaseRel);
    this.state = new StreamState();
  }
  
  /**
   * Process a single streaming event
   * 
   * @param event - LLM stream event (token/thinking/done/error)
   * @returns Promise that resolves when event is processed
   */
  async processEvent(event: LLMStreamEvent): Promise<void> {
    try {
      // ✅ CRITICAL: Reset on first event of a new stream (after previous stream ended)
      // This handles stream retry scenarios where a network error interrupted mid-stream
      // and withRetryStream starts a new stream without resetting the orchestrator
      if (!this.streamStarted) {
        // Check if there are incomplete file operations from a previous failed stream
        const fileRenderer = (this.renderStrategy as any).getFileRenderer?.();
        if (fileRenderer?.hasActiveFiles?.()) {
          console.log(`[StreamOrchestrator] 🔄 Detected incomplete files from previous failed stream - resetting`);
          // Reset everything except streamStarted
          this.parser.reset();
          this.state.reset();
          this.registry.reset();
          const renderStrategy = this.renderStrategy as any;
          if (renderStrategy.reset && typeof renderStrategy.reset === 'function') {
            renderStrategy.reset();
          }
        }
        this.streamStarted = true;
      }
      
      // ✅ Mark stream as ended on 'done' event (for next retry detection)
      if (event.type === 'done') {
        this.streamStarted = false;
      }
      
      // 1. Parse event → actions
      const actions = this.parser.parse(event, this.state);
      
      // 2. Render each action
      for (const action of actions) {
        await this.renderStrategy.render(action, this.registry);
      }
    } catch (error) {
      console.error('[StreamOrchestrator] Error processing event:', error);
      // ✅ Mark stream as ended on error (for next retry detection)
      this.streamStarted = false;
      throw error;
    }
  }
  
  /**
   * Finalize the stream (called after all events processed)
   * 
   * @param hasToolCalls - If true, keeps message open for tool execution
   * @returns StreamResult containing raw text and metadata
   */
  async finalize(hasToolCalls: boolean = false): Promise<StreamResult> {
    console.log('[StreamOrchestrator] 🏁 Finalizing orchestrator...');
    try {
      // ✅ CRITICAL: Flush parser buffer first (get any remaining content)
      const finalActions = this.parser.finalize();
      
      // Only log if there are final actions (non-empty buffer)
      if (finalActions.length > 0) {
        console.log(`[StreamOrchestrator] 🔚 Flushing ${finalActions.length} final action(s)`);
      }
      
      // Process final actions
      for (const action of finalActions) {
        await this.renderStrategy.render(action, this.registry);
      }
      
      // Finalize rendering (cleanup incomplete operations)
      // Pass hasToolCalls to prevent premature message finalization
      await this.renderStrategy.finalize(hasToolCalls);
      
      // ✅ CRITICAL: Get file errors from FileRenderer for self-healing
      const fileRenderer = (this.renderStrategy as any).getFileRenderer?.();
      const fileErrors = fileRenderer?.getFileErrors?.() || [];
      
      // ✅ Detect silent failure: file JSON pattern in text that wasn't processed as <file> XML
      const raw = this.state.getRaw();
      const streamedFiles = this.registry.getStreamedFiles();
      this.detectFileJsonInText(raw, streamedFiles, fileErrors);
      
      // ✅ Get explicit done status from render strategy
      const explicitDone = (this.renderStrategy as any).getExplicitDone?.() || false;
      
      return {
        raw: this.state.getRaw(),
        streamedFiles,
        completedActions: [],  // TODO: track if needed
        fileErrors,  // ✅ Include file errors for self-healing
        explicitDone  // ✅ Include explicit done status
      };
    } catch (error) {
      console.error('[StreamOrchestrator] Error finalizing:', error);
      throw error;
    }
  }
  
  /**
   * Reset orchestrator state (for reuse or stream retry)
   * ✅ CRITICAL: Also resets FileRenderer to clear incomplete file operations
   */
  reset(): void {
    this.parser.reset();
    this.state.reset();
    this.registry.reset();
    this.streamStarted = false;  // ✅ Reset stream tracking
    
    // ✅ Reset FileRenderer to clear incomplete file operations (for stream retry)
    const renderStrategy = this.renderStrategy as any;
    if (renderStrategy.reset && typeof renderStrategy.reset === 'function') {
      renderStrategy.reset();
    }
  }
  
  /**
   * Get file registry (for post-processing checks)
   */
  getRegistry(): FileRegistry {
    return this.registry;
  }
  
  /**
   * Get accumulated raw text
   */
  getRaw(): string {
    return this.state.getRaw();
  }

  /**
   * Detect file JSON patterns in raw text that weren't processed as <file> XML tags.
   * This catches silent failures where LLM outputs file content as text instead of XML.
   * Detected errors are added to fileErrors for self-healing retry.
   */
  private detectFileJsonInText(raw: string, streamedFiles: string[], fileErrors: string[]): void {
    // Match patterns like: file: {"path":"some/file.ts","content":"..."}
    // Also match: write_file({"path":"...","content":"..."}) and similar variants
    const fileJsonPattern = /(?:file|write_file|create_file)\s*[:(\s]\s*\{\s*"path"\s*:\s*"([^"]+)"[^}]*"content"/g;
    let match;
    while ((match = fileJsonPattern.exec(raw)) !== null) {
      const detectedPath = match[1];
      // Only flag if the file wasn't already created via proper <file> XML tag
      if (!streamedFiles.includes(detectedPath)) {
        console.error(`🚨 [StreamOrchestrator] SILENT FAILURE: file JSON in text but not created: ${detectedPath}`);
        fileErrors.push(
          `File not created (wrong format): ${detectedPath} - ` +
          `LLM output file content as text instead of <file> XML tag. ` +
          `Use: <file path="${detectedPath}">content</file>`
        );
      }
    }
  }
  
  /**
   * Wait for all file operations to complete
   * ✅ CRITICAL: Call this before marking task as completed
   * Ensures all files are saved before proceeding
   */
  async waitForAllFileOperations(): Promise<void> {
    // Access FileRenderer through render strategy
    const fileRenderer = (this.renderStrategy as any).getFileRenderer?.();
    
    if (fileRenderer && typeof fileRenderer.waitForAllFileOperations === 'function') {
      await fileRenderer.waitForAllFileOperations();
    } else {
      console.warn('[StreamOrchestrator] FileRenderer not available or does not support waitForAllFileOperations');
    }
  }
}

