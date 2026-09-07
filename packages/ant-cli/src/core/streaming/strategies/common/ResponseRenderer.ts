/**
 * ResponseRenderer - Handle thinking and text response rendering
 */

import { ChatAPIClient } from '../../../adapters/ChatAPIClient';
import { SpecialTagTransformer } from '../../transformers/SpecialTagTransformer';
import { SuppressedTagStreamGate } from '../../transformers/SuppressedTagStreamGate';
import { ParsedAction } from '../../types';
import { stripRegisteredTags } from '../../OutputTagRegistry';

export class ResponseRenderer {
  private chatAPI: ChatAPIClient;
  private tagTransformer: SpecialTagTransformer;
  private thinkingStartTime?: number;
  /**
   * Chunk-boundary hold-back for `consumed-suppressed` tags. The
   * transformer below only suppresses a tag complete within one chunk;
   * this withholds a split one so no raw marker reaches the live delta
   * or the TURN_BUFFER. See `SuppressedTagStreamGate`.
   */
  private readonly suppressionGate = new SuppressedTagStreamGate();
  
  constructor(chatAPI: ChatAPIClient, tagTransformer: SpecialTagTransformer) {
    this.chatAPI = chatAPI;
    this.tagTransformer = tagTransformer;
  }
  
  /**
   * Render thinking output.
   *
   * Strips any complete canonical tag (`<reply>...</reply>` etc.) from
   * the chunk before forwarding so a thinking-stream that mentions an
   * intent tag does not surface raw `<…>` markers in the reasoning
   * panel. Per-chunk strip is best-effort — a tag split across chunks
   * may still slip through, but the thinking surface is a folded
   * reasoning view where occasional pass-through is benign.
   */
  async renderThinking(action: ParsedAction): Promise<void> {
    const rawContent = action.data.content || '';
    const content = rawContent ? stripRegisteredTags(rawContent) : rawContent;
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
    
    // Withhold suppressed-tag text that straddles chunk boundaries. The
    // transformer below is single-shot per chunk and would let a split
    // `<checklist>` through as raw text.
    const gated = this.suppressionGate.feed(content);
    if (!gated) {
      return;
    }

    // Transform special tags
    const transformed = this.tagTransformer.transform(gated);
    
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
      text: transformed.text || gated
    });
  }

  /**
   * Release any text the suppression gate still withholds at the end of
   * a stream round. An unterminated suppressed tag degrades to
   * marker-stripped prose rather than losing the round's answer.
   */
  async flushSuppressionGate(): Promise<void> {
    const pending = this.suppressionGate.flush();
    if (!pending.trim()) return;

    const transformed = this.tagTransformer.transform(pending);
    if (transformed.consumed && !transformed.text) return;

    await this.chatAPI.sendLLMEvent({
      type: 'text',
      text: transformed.text || pending
    });
  }

  /** Drop withheld gate state (stream retry — the residue is dead). */
  resetSuppressionGate(): void {
    this.suppressionGate.reset();
  }
}


