/**
 * XML-based streaming parser for Anthropic/Cursor-style format
 * 
 * Supports incremental parsing of:
 * - <thinking>...</thinking>
 * - <file path="...">...</file>
 * - <append path="...">...</append>
 */

import { IStreamParser } from './IStreamParser';
import { LLMStreamEvent } from '../../ports/llm';
import { ParsedAction } from '../types';
import { StreamState } from '../state/StreamState';

interface ParserContext {
  insideThinking: boolean;
  insideFile: boolean;
  insideAppend: boolean;  // ✅ NEW: <append> tag
  insideTasks: boolean; // ✅ Changed: Now used to track but will emit to response
  insideLearnCommand: boolean;  // ✅ NEW: <learn_command> tag
  learnCommandContent: string;  // ✅ NEW: Accumulate learn_command content
  tasksContent: string;  // ✅ NEW: Accumulate tasks content
  insideReferences: boolean;  // ✅ NEW: <references> tag
  referencesContent: string;  // ✅ NEW: Accumulate references content
  insideProfile: boolean;  // ✅ NEW: <profile> tag (decompose node — suppress from chat)
  insideClarify: boolean;  // ✅ NEW: <clarify> tag (planner mode — suppress from chat)
  clarifyContent: string;  // ✅ NEW: Accumulate clarify content (discarded)
  clarifyStartEmitted: boolean;  // ✅ Track if clarify_start action was already emitted
  insideFunctionCalls: boolean;  // ✅ SAFETY: <function_calls> tag (suppress hallucinated XML tool calls)
  insideAnalysis: boolean;  // <analysis> tag (plan node — strip tags, stream content as response)
  insidePlan: boolean;  // <plan> tag (plan node — emit plan_start/plan_content/plan_end)
  currentFilePath: string | null;
  currentAppendPath: string | null;  // ✅ NEW
}

export class XMLStreamParser implements IStreamParser {
  private context: ParserContext = {
    insideThinking: false,
    insideFile: false,
    insideAppend: false,  // ✅ NEW
    insideTasks: false,
    insideLearnCommand: false,  // ✅ NEW
    learnCommandContent: '',  // ✅ NEW
    tasksContent: '',  // ✅ NEW
    insideReferences: false,  // ✅ NEW
    referencesContent: '',  // ✅ NEW
    insideProfile: false,  // ✅ NEW
    insideClarify: false,  // ✅ NEW
    clarifyContent: '',  // ✅ NEW
    clarifyStartEmitted: false,  // ✅ NEW
    insideFunctionCalls: false,  // ✅ SAFETY
    insideAnalysis: false,
    insidePlan: false,
    currentFilePath: null,
    currentAppendPath: null,  // ✅ NEW
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
      
      // 11. Check for <tasks> opening (outside thinking)
      if (!this.context.insideThinking && !this.context.insideTasks && this.buffer.includes('<tasks>')) {
        const startIdx = this.buffer.indexOf('<tasks>');
        
        // Emit any text before <tasks> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<tasks>'.length);
        this.context.insideTasks = true;
        this.context.tasksContent = '';  // Reset accumulator
        
        continueParsingLoop = true;
        continue;
      }
      
      // 12. Check for </tasks> closing (outside thinking)
      if (!this.context.insideThinking && this.context.insideTasks && this.buffer.includes('</tasks>')) {
        const endIdx = this.buffer.indexOf('</tasks>');
        const fragment = this.buffer.substring(0, endIdx);
        this.context.tasksContent += fragment;
        
        this.buffer = this.buffer.substring(endIdx + '</tasks>'.length);
        this.context.insideTasks = false;
        
        // ✅ SKIP: Do NOT emit <tasks> to UI (used only for backend parsing)
        this.context.tasksContent = '';  // Reset
        
        continueParsingLoop = true;
        continue;
      }
      
      // 13. Accumulate content inside <tasks> (outside thinking)
      if (!this.context.insideThinking && this.context.insideTasks && this.buffer.length > 0) {
        this.context.tasksContent += this.buffer;
        this.buffer = '';
        continue;
      }
      
      // 14. Check for <references> opening
      if (!this.context.insideReferences && this.buffer.includes('<references>')) {
        const startIdx = this.buffer.indexOf('<references>');
        
        // Emit any text before <references> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<references>'.length);
        this.context.insideReferences = true;
        this.context.referencesContent = '';  // Reset accumulator
        
        continueParsingLoop = true;
        continue;
      }
      
      // 15. Check for </references> closing
      if (this.context.insideReferences && this.buffer.includes('</references>')) {
        const endIdx = this.buffer.indexOf('</references>');
        const fragment = this.buffer.substring(0, endIdx);
        this.context.referencesContent += fragment;
        
        this.buffer = this.buffer.substring(endIdx + '</references>'.length);
        this.context.insideReferences = false;
        
        // ✅ Emit complete references as ONE response chunk (for SpecialTagTransformer)
        const fullContent = `<references>${this.context.referencesContent}</references>`;
        
        actions.push({
          type: 'response',
          data: { content: fullContent }
        });
        
        this.context.referencesContent = '';  // Reset
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16. Accumulate content inside <references>
      if (this.context.insideReferences && this.buffer.length > 0) {
        this.context.referencesContent += this.buffer;
        this.buffer = '';
        continue;
      }
      
      // 16aa. Check for <profile> opening (suppress from chat — parsed post-stream by responseParser)
      if (!this.context.insideProfile && this.buffer.includes('<profile>')) {
        const startIdx = this.buffer.indexOf('<profile>');
        
        // Emit any text before <profile> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<profile>'.length);
        this.context.insideProfile = true;
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16ab. Check for </profile> closing (discard content)
      if (this.context.insideProfile && this.buffer.includes('</profile>')) {
        const endIdx = this.buffer.indexOf('</profile>');
        
        this.buffer = this.buffer.substring(endIdx + '</profile>'.length);
        this.context.insideProfile = false;
        
        // ✅ DISCARD: <profile> content suppressed from chat UI.
        // decompose/index.ts displays formatted profile via formatDetectionReportForChat().
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16ac. Accumulate content inside <profile> (suppress)
      if (this.context.insideProfile && this.buffer.length > 0) {
        this.buffer = '';  // Suppress
        continue;
      }
      
      // 16b. Check for <clarify ...> opening (suppress from chat — post-hoc parsed by generate.ts)
      if (!this.context.insideClarify && this.buffer.match(/<clarify[\s]/)) {
        const startIdx = this.buffer.search(/<clarify[\s]/);
        
        // Emit any text before <clarify> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        // Emit clarify_start once to show typing indicator during clarify generation
        if (!this.context.clarifyStartEmitted) {
          this.context.clarifyStartEmitted = true;
          actions.push({ type: 'clarify_start', data: {} });
        }
        
        this.buffer = this.buffer.substring(startIdx);
        this.context.insideClarify = true;
        this.context.clarifyContent = '';  // Reset accumulator
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16c. Check for </clarify> closing (discard content — not emitted to UI)
      if (this.context.insideClarify && this.buffer.includes('</clarify>')) {
        const endIdx = this.buffer.indexOf('</clarify>');
        
        this.buffer = this.buffer.substring(endIdx + '</clarify>'.length);
        this.context.insideClarify = false;
        
        // ✅ DISCARD: <clarify> content is NOT emitted to UI.
        // generate.ts parses it post-stream via parseClarifyBlocks() and sends choice cards.
        this.context.clarifyContent = '';  // Reset
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16d. Accumulate content inside <clarify> (suppress)
      if (this.context.insideClarify && this.buffer.length > 0) {
        this.context.clarifyContent += this.buffer;
        this.buffer = '';
        continue;
      }
      
      // 16e. Check for <function_calls> opening (SAFETY NET)
      // ⚠️ LLM outputs <function_calls><invoke name="..."> XML when structured tool_use is unavailable.
      // This happens when detectionReport.jobMode is missing (tools not passed to LLM API).
      // Suppress entirely: these are hallucinated tool calls that won't execute.
      if (!this.context.insideFunctionCalls && this.buffer.includes('<function_calls>')) {
        const startIdx = this.buffer.indexOf('<function_calls>');
        
        // Emit any text before <function_calls> as response
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        console.error(`🚨 [XMLParser] CRITICAL: LLM outputting <function_calls> XML as text!`);
        console.error(`   This means structured tool_use was not enabled for this LLM call.`);
        console.error(`   Check detectionReport.jobMode and tool activation in codeGen.`);
        
        this.buffer = this.buffer.substring(startIdx + '<function_calls>'.length);
        this.context.insideFunctionCalls = true;
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16f. Check for </function_calls> closing (suppress)
      if (this.context.insideFunctionCalls && this.buffer.includes('</function_calls>')) {
        const endIdx = this.buffer.indexOf('</function_calls>');
        
        this.buffer = this.buffer.substring(endIdx + '</function_calls>'.length);
        this.context.insideFunctionCalls = false;
        
        // ✅ DISCARD: hallucinated function calls are not executed
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16g. Accumulate content inside <function_calls> (suppress)
      if (this.context.insideFunctionCalls && this.buffer.length > 0) {
        this.buffer = '';  // Suppress
        continue;
      }
      
      // 16h. Check for <analysis> opening (strip tag, stream content as response)
      if (!this.context.insideAnalysis && this.buffer.includes('<analysis>')) {
        const startIdx = this.buffer.indexOf('<analysis>');
        
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<analysis>'.length);
        this.context.insideAnalysis = true;
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16i. Check for </analysis> closing
      if (this.context.insideAnalysis && this.buffer.includes('</analysis>')) {
        const endIdx = this.buffer.indexOf('</analysis>');
        const fragment = this.buffer.substring(0, endIdx);
        
        this.buffer = this.buffer.substring(endIdx + '</analysis>'.length);
        this.context.insideAnalysis = false;
        
        if (fragment.trim()) {
          actions.push({
            type: 'response',
            data: { content: fragment }
          });
        }
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16j. Stream content inside <analysis> (line-based, like response text)
      if (this.context.insideAnalysis && this.buffer.length > 0) {
        const lookahead = '</analysis>';
        
        if (this.buffer.length > lookahead.length) {
          const searchableContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
          const lastNewlineIdx = searchableContent.lastIndexOf('\n');
          
          if (lastNewlineIdx >= 0) {
            const completeLines = searchableContent.substring(0, lastNewlineIdx + 1);
            this.buffer = this.buffer.substring(completeLines.length);
            
            if (completeLines.trim()) {
              actions.push({
                type: 'response',
                data: { content: completeLines }
              });
            }
            continueParsingLoop = true;
          }
        }
        continue;
      }
      
      // 16k. Check for <plan> opening (emit plan_start action for PlanCard)
      if (!this.context.insidePlan && this.buffer.includes('<plan>')) {
        const startIdx = this.buffer.indexOf('<plan>');
        
        const beforeTag = this.buffer.substring(0, startIdx);
        if (beforeTag.trim()) {
          actions.push({
            type: 'response',
            data: { content: beforeTag }
          });
        }
        
        this.buffer = this.buffer.substring(startIdx + '<plan>'.length);
        this.context.insidePlan = true;
        
        actions.push({
          type: 'plan_start',
          data: {}
        });
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16l. Check for </plan> closing (emit remaining content + plan_end)
      if (this.context.insidePlan && this.buffer.includes('</plan>')) {
        const endIdx = this.buffer.indexOf('</plan>');
        const fragment = this.buffer.substring(0, endIdx);
        
        this.buffer = this.buffer.substring(endIdx + '</plan>'.length);
        this.context.insidePlan = false;
        
        if (fragment.length > 0) {
          actions.push({
            type: 'plan_content',
            data: { content: fragment }
          });
        }
        
        actions.push({
          type: 'plan_end',
          data: {}
        });
        
        continueParsingLoop = true;
        continue;
      }
      
      // 16m. Stream content inside <plan> (line-based, emit plan_content)
      if (this.context.insidePlan && this.buffer.length > 0) {
        const lookahead = '</plan>';
        
        if (this.buffer.length > lookahead.length) {
          const searchableContent = this.buffer.substring(0, this.buffer.length - lookahead.length);
          const lastNewlineIdx = searchableContent.lastIndexOf('\n');
          
          if (lastNewlineIdx >= 0) {
            const completeLines = searchableContent.substring(0, lastNewlineIdx + 1);
            this.buffer = this.buffer.substring(completeLines.length);
            
            actions.push({
              type: 'plan_content',
              data: { content: completeLines }
            });
            continueParsingLoop = true;
          }
        }
        continue;
      }
      
      // 17. Check for <file path="..."> opening
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
      
      // 16. Check for </file> closing
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
      
      // 17. Accumulate file content (LINE-BASED STREAMING for real-time rendering)
      if (this.context.insideFile && this.buffer.length > 0) {
        const lookahead = '</file>';
        
        // ✅ SAFETY CHECK: Detect invalid XML tags inside file content
        // If we encounter other XML tags (tooling, etc), force-close the file
        const invalidTagPatterns = [
          '</parameter>',
          '<parameter',
          '</invoke>',
          '<invoke',
          '<tool_call>',
          '</tool_call>',
          '<thinking>',
          '<tasks>',
          '<done>'
        ];
        
        for (const invalidTag of invalidTagPatterns) {
          if (this.buffer.includes(invalidTag)) {
            console.error(`🚨 [XMLParser] CRITICAL: Found invalid tag "${invalidTag}" inside file content!`);
            console.error(`   File: ${this.context.currentFilePath}`);
            console.error(`   This likely means </file> tag was missing from LLM output.`);
            console.error(`   Forcing file close to prevent corruption.`);
            
            // Extract content BEFORE the invalid tag
            const invalidIdx = this.buffer.indexOf(invalidTag);
            const validContent = this.buffer.substring(0, invalidIdx).trimEnd();
            
            // Emit valid content if any
            if (validContent.length > 0) {
              actions.push({
                type: 'file_content',
                data: {
                  filePath: this.context.currentFilePath!,
                  content: validContent
                }
              });
            }
            
            // Force file close
            actions.push({
              type: 'file_end',
              data: { filePath: this.context.currentFilePath! }
            });
            
            this.context.insideFile = false;
            this.context.currentFilePath = null;
            
            // Keep buffer (don't consume the invalid tag, let other parsers handle it)
            this.buffer = this.buffer.substring(invalidIdx);
            
            continueParsingLoop = true;
            break;
          }
        }
        
        // If we already handled the invalid tag, skip normal processing
        if (!this.context.insideFile) {
          continue;
        }
        
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
      
      // 18. Check for <append path="..."> opening
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
      
      // 19. Check for </append> closing
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
      
      // 20. Accumulate append content (LINE-BASED STREAMING for real-time rendering)
      if (this.context.insideAppend && this.buffer.length > 0) {
        const lookahead = '</append>';
        
        // ✅ SAFETY CHECK: Detect invalid XML tags inside append content
        const invalidTagPatterns = [
          '</parameter>',
          '<parameter',
          '</invoke>',
          '<invoke',
          '<tool_call>',
          '</tool_call>',
          '<thinking>',
          '<tasks>',
          '<done>'
        ];
        
        for (const invalidTag of invalidTagPatterns) {
          if (this.buffer.includes(invalidTag)) {
            console.error(`🚨 [XMLParser] CRITICAL: Found invalid tag "${invalidTag}" inside append content!`);
            console.error(`   File: ${this.context.currentAppendPath}`);
            console.error(`   Forcing append close to prevent corruption.`);
            
            const invalidIdx = this.buffer.indexOf(invalidTag);
            const validContent = this.buffer.substring(0, invalidIdx).trimEnd();
            
            if (validContent.length > 0) {
              actions.push({
                type: 'file_content',
                data: {
                  filePath: this.context.currentAppendPath!,
                  content: validContent
                }
              });
            }
            
            actions.push({
              type: 'file_end',
              data: { filePath: this.context.currentAppendPath! }
            });
            
            this.context.insideAppend = false;
            this.context.currentAppendPath = null;
            this.buffer = this.buffer.substring(invalidIdx);
            
            continueParsingLoop = true;
            break;
          }
        }
        
        if (!this.context.insideAppend) {
          continue;
        }
        
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
      
      // 21. General text response handling (outside any XML block)
      if (!this.context.insideThinking && 
          !this.context.insideTasks &&
          !this.context.insideProfile &&
          !this.context.insideLearnCommand &&
          !this.context.insideClarify &&
          !this.context.insideFunctionCalls &&
          !this.context.insideAnalysis &&
          !this.context.insidePlan &&
          !this.context.insideFile) {
        
        if (this.buffer.length > 0) {
          // 🎯 STRATEGY: Only emit text when it's SAFE (won't break XML tag parsing)
          
          // 1️⃣ HIGHEST PRIORITY: Check if there's text BEFORE an XML tag
          // Example: "Here is the code:\n<file path=..." → emit "Here is the code:\n"
          // Note: detect/references tags are NOT parsed - they flow through as normal response for SpecialTagTransformer
          const beforeTagMatch = this.buffer.match(/^(.+?)(?=<(?:thinking|tasks|profile|analysis|plan|file|delete|append|learn_command|clarify|function_calls|done)[\s>])/s);
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
      // If inside analysis, emit remaining content as response
      else if (this.context.insideAnalysis) {
        if (hasActualContent) {
          actions.push({
            type: 'response',
            data: { content: this.buffer }
          });
        }
      }
      // If inside plan, emit remaining content + plan_end
      else if (this.context.insidePlan) {
        if (hasActualContent) {
          actions.push({
            type: 'plan_content',
            data: { content: this.buffer }
          });
        }
        actions.push({
          type: 'plan_end',
          data: {}
        });
      }
      // If inside profile, discard (responseParser handles it post-stream)
      else if (this.context.insideProfile) {
        // ✅ DISCARD: profile content suppressed from UI
      }
      // If inside clarify, discard (post-hoc parsing handles it)
      else if (this.context.insideClarify) {
        // ✅ DISCARD: clarify content suppressed from UI
      }
      // If inside function_calls, discard (hallucinated XML tool calls)
      else if (this.context.insideFunctionCalls) {
        // ✅ DISCARD: hallucinated function calls suppressed from UI
        console.warn(`⚠️ [XMLParser] Discarding unterminated <function_calls> block on finalize`);
      }
      // Otherwise, emit as response (ONLY if has actual content)
      else if (!this.context.insideTasks && hasActualContent) {
        // Don't emit if inside <tasks> (should be hidden)
        actions.push({
          type: 'response',
          data: { content: this.buffer }
        });
      } else if (!this.context.insideTasks && !hasActualContent) {
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
      insideTasks: false,
      insideLearnCommand: false,  // ✅ NEW
      learnCommandContent: '',  // ✅ NEW
      tasksContent: '',  // ✅ NEW
      insideReferences: false,  // ✅ NEW
      referencesContent: '',  // ✅ NEW
      insideProfile: false,  // ✅ NEW
      insideClarify: false,  // ✅ NEW
      clarifyContent: '',  // ✅ NEW
      clarifyStartEmitted: false,  // ✅ NEW
      insideFunctionCalls: false,  // ✅ SAFETY
      insideAnalysis: false,
      insidePlan: false,
      currentFilePath: null,
      currentAppendPath: null,
    };
    this.buffer = '';
  }
}

