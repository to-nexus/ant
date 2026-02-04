/**
 * ResponseRenderer - Handle thinking and text response rendering
 */

import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../../transformers/SpecialTagTransformer';
import { ParsedAction } from '../../types';

export class ResponseRenderer {
  private chatAPI: ChatAPIClient;
  private tagTransformer: SpecialTagTransformer;
  private thinkingStartTime?: number;
  
  constructor(chatAPI: ChatAPIClient, tagTransformer: SpecialTagTransformer) {
    this.chatAPI = chatAPI;
    this.tagTransformer = tagTransformer;
  }
  
  /**
   * Render thinking output
   */
  async renderThinking(action: ParsedAction): Promise<void> {
    const content = action.data.content || '';
    const isBlockStart = action.data.blockStart === true;
    const isBlockEnd = action.data.blockEnd === true;
    
    if (isBlockStart) {
      this.thinkingStartTime = Date.now();
      
      await this.chatAPI.showChatStatus('thinking', {
        blockStart: true
      });
      
      if (content) {
        await this.chatAPI.sendLLMEvent({
          type: 'thinking',
          thinking: content,
          metadata: {
            provider: 'llm',
            timestamp: new Date().toISOString()
          }
        });
      }
    } else if (isBlockEnd) {
      const durationMs = action.data.durationMs 
        || (this.thinkingStartTime ? Date.now() - this.thinkingStartTime : undefined);
      
      await this.chatAPI.sendLLMEvent({
        type: 'thinking',
        thinking: content,
        metadata: {
          provider: 'llm',
          timestamp: new Date().toISOString(),
          blockEnd: true,
          durationMs
        }
      });
      
      this.thinkingStartTime = undefined;
    } else {
      if (content) {
        await this.chatAPI.sendLLMEvent({
          type: 'thinking',
          thinking: content,
          metadata: {
            provider: 'llm',
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  }
  
  /**
   * Render text response
   */
  async renderResponse(action: ParsedAction): Promise<void> {
    const content = action.data.content;
    
    // Filter out empty/whitespace-only content
    if (!content || !content.trim()) {
      return;
    }
    
    if (content.replace(/[\s\n\r]/g, '').length === 0) {
      return;
    }
    
    // Filter out XML markdown code block tags
    const trimmed = content.trim();
    if (trimmed === '```xml' || trimmed === '```') {
      return;
    }
    
    // Transform special tags
    const transformed = this.tagTransformer.transform(content);
    
    if (transformed.consumed) {
      if (transformed.text) {
        await this.chatAPI.sendLLMEvent({
          type: 'text',
          text: transformed.text
        });
      }
      return;
    }
    
    await this.chatAPI.sendLLMEvent({
      type: 'text',
      text: transformed.text || content
    });
  }
}


