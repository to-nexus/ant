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
import { GitPort } from '../../ports/git';
import { ResponseRenderer } from './common/ResponseRenderer';
import { FileRenderer } from './common/FileRenderer';

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private responseRenderer: ResponseRenderer;
  private fileRenderer: FileRenderer;
  
  constructor(
    chatAPI: ChatAPIClient,
    userLanguage?: UserLanguage,
    gitPort?: GitPort,
    writeImmediately: boolean = false,
    jobType?: 'code' | 'design',
    featurePath?: string
  ) {
    this.chatAPI = chatAPI;
    
    const tagTransformer = new SpecialTagTransformer(userLanguage || 'en');
    
    this.responseRenderer = new ResponseRenderer(chatAPI, tagTransformer);
    this.fileRenderer = new FileRenderer({
      chatAPI,
      gitPort,
      writeImmediately,
      jobType,
      featurePath
    });
  }
  
  async render(action: ParsedAction, registry: FileRegistry): Promise<void> {
    switch (action.type) {
      case 'thinking':
        await this.responseRenderer.renderThinking(action);
        break;
        
      case 'response':
        await this.responseRenderer.renderResponse(action);
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
        
      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  async finalize(hasToolCalls: boolean = false): Promise<void> {
    console.log('[CommonRenderStrategy] 🏁 Finalizing render strategy...');
    
    await this.fileRenderer.finalize();
    
    if (!hasToolCalls) {
      console.log('[CommonRenderStrategy] ✅ Finalizing message (no tool calls)');
      await this.chatAPI.finalizeMessage();
    } else {
      console.log('[CommonRenderStrategy] ⏸️  Keeping message open (tool calls pending)');
    }
  }
}
