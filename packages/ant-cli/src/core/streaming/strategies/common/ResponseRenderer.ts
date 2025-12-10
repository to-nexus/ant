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
      console.log(`[Render] 🚫 Skipping empty response content`);
      return;
    }
    
    if (content.replace(/[\s\n\r]/g, '').length === 0) {
      console.log(`[Render] 🚫 Skipping whitespace-only response: ${JSON.stringify(content)}`);
      return;
    }
    
    // Filter out XML markdown code block tags
    const trimmed = content.trim();
    if (trimmed === '```xml' || trimmed === '```') {
      console.log(`[Render] 🚫 Skipping XML markdown block tag: ${JSON.stringify(content)}`);
      return;
    }
    
    // Transform special tags
    const transformed = this.tagTransformer.transform(content);
    
    // Debug logging for special tags
    if (content.includes('<detect>')) {
      console.log(`🐛 [Render] DETECT TAG FOUND in chunk (${content.length} chars)`);
      console.log(`🐛 [Render] transformed.consumed: ${transformed.consumed}`);
      console.log(`🐛 [Render] transformed.text length: ${transformed.text?.length || 0}`);
    }
    
    if (content.includes('<references>')) {
      console.log(`🐛 [Render] REFERENCES TAG FOUND in chunk (${content.length} chars)`);
      console.log(`🐛 [Render] Content preview: ${content.substring(0, 200)}`);
      console.log(`🐛 [Render] transformed.consumed: ${transformed.consumed}`);
      console.log(`🐛 [Render] transformed.text: ${transformed.text?.substring(0, 200) || '(none)'}`);
    }
    
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
