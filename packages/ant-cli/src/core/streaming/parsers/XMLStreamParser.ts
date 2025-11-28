/**
 * XML-based streaming parser for Anthropic/Cursor-style format
 * 
 * Supports incremental parsing of:
 * - <thinking>...</thinking>
 * - <file path="...">...</file>
 * - <append path="...">...</append>
 * - <edit path="..."><search>...</search><replace>...</replace></edit>
 * - <delete path="..." />
 */

import { IStreamParser } from './IStreamParser';
import { LLMStreamEvent } from '../../ports/llm';
import { ParsedAction } from '../types';
import { StreamState } from '../state/StreamState';

interface ParserContext {
  insideThinking: boolean;
  insideFile: boolean;
  insideAppend: boolean;  // ✅ NEW: <append> tag
  insideEdit: boolean;
  insideSearch: boolean;
  insideReplace: boolean;
  insideTasks: boolean; // ✅ Changed: Now used to track but will emit to response
  insideLearnCommand: boolean;  // ✅ NEW: <learn_command> tag
  learnCommandContent: string;  // ✅ NEW: Accumulate learn_command content
  currentFilePath: string | null;
  currentAppendPath: string | null;  // ✅ NEW
  currentEditPath: string | null;
}

export class XMLStreamParser implements IStreamParser {
  private context: ParserContext = {
    insideThinking: false,
    insideFile: false,
    insideAppend: false,  // ✅ NEW
    insideEdit: false,
    insideSearch: false,
    insideReplace: false,
    insideTasks: false,
    insideLearnCommand: false,  // ✅ NEW
    learnCommandContent: '',  // ✅ NEW
    currentFilePath: null,
    currentAppendPath: null,  // ✅ NEW
    currentEditPath: null
  };
  
  private buffer: string = '';
  
  parse(event: LLMStreamEvent, state: StreamState): ParsedAction[] {
    const actions: ParsedAction[] = [];
    
    // Handle thinking events (some LLM APIs send this separately)
    if (event.type === 'thinking') {  // ✅ 빈 thinking도 처리 (blockEnd 시 빈 문자열 가능)
      actions.push({
        type: 'thinking',
        data: { 
          content: event.thinking || '',
          blockStart: event.metadata?.blockStart,  // ✅ 메타데이터 전달
          blockEnd: event.metadata?.blockEnd,      // ✅ 메타데이터 전달
          durationMs: event.metadata?.durationMs   // ✅ duration 전달 (AnthropicLLM이 계산)
        }
      });
      return actions;
    }
    
    if (event.type !== 'text' || !event.text) {  // ✅ NEW: text 필드 사용
      return actions;
    }
    
    // Append to both state and parser buffer
    state.append(event.text);
    this.buffer += event.text;
    
    // Incremental parsing: try to extract complete tags
    actions.push(...this.parseBuffer());
    
    return actions;
  }
  
  private parseBuffer(): ParsedAction[] {
    const actions: ParsedAction[] = [];
    
    // Try to parse all recognizable patterns
    let continueParsingLoop = true;
    
    while (continueParsingLoop) {
      continueParsingLoop = false;
      
      // 1. Check for <thinking> opening
      if (!this.context.insideThinking && this.buffer.includes('<thinking>')) {
        const startIdx = this.buffer.indexOf('<thinking>');
        const consumed = this.buffer.substring(0, startIdx + '<thinking>'.length);
        this.buffer = this.buffer.substring(startIdx + '<thinking>'.length);
        this.context.insideThinking = true;
        
        // ✅ Emit explicit "new block start" signal
        actions.push({
          type: 'thinking',
          data: { 
            content: '',  // Empty content
            blockStart: true  // ✅ New thinking block starts here
          }
        });
        
        continueParsingLoop = true;
        continue;
      }
      
      // 2. Check for </thinking> closing
      if (this.context.insideThinking && this.buffer.includes('</thinking>')) {
        const endIdx = this.buffer.indexOf('</thinking>');
        const thinkingContent = this.buffer.substring(0, endIdx);
        this.buffer = this.buffer.substring(endIdx + '</thinking>'.length);
        this.context.insideThinking = false;
        
        // ✅ Emit remaining content with blockEnd flag (for timing)
        if (thinkingContent.trim()) {
          actions.push({
            type: 'thinking',
            data: { content: thinkingContent, blockEnd: true }  // ✅ Signal end
          });
        } else {
          // Empty content but still signal end
          actions.push({
            type: 'thinking',
            data: { content: '', blockEnd: true }
          });
        }
        
        continueParsingLoop = true;
        continue;
      }
      
      // 3. Check for <tasks> inside thinking (still suppress in thinking blocks)
      if (this.context.insideThinking && !this.context.insideTasks && this.buffer.includes('<tasks>')) {
        const startIdx = this.buffer.indexOf('<tasks>');
        
        // Emit thinking content before <tasks>
        const thinkingBeforeTasks = this.buffer.substring(0, startIdx);
        if (thinkingBeforeTasks.trim()) {
          actions.push({
            type: 'thinking',
            data: { content: thinkingBeforeTasks }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<tasks>'.length);
        this.context.insideTasks = true;
        // ✅ Still suppress inside thinking (internal planning)
        
        continueParsingLoop = true;
        continue;
      }
      
      // 4. Accumulate thinking content (emit every token for real-time streaming)
      if (this.context.insideThinking && !this.context.insideTasks && this.buffer.length > 0) {
        const content = this.buffer;
        this.buffer = '';
        actions.push({
          type: 'thinking',
          data: { content }
        });
        continue;
      }
      
      // 6. Check for </tasks> closing inside thinking (suppress)
      if (this.context.insideThinking && this.context.insideTasks && this.buffer.includes('</tasks>')) {
        const endIdx = this.buffer.indexOf('</tasks>');
        this.buffer = this.buffer.substring(endIdx + '</tasks>'.length);
        this.context.insideTasks = false;
        // ✅ Suppress inside thinking
        
        continueParsingLoop = true;
        continue;
      }
      
      // 7. Accumulate content inside <tasks> in thinking (suppress)
      if (this.context.insideThinking && this.context.insideTasks && this.buffer.length > 0) {
        this.buffer = '';  // Suppress
        continue;
      }
      
      // 8. Check for <learn_command> opening (outside thinking)
      if (!this.context.insideThinking && !this.context.insideLearnCommand && this.buffer.includes('<learn_command>')) {
        const startIdx = this.buffer.indexOf('<learn_command>');
        
        // Emit any text before <learn_command> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<learn_command>'.length);
        this.context.insideLearnCommand = true;
        this.context.learnCommandContent = '';  // Reset accumulator
        
        continueParsingLoop = true;
        continue;
      }
      
      // 9. Check for </learn_command> closing
      if (this.context.insideLearnCommand && this.buffer.includes('</learn_command>')) {
        const endIdx = this.buffer.indexOf('</learn_command>');
        const fragment = this.buffer.substring(0, endIdx);
        this.context.learnCommandContent += fragment;
        
        this.buffer = this.buffer.substring(endIdx + '</learn_command>'.length);
        this.context.insideLearnCommand = false;
        
        // ✅ Emit complete learn_command as ONE response chunk
        const fullContent = `<learn_command>${this.context.learnCommandContent}</learn_command>`;
        actions.push({
          type: 'response',
          data: { content: fullContent }
        });
        
        this.context.learnCommandContent = '';  // Reset
        
        continueParsingLoop = true;
        continue;
      }
      
      // 10. Accumulate content inside <learn_command>
      if (this.context.insideLearnCommand && this.buffer.length > 0) {
        this.context.learnCommandContent += this.buffer;
        this.buffer = '';
        continue;
      }
      
      // 7. Check for <file path="..."> opening
      if (!this.context.insideFile) {
        const fileMatch = this.buffer.match(/<file\s+path="([^"]+)">/);
        if (fileMatch) {
          const fullMatch = fileMatch[0];
          const filePath = fileMatch[1];
          const startIdx = this.buffer.indexOf(fullMatch);
          
          this.buffer = this.buffer.substring(startIdx + fullMatch.length);
          this.context.insideFile = true;
          this.context.currentFilePath = filePath;
          
          actions.push({
            type: 'file_start',
            data: {
              filePath,
              actionType: 'create'  // Registry will determine if it should be 'edit'
            }
          });
          continueParsingLoop = true;
          continue;
        }
      }
      
      // 8. Check for </file> closing
      if (this.context.insideFile && this.buffer.includes('</file>')) {
        const endIdx = this.buffer.indexOf('</file>');
        const fileContent = this.buffer.substring(0, endIdx);
        this.buffer = this.buffer.substring(endIdx + '</file>'.length);
        
        // Emit remaining content
        if (fileContent.length > 0) {
          actions.push({
            type: 'file_content',
            data: {
              filePath: this.context.currentFilePath!,
              content: fileContent
            }
          });
        }
        
        actions.push({
          type: 'file_end',
          data: { filePath: this.context.currentFilePath! }
        });
        
        this.context.insideFile = false;
        this.context.currentFilePath = null;
        continueParsingLoop = true;
        continue;
      }
      
      // 9. Accumulate file content (LINE-BASED STREAMING for real-time rendering)
      if (this.context.insideFile && this.buffer.length > 0) {
        const lookahead = '</file>';
        
        // ✅ AGGRESSIVE STREAMING: Emit complete lines immediately
        // Only keep incomplete last line + lookahead in buffer
        if (this.buffer.length > lookahead.length) {
          const searchableContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
          
          // Find last complete line (ending with \n)
          const lastNewlineIdx = searchableContent.lastIndexOf('\n');
          
          if (lastNewlineIdx >= 0) {
            // Emit all complete lines (including the trailing \n)
            const completeLines = searchableContent.substring(0, lastNewlineIdx + 1);
            this.buffer = this.buffer.substring(completeLines.length);
            
            actions.push({
              type: 'file_content',
              data: {
                filePath: this.context.currentFilePath!,
                content: completeLines
              }
            });
            continueParsingLoop = true;  // ✅ Re-check for more lines
          }
        }
        continue;
      }
      
      // 10. Check for <append path="..."> opening
      if (!this.context.insideAppend) {
        const appendMatch = this.buffer.match(/<append\s+path="([^"]+)">/);
        if (appendMatch) {
          const fullMatch = appendMatch[0];
          const filePath = appendMatch[1];
          const startIdx = this.buffer.indexOf(fullMatch);
          
          this.buffer = this.buffer.substring(startIdx + fullMatch.length);
          this.context.insideAppend = true;
          this.context.currentAppendPath = filePath;
          
          actions.push({
            type: 'file_start',
            data: {
              filePath,
              actionType: 'append'
            }
          });
          continueParsingLoop = true;
          continue;
        }
      }
      
      // 11. Check for </append> closing
      if (this.context.insideAppend && this.buffer.includes('</append>')) {
        const endIdx = this.buffer.indexOf('</append>');
        const appendContent = this.buffer.substring(0, endIdx);
        this.buffer = this.buffer.substring(endIdx + '</append>'.length);
        
        // Emit remaining content
        if (appendContent.length > 0) {
          actions.push({
            type: 'file_content',
            data: {
              filePath: this.context.currentAppendPath!,
              content: appendContent
            }
          });
        }
        
        actions.push({
          type: 'file_end',
          data: { filePath: this.context.currentAppendPath! }
        });
        
        this.context.insideAppend = false;
        this.context.currentAppendPath = null;
        continueParsingLoop = true;
        continue;
      }
      
      // 12. Accumulate append content (LINE-BASED STREAMING for real-time rendering)
      if (this.context.insideAppend && this.buffer.length > 0) {
        const lookahead = '</append>';
        
        // ✅ AGGRESSIVE STREAMING: Emit complete lines immediately
        // Only keep incomplete last line + lookahead in buffer
        if (this.buffer.length > lookahead.length) {
          const searchableContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
          
          // Find last complete line (ending with \n)
          const lastNewlineIdx = searchableContent.lastIndexOf('\n');
          
          if (lastNewlineIdx >= 0) {
            // Emit all complete lines (including the trailing \n)
            const completeLines = searchableContent.substring(0, lastNewlineIdx + 1);
            this.buffer = this.buffer.substring(completeLines.length);
            
            actions.push({
              type: 'file_content',
              data: {
                filePath: this.context.currentAppendPath!,
                content: completeLines
              }
            });
            continueParsingLoop = true;  // ✅ Re-check for more lines
          }
        }
        continue;
      }
      
      // 13. Check for <edit path="..."> opening
      if (!this.context.insideEdit) {
        const editMatch = this.buffer.match(/<edit\s+path="([^"]+)">/);
        if (editMatch) {
          const fullMatch = editMatch[0];
          const filePath = editMatch[1];
          const startIdx = this.buffer.indexOf(fullMatch);
          
          this.buffer = this.buffer.substring(startIdx + fullMatch.length);
          this.context.insideEdit = true;
          this.context.currentEditPath = filePath;
          
          actions.push({
            type: 'file_start',
            data: {
              filePath,
              actionType: 'edit'
            }
          });
          continueParsingLoop = true;
          continue;
        }
      }
      
      // 11. Inside <edit>, check for <search> and <replace>
      if (this.context.insideEdit) {
        // <search> opening
        if (!this.context.insideSearch && this.buffer.includes('<search>')) {
          const startIdx = this.buffer.indexOf('<search>');
          this.buffer = this.buffer.substring(startIdx + '<search>'.length);
          this.context.insideSearch = true;
          continueParsingLoop = true;
          continue;
        }
        
        // </search> closing
        if (this.context.insideSearch && this.buffer.includes('</search>')) {
          const endIdx = this.buffer.indexOf('</search>');
          const searchContent = this.buffer.substring(0, endIdx);
          this.buffer = this.buffer.substring(endIdx + '</search>'.length);
          this.context.insideSearch = false;
          
          // Store search content (will be combined with replace later)
          actions.push({
            type: 'file_content',
            data: {
              filePath: this.context.currentEditPath!,
              content: searchContent,
              metadata: { section: 'search' }
            }
          });
          continueParsingLoop = true;
          continue;
        }
        
        // <replace> opening
        if (!this.context.insideReplace && this.buffer.includes('<replace>')) {
          const startIdx = this.buffer.indexOf('<replace>');
          this.buffer = this.buffer.substring(startIdx + '<replace>'.length);
          this.context.insideReplace = true;
          continueParsingLoop = true;
          continue;
        }
        
        // </replace> closing
        if (this.context.insideReplace && this.buffer.includes('</replace>')) {
          const endIdx = this.buffer.indexOf('</replace>');
          const replaceContent = this.buffer.substring(0, endIdx);
          this.buffer = this.buffer.substring(endIdx + '</replace>'.length);
          this.context.insideReplace = false;
          
          // Store replace content
          actions.push({
            type: 'file_content',
            data: {
              filePath: this.context.currentEditPath!,
              content: replaceContent,
              metadata: { section: 'replace' }
            }
          });
          continueParsingLoop = true;
          continue;
        }
      }
      
      // 12. Check for </edit> closing
      if (this.context.insideEdit && this.buffer.includes('</edit>')) {
        const endIdx = this.buffer.indexOf('</edit>');
        this.buffer = this.buffer.substring(endIdx + '</edit>'.length);
        
        actions.push({
          type: 'file_end',
          data: { filePath: this.context.currentEditPath! }
        });
        
        this.context.insideEdit = false;
        this.context.currentEditPath = null;
        continueParsingLoop = true;
        continue;
      }
      
      // 13. Check for <delete path="..." /> (self-closing)
      const deleteMatch = this.buffer.match(/<delete\s+path="([^"]+)"\s*\/>/);
      if (deleteMatch) {
        const fullMatch = deleteMatch[0];
        const filePath = deleteMatch[1];
        const startIdx = this.buffer.indexOf(fullMatch);
        
        this.buffer = this.buffer.substring(startIdx + fullMatch.length);
        
        actions.push({
          type: 'file_start',
          data: { filePath, actionType: 'delete' }
        });
        actions.push({
          type: 'file_end',
          data: { filePath }
        });
        
        continueParsingLoop = true;
        continue;
      }
      
      // 14. General text response handling (outside any XML block)
      if (!this.context.insideThinking && 
          !this.context.insideTasks &&
          !this.context.insideLearnCommand &&  // ✅ NEW
          !this.context.insideFile && 
          !this.context.insideEdit) {
        
        if (this.buffer.length > 0) {
          // 🎯 STRATEGY: Only emit text when it's SAFE (won't break XML tag parsing)
          
          // 1️⃣ HIGHEST PRIORITY: Check if there's text BEFORE an XML tag
          // Example: "Here is the code:\n<file path=..." → emit "Here is the code:\n"
          const beforeTagMatch = this.buffer.match(/^(.+?)(?=<(?:thinking|tasks|file|edit|delete|append|learn_command|done)[\s>])/s);
          if (beforeTagMatch) {
            const content = beforeTagMatch[1];
            this.buffer = this.buffer.substring(content.length);
            
            // ✅ CRITICAL: Only emit if content has actual text (not just whitespace/newlines)
            const hasActualContent = content.trim().length > 0 || content.includes('\n');
            const isNotOnlyWhitespace = content.replace(/[\s\n\r]/g, '').length > 0;
            
            if (hasActualContent && isNotOnlyWhitespace) {
              actions.push({
                type: 'response',
                data: { content }
              });
            } else {
              console.log(`[XMLParser] 🚫 Skipping whitespace-only content before tag: ${JSON.stringify(content.substring(0, 50))}`);
            }
            continueParsingLoop = true;
            continue;
          }
          
          // 2️⃣ Check if buffer might contain an INCOMPLETE XML tag
          // Wait for completion if we detect potential tag start
          const hasPotentialTagStart = 
            this.buffer.match(/<[a-z]*$/i);  // Ends with incomplete tag like "<", "<f", "<fil"
          
          if (hasPotentialTagStart) {
            // Wait for more tokens to complete the tag
            // BUT: Don't wait forever - if buffer is too large, give up and emit
            if (this.buffer.length < 500) {
              break;  // Wait for more tokens
            }
          }
          
          // 3️⃣ SAFE EMIT: Emit up to last newline (preserve incomplete lines for XML detection)
          const lastNewline = this.buffer.lastIndexOf('\n');
          if (lastNewline !== -1 && lastNewline < this.buffer.length - 1) {
            // Emit everything up to and including the last newline
            const content = this.buffer.substring(0, lastNewline + 1);
            this.buffer = this.buffer.substring(lastNewline + 1);
            
            // ✅ CRITICAL: Only emit if content has actual visible text
            if (content.replace(/[\s\n\r]/g, '').length > 0) {
              actions.push({
                type: 'response',
                data: { content }
              });
            } else {
              console.log(`[XMLParser] 🚫 Skipping whitespace-only line content`);
            }
            continueParsingLoop = true;
            continue;
          }
          
          // 4️⃣ FALLBACK: If buffer is getting large without newlines, emit it
          // (This handles cases where LLM sends long text without line breaks)
          if (this.buffer.length > 200 && !hasPotentialTagStart) {
            const content = this.buffer;
            this.buffer = '';
            
            // ✅ CRITICAL: Only emit if content has actual visible text
            if (content.replace(/[\s\n\r]/g, '').length > 0) {
              actions.push({
                type: 'response',
                data: { content }
              });
            } else {
              console.log(`[XMLParser] 🚫 Skipping whitespace-only large buffer`);
            }
            continueParsingLoop = true;
            continue;
          }
        }
      }
    }
    
    return actions;
  }
  
  finalize(): ParsedAction[] {
    const actions: ParsedAction[] = [];
    
    // ✅ CRITICAL: Flush any remaining buffer content
    if (this.buffer.length > 0) {
      console.log(`[XMLStreamParser] 🔚 Flushing ${this.buffer.length} chars: "${this.buffer.substring(0, 50)}..."`);
    }
    
    if (this.buffer.length > 0) {
      // ✅ Check if buffer has actual content (not just whitespace)
      const hasActualContent = this.buffer.replace(/[\s\n\r]/g, '').length > 0;
      
      // If inside thinking, emit as thinking
      if (this.context.insideThinking) {
        if (hasActualContent) {
          actions.push({
            type: 'thinking',
            data: { content: this.buffer }
          });
        } else {
          console.log(`[XMLParser] 🚫 Skipping whitespace-only thinking in finalize`);
        }
      }
      // If inside file, emit as file content
      else if (this.context.insideFile && this.context.currentFilePath) {
        // ✅ File content: Always emit (even whitespace, as it may be meaningful)
        actions.push({
          type: 'file_content',
          data: {
            filePath: this.context.currentFilePath,
            content: this.buffer
          }
        });
      }
      // Otherwise, emit as response (ONLY if has actual content)
      else if (!this.context.insideTasks && hasActualContent) {
        // Don't emit if inside <tasks> (should be hidden)
        actions.push({
          type: 'response',
          data: { content: this.buffer }
        });
      } else if (!this.context.insideTasks && !hasActualContent) {
        console.log(`[XMLParser] 🚫 Skipping whitespace-only response in finalize`);
      }
      
      this.buffer = '';
    }
    
    return actions;
  }
  
  reset(): void {
    this.context = {
      insideThinking: false,
      insideFile: false,
      insideAppend: false,
      insideEdit: false,
      insideSearch: false,
      insideReplace: false,
      insideTasks: false,
      insideLearnCommand: false,  // ✅ NEW
      learnCommandContent: '',  // ✅ NEW
      currentFilePath: null,
      currentAppendPath: null,
      currentEditPath: null
    };
    this.buffer = '';
  }
}

