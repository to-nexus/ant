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
  private planContentIndex: number | undefined;
  private planTaskTitle: string | undefined;
  private parallelTaskName: string | undefined;
  private taskResponseIndex: number | undefined;
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
    fileTreeUpdate?: FileTreeUpdatePort
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
      codebasePath
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

          if (this.taskResponseIndex === undefined) {
            this.taskResponseIndex = await this.chatAPI.showChatStatus('task_response', {
              content: this.taskResponseBuffer,
              taskName: this.parallelTaskName
            });
          } else {
            await this.chatAPI.showChatStatus('task_response', {
              content: this.taskResponseBuffer,
              taskName: this.parallelTaskName,
              _mergeIndex: this.taskResponseIndex
            });
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
        if (planChunk) {
          await this.chatAPI.showChatStatus('plan_generating', { content: planChunk });
        }
        break;
      }
        
      case 'plan_end':
        if (this.planContentIndex !== undefined) {
          await this.chatAPI.showChatStatus('plan', {
            _mergeIndex: this.planContentIndex,
            _preserveContent: true
          });
          this.planContentIndex = undefined;
        }
        break;
      
      case 'clarify_start':
        // Re-inject placeholder (typing indicator) while clarify content is being generated
        await this.chatAPI.showChatStatus('placeholder');
        break;
        
      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    await this.fileRenderer.finalize();

    if (this.taskResponseIndex !== undefined) {
      await this.chatAPI.showChatStatus('task_response', {
        _mergeIndex: this.taskResponseIndex,
        _preserveContent: true,
        completed: true,
        taskName: this.parallelTaskName
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
   * Used by codeGen to determine task completion
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
  }
}
