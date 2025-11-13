/**
 * Common rendering strategy that covers 99% of streaming use cases
 * 
 * Handles:
 * - thinking: LLM reasoning output
 * - response: General text response
 * - file_start: Begin file creation/editing
 * - file_content: Stream file content
 * - file_end: Complete file operation
 */

import { IRenderStrategy } from './IRenderStrategy';
import { ParsedAction, FileStreamInfo } from '../types';
import { FileRegistry } from '../state/FileRegistry';
import { ChatAPIClient } from '../../adapters/ChatAPIClient';

interface EditOperation {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

export class CommonRenderStrategy implements IRenderStrategy {
  private chatAPI: ChatAPIClient;
  private activeFiles: Map<string, FileStreamInfo> = new Map();
  private editOperations: Map<string, EditOperation> = new Map();
  
  constructor(chatAPI: ChatAPIClient) {
    this.chatAPI = chatAPI;
  }
  
  async render(action: ParsedAction, registry: FileRegistry): Promise<void> {
    switch (action.type) {
      case 'thinking':
        await this.renderThinking(action);
        break;
        
      case 'response':
        await this.renderResponse(action);
        break;
        
      case 'file_start':
        await this.renderFileStart(action, registry);
        break;
        
      case 'file_content':
        await this.renderFileContent(action, registry);
        break;
        
      case 'file_end':
        await this.renderFileEnd(action, registry);
        break;
        
      default:
        console.warn(`[CommonRenderStrategy] Unknown action type: ${action.type}`);
    }
  }
  
  private async renderThinking(action: ParsedAction): Promise<void> {
    const content = action.data.content || '';
    const isBlockStart = action.data.blockStart === true;
    
    // ✅ Show Chat Status when new thinking block starts
    if (isBlockStart) {
      await this.chatAPI.showChatStatus('thinking', {
        blockStart: true
      });
    }
    
    // ✅ Send thinking content ONLY if there's actual content
    // (blockStart with empty content is just the status change, no content to append yet)
    if (content) {
      await this.chatAPI.sendLLMEvent({
        type: 'thinking',
        content,
        metadata: {
          provider: 'llm',  // Mark as LLM-generated (not system placeholder)
          timestamp: new Date().toISOString(),
          blockStart: isBlockStart  // ✅ New block start signal
        }
      });
    }
  }
  
  private async renderResponse(action: ParsedAction): Promise<void> {
    const content = action.data.content;
    if (!content || !content.trim()) return;
    
    await this.chatAPI.sendLLMEvent({
      type: 'text',
      content
    });
  }
  
  private async renderFileStart(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath, actionType } = action.data;
    
    if (!filePath) {
      console.error('[CommonRenderStrategy] file_start without filePath');
      return;
    }
    
    // Check for duplicates
    if (registry.hasStreamed(filePath)) {
      console.log(`⏭️  [Render] Skipping duplicate file: ${filePath}`);
      return;
    }
    
    // Determine final action type
    const isExisting = registry.isExisting(filePath);
    const finalActionType = actionType === 'delete' 
      ? 'delete' 
      : (isExisting ? 'edit' : 'create');
    
    console.log(`📝 [Render] Starting ${finalActionType.toUpperCase()}: ${filePath}`);
    
    // Register in registry
    registry.markAsStreamed(filePath, finalActionType);
    
    // Initialize active file tracking
    this.activeFiles.set(filePath, {
      filePath,
      actionType: finalActionType,
      startedAt: Date.now(),
      contentBuffer: ''
    });
    
    // Send UI notification
    if (finalActionType === 'create') {
      await this.chatAPI.streamFileContent(filePath, '');
    } else if (finalActionType === 'edit') {
      await this.chatAPI.startFileEdit(filePath);
      // Initialize edit operation tracking
      this.editOperations.set(filePath, {
        filePath,
        searchContent: '',
        replaceContent: ''
      });
    } else if (finalActionType === 'delete') {
      await this.chatAPI.completeFileDeletion(filePath);
    }
  }
  
  private async renderFileContent(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath, content, metadata } = action.data;
    
    if (!filePath || content === undefined) {
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_content for non-started file: ${filePath}`);
      return;
    }
    
    // Update registry buffer
    registry.appendContent(filePath, content);
    
    // Update local buffer
    fileInfo.contentBuffer += content;
    
    // Handle edit operations (search/replace sections)
    if (fileInfo.actionType === 'edit' && metadata?.section) {
      const editOp = this.editOperations.get(filePath);
      if (editOp) {
        if (metadata.section === 'search') {
          editOp.searchContent += content;
        } else if (metadata.section === 'replace') {
          editOp.replaceContent += content;
        }
      }
      return;  // Don't stream search/replace sections incrementally
    }
    
    // For create operations, we could stream content incrementally here
    // But for now, we'll accumulate and send at file_end for simplicity
    // Uncomment below to enable real-time streaming:
    // if (fileInfo.actionType === 'create') {
    //   await this.chatAPI.streamFileContent(filePath, content);
    // }
  }
  
  private async renderFileEnd(
    action: ParsedAction,
    registry: FileRegistry
  ): Promise<void> {
    const { filePath } = action.data;
    
    if (!filePath) {
      console.error('[CommonRenderStrategy] file_end without filePath');
      return;
    }
    
    const fileInfo = this.activeFiles.get(filePath);
    if (!fileInfo) {
      console.warn(`[Render] file_end for non-started file: ${filePath}`);
      return;
    }
    
    console.log(`✅ [Render] Completing ${fileInfo.actionType.toUpperCase()}: ${filePath}`);
    
    try {
      if (fileInfo.actionType === 'create') {
        await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
      } else if (fileInfo.actionType === 'edit') {
        const editOp = this.editOperations.get(filePath);
        if (editOp) {
          // Complete the edit with search/replace
          await this.chatAPI.completeFileEdit(
            filePath,
            editOp.searchContent,
            editOp.replaceContent
          );
          this.editOperations.delete(filePath);
        } else {
          console.warn(`[Render] No edit operation found for: ${filePath}`);
        }
      }
      // delete action is already completed in file_start
    } catch (error) {
      console.error(`[Render] Error completing ${fileInfo.actionType} for ${filePath}:`, error);
    } finally {
      // Cleanup
      this.activeFiles.delete(filePath);
    }
  }
  
  async finalize(): Promise<void> {
    console.log('[CommonRenderStrategy] 🏁 Finalizing render strategy...');
    
    // Force complete any unfinished files
    for (const [filePath, fileInfo] of this.activeFiles) {
      console.warn(`⚠️  [Render] Force completing ${fileInfo.actionType}: ${filePath}`);
      
      try {
        if (fileInfo.actionType === 'create') {
          await this.chatAPI.completeFileCreation(filePath, fileInfo.contentBuffer);
        } else if (fileInfo.actionType === 'edit') {
          const editOp = this.editOperations.get(filePath);
          if (editOp) {
            await this.chatAPI.completeFileEdit(
              filePath,
              editOp.searchContent,
              editOp.replaceContent
            );
          }
        }
      } catch (error) {
        console.error(`[Render] Error finalizing ${filePath}:`, error);
      }
    }
    
    this.activeFiles.clear();
    this.editOperations.clear();
    
    // ✅ CRITICAL: Finalize the chat message (sets isStreaming = false)
    // This triggers UI updates: "Thinking..." → "Thought", auto-collapse
    await this.chatAPI.finalizeMessage();
  }
}

