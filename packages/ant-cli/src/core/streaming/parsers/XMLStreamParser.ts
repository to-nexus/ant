/**
 * XML-based streaming parser for Anthropic/Cursor-style format
 * 
 * Supports incremental parsing of:
 * - <thinking>...</thinking>
 * - <file path="...">...</file>
 * - <edit path="..."><search>...</search><replace>...</replace></edit>
 * - <delete path="..." />
 */

import { IStreamParser } from './IStreamParser';
import { LLMStreamEvent, ParsedAction } from '../types';
import { StreamState } from '../state/StreamState';

interface ParserContext {
  insideThinking: boolean;
  insideFile: boolean;
  insideEdit: boolean;
  insideSearch: boolean;
  insideReplace: boolean;
  insideTasks: boolean; // For <tasks> JSON data (not displayed in UI)
  currentFilePath: string | null;
  currentEditPath: string | null;
}

export class XMLStreamParser implements IStreamParser {
  private context: ParserContext = {
    insideThinking: false,
    insideFile: false,
    insideEdit: false,
    insideSearch: false,
    insideReplace: false,
    insideTasks: false,
    currentFilePath: null,
    currentEditPath: null
  };
  
  private buffer: string = '';
  
  parse(event: LLMStreamEvent, state: StreamState): ParsedAction[] {
    const actions: ParsedAction[] = [];
    
    // Handle thinking events (some LLM APIs send this separately)
    if (event.type === 'thinking' && event.content) {
      actions.push({
        type: 'thinking',
        data: { content: event.content }
      });
      return actions;
    }
    
    if (event.type !== 'text' || !event.content) {
      return actions;
    }
    
    // Append to both state and parser buffer
    state.append(event.content);
    this.buffer += event.content;
    
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
        
        // ✅ Just emit remaining content (if any)
        if (thinkingContent.trim()) {
          actions.push({
            type: 'thinking',
            data: { content: thinkingContent }
          });
        }
        
        continueParsingLoop = true;
        continue;
      }
      
      // 3. Accumulate thinking content
      if (this.context.insideThinking && this.buffer.length > 0) {
        // Stream thinking content incrementally
        const content = this.buffer;
        this.buffer = '';
        actions.push({
          type: 'thinking',
          data: { content }
        });
        continue;
      }
      
      // 4. Check for <tasks> opening (suppress output - internal use only)
      if (!this.context.insideTasks && this.buffer.includes('<tasks>')) {
        const startIdx = this.buffer.indexOf('<tasks>');
        // Emit any text before <tasks> as response
        const beforeTasks = this.buffer.substring(0, startIdx);
        if (beforeTasks.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTasks }
          });
        }
        this.buffer = this.buffer.substring(startIdx + '<tasks>'.length);
        this.context.insideTasks = true;
        continueParsingLoop = true;
        continue;
      }
      
      // 5. Check for </tasks> closing (skip content - not displayed)
      if (this.context.insideTasks && this.buffer.includes('</tasks>')) {
        const endIdx = this.buffer.indexOf('</tasks>');
        // Discard tasks content (not displayed in UI)
        this.buffer = this.buffer.substring(endIdx + '</tasks>'.length);
        this.context.insideTasks = false;
        continueParsingLoop = true;
        continue;
      }
      
      // 6. Discard content inside <tasks> (not displayed)
      if (this.context.insideTasks && this.buffer.length > 0) {
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
      
      // 9. Accumulate file content
      if (this.context.insideFile && this.buffer.length > 0) {
        // Stream file content incrementally (but keep small buffer for tag detection)
        const lookahead = '</file>';
        if (this.buffer.length > lookahead.length) {
          const safeContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
          this.buffer = this.buffer.substring(safeContent.length);
          
          if (safeContent.length > 0) {
            actions.push({
              type: 'file_content',
              data: {
                filePath: this.context.currentFilePath!,
                content: safeContent
              }
            });
          }
        }
        continue;
      }
      
      // 10. Check for <edit path="..."> opening
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
      
      // 14. If not inside any block and buffer is just whitespace/text, treat as response
      if (!this.context.insideThinking && 
          !this.context.insideTasks &&
          !this.context.insideFile && 
          !this.context.insideEdit) {
        
        // Check if buffer contains start of a tag (don't emit yet)
        const hasPartialTag = this.buffer.match(/<(thinking|tasks|file|edit|delete)?$/);
        if (hasPartialTag) {
          // Keep buffer, wait for more tokens
          break;
        }
        
        // Check if there's a complete line or significant content
        if (this.buffer.length > 0) {
          // Check if there's an upcoming XML tag
          const nextTagMatch = this.buffer.match(/^(.*?)(?=<(?:thinking|tasks|file|edit|delete))/s);
          if (nextTagMatch) {
            const content = nextTagMatch[1];
            this.buffer = this.buffer.substring(content.length);
            if (content.trim()) {
              actions.push({
                type: 'response',
                data: { content }
              });
            }
            continueParsingLoop = true;
            continue;
          }
          
          // ✅ REAL-TIME FLUSH: Emit on newline (Cursor/Copilot style)
          const newlineIndex = this.buffer.indexOf('\n');
          if (newlineIndex !== -1) {
            // Emit everything up to and including the newline
            const content = this.buffer.substring(0, newlineIndex + 1);
            this.buffer = this.buffer.substring(newlineIndex + 1);
            // Always emit - formatting (newlines) matters!
            actions.push({
              type: 'response',
              data: { content }
            });
            continueParsingLoop = true;
            continue;
          }
          
          // ✅ FALLBACK: If buffer grows too large without newline, emit anyway
          if (this.buffer.length > 200) {
            const content = this.buffer;
            this.buffer = '';
            actions.push({
              type: 'response',
              data: { content }
            });
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
      // If inside thinking, emit as thinking
      if (this.context.insideThinking) {
        actions.push({
          type: 'thinking',
          data: { content: this.buffer }
        });
      }
      // If inside file, emit as file content
      else if (this.context.insideFile && this.context.currentFilePath) {
        actions.push({
          type: 'file_content',
          data: {
            filePath: this.context.currentFilePath,
            content: this.buffer
          }
        });
      }
      // Otherwise, emit as response
      else if (!this.context.insideTasks) {
        // Don't emit if inside <tasks> (should be hidden)
        // ✅ Emit even if only whitespace - formatting matters!
        actions.push({
          type: 'response',
          data: { content: this.buffer }
        });
      }
      
      this.buffer = '';
    }
    
    return actions;
  }
  
  reset(): void {
    this.context = {
      insideThinking: false,
      insideFile: false,
      insideEdit: false,
      insideSearch: false,
      insideReplace: false,
      insideTasks: false,
      currentFilePath: null,
      currentEditPath: null
    };
    this.buffer = '';
  }
}

