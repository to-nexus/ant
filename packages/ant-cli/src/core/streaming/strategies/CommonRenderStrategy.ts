/**
 * CommonRenderStrategy - Main rendering strategy coordinator
 * 
 * Delegates work to specialized modules:
 * - ResponseRenderer: thinking & text responses
 * - FileRenderer: file operations (create, edit, append, delete)
 */

import { IRenderStrategy } from './IRenderStrategy';
import { ParsedAction } from '../types';
import { FileRegistry } from '../state/FileRegistry';
import { ChatAPIClient } from '../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../transformers/SpecialTagTransformer';
import { UserLanguage } from '../../utils/languageDetector';
import { GitPort, FileSystemPort } from '../../ports';
import { FileTreeUpdatePort } from '../../ports/fileTree';
import { ResponseRenderer } from './common/ResponseRenderer';
import { FileRenderer } from './common/FileRenderer';

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private responseRenderer: ResponseRenderer;
  private fileRenderer: FileRenderer;
  private tagTransformer: SpecialTagTransformer;  // ✅ Store for explicitDone access
  private planContentIndex: string | undefined;
  private planTaskTitle: string | undefined;
  // Accumulates every `plan_content` chunk so the terminal `plan` emit
  // can carry the full text in `metadata.content`. Intermediate
  // `plan_generating` emits are LIVE_ONLY (see LLMResponseService
  // PROGRESS_STATUS_TYPES), so the only line persisted to chat.jsonl is
  // the final `plan` one — replay reproduces the card from that single
  // line.
  private planContentBuffer: string = '';
  private parallelTaskName: string | undefined;
  private taskResponseIndex: string | undefined;
  private taskResponseBuffer: string = '';
  
  constructor(
    chatAPI: ChatAPIClient,
    userLanguage?: UserLanguage,
    gitPort?: GitPort,
    fileSystem?: FileSystemPort,
    writeImmediately: boolean = false,
    jobType?: 'code' | 'design',
    featurePath?: string,
    codebasePath?: string,
    fileTreeUpdate?: FileTreeUpdatePort,
    onFileTouched?: (filePath: string) => void,
  ) {
    this.chatAPI = chatAPI;
    
    this.tagTransformer = new SpecialTagTransformer(userLanguage || 'en');
    
    this.responseRenderer = new ResponseRenderer(chatAPI, this.tagTransformer);
    this.fileRenderer = new FileRenderer({
      chatAPI,
      gitPort,
      fileSystem,
      fileTreeUpdate,
      writeImmediately,
      jobType,
      featurePath,
      codebasePath,
      onFileTouched,
    });
  }
  
  async render(action: ParsedAction, registry: FileRegistry): Promise<void> {
    switch (action.type) {
      case 'thinking':
        await this.responseRenderer.renderThinking(action);
        break;
        
      case 'response':
        if (this.parallelTaskName) {
          const content = action.data.content;
          if (!content || !content.trim()) break;
          const transformed = this.tagTransformer.transform(content);
          if (transformed.consumed) break;
          const text = transformed.text || content;
          if (!text.trim()) break;

          this.taskResponseBuffer += text;

          // First chunk mints the cardId via the progress status. Subsequent
          // chunks stream into the same TURN_BUFFER pendingCard — they don't
          // append jsonl lines because `task_response_streaming` is a
          // PROGRESS_STATUS type. The terminal `task_response` line is
          // emitted from `finalize()` with the accumulated buffer as
          // `metadata.content`, so chat.jsonl carries exactly one line per
          // task_response card.
          if (this.taskResponseIndex === undefined) {
            this.taskResponseIndex = await this.chatAPI.showChatStatus('task_response_streaming', {
              content: this.taskResponseBuffer,
              taskName: this.parallelTaskName,
            });
          } else {
            await this.chatAPI.streamTaskResponseChunk(this.taskResponseIndex, text);
          }
        } else {
          await this.responseRenderer.renderResponse(action);
        }
        break;
        
      case 'file_start':
        await this.fileRenderer.renderFileStart(action, registry);
        break;
        
      case 'file_content':
        await this.fileRenderer.renderFileContent(action, registry);
        break;
        
      case 'file_end':
        await this.fileRenderer.renderFileEnd(action, registry);
        break;
      
      case 'plan_start':
        this.planContentIndex = await this.chatAPI.showChatStatus('plan_generating', {
          ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {})
        });
        break;
        
      case 'plan_content': {
        const planChunk = action.data.content || '';
        if (!planChunk) break;
        this.planContentBuffer += planChunk;
        // Defensive lazy-mint: in normal flow `plan_start` lands first
        // and seeds `planContentIndex`. If a parser variant or partial
        // retry stream skips it we still anchor a single cardId here so
        // every subsequent chunk lands on the same pendingCard rather
        // than fragmenting the TURN_BUFFER.
        if (this.planContentIndex === undefined) {
          this.planContentIndex = await this.chatAPI.showChatStatus('plan_generating', {
            ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {})
          });
        }
        if (this.planContentIndex) {
          await this.chatAPI.streamPlanChunk(this.planContentIndex, planChunk);
        }
        break;
      }
        
      case 'plan_end':
        if (this.planContentIndex !== undefined) {
          // Persist the full accumulated plan text on the terminal `plan`
          // line so the FE projector can reproduce the final
          // card from a single jsonl entry. The live path keeps
          // `_preserveContent` so the already-appended UI content is
          // untouched.
          await this.chatAPI.showChatStatus('plan', {
            content: this.planContentBuffer,
            ...(this.planTaskTitle ? { taskName: this.planTaskTitle } : {}),
            _mergeIndex: this.planContentIndex,
            _preserveContent: true,
          });
          this.planContentIndex = undefined;
          this.planContentBuffer = '';
        }
        break;
      
      case 'clarify_start':
        // Re-inject placeholder (typing indicator) while clarify content is being generated
        await this.chatAPI.showChatStatus('placeholder');
        break;

      case 'task_added':
        // Side-channel action emitted by the decompose stream parser.
        // Consumed by the decompose llmCaller's `onAction` hook (Kanban
        // partial broadcast). No chat rendering — `<tasks>` is suppressed
        // by `SpecialTagTransformer` and the Kanban board owns the visual.
        break;

      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    await this.fileRenderer.finalize();

    if (this.taskResponseIndex !== undefined) {
      // Persist the full accumulated text on the terminal line so the FE
      // projector can reproduce the card from this single jsonl entry.
      // `_mergeIndex` keeps the cardId stable so `appendChatStatus` clears
      // the matching pendingCard from the TURN_BUFFER on transition.
      await this.chatAPI.showChatStatus('task_response', {
        content: this.taskResponseBuffer,
        taskName: this.parallelTaskName,
        _mergeIndex: this.taskResponseIndex,
      });
      this.taskResponseIndex = undefined;
      this.taskResponseBuffer = '';
    }
    
    if (!hasToolCalls) {
      await this.chatAPI.finalizeMessage();
    }
  }
  
  /**
   * Get FileRenderer instance for direct access
   * Used by StreamOrchestrator to wait for file operations
   */
  getFileRenderer(): FileRenderer {
    return this.fileRenderer;
  }
  
  /**
   * Check if LLM explicitly output <done>true</done>
   * Used by execute to determine task completion
   */
  getExplicitDone(): boolean {
    return this.tagTransformer.explicitDone;
  }
  
  /**
   * Set task title for plan card header display
   */
  setPlanTaskTitle(title: string): void {
    this.planTaskTitle = title;
  }
  
  /**
   * Enable TaskResponseCard routing for worker graph nodes.
   * When set, `response` actions are routed to task_response cards
   * instead of plain text, providing parallel-safe contained output.
   */
  setParallelTaskName(name: string): void {
    this.parallelTaskName = name;
  }
  
  /**
   * Reset state for stream retry
   */
  reset(): void {
    this.fileRenderer.reset();
    this.taskResponseIndex = undefined;
    this.taskResponseBuffer = '';
    this.planContentIndex = undefined;
    this.planContentBuffer = '';
  }
}
