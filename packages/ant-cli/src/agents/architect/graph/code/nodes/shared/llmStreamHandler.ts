/**
 * LLM Stream Handler with Chat Integration
 * 
 * Handles LLM streaming with automatic Chat UI integration
 */

import { LLMClient } from "../../../../../../core/ports";
import { getChatAPIClient } from "../../../../../../core/adapters/ChatAPIClient";

export interface StreamHandlerOptions {
  enableChat?: boolean;
  thinkingOnly?: boolean;  // ✅ Show only thinking in chat, not text
  onChunk?: (chunk: string) => void;
  onFileStart?: (filePath: string) => void;
  onFileEnd?: () => void;
}

export interface StreamResult {
  raw: string;
  chatMessageStarted: boolean;
}

/**
 * Stream LLM response with Chat integration
 */
export async function streamLLMResponse(
  llm: LLMClient,
  promptMessages: Array<{ role: string; content: string }>,
  options: StreamHandlerOptions = {}
): Promise<StreamResult> {
  const { enableChat = true, thinkingOnly = false, onChunk, onFileStart, onFileEnd } = options;
  
  let raw = '';
  let accumulatedChunk = '';
  let insideFileBlock = false;
  let currentFilePath = '';
  let insideResponseBlock = false;  // ✅ Track == RESPONSE == block
  let firstFileDetected = false;    // ✅ Track if we've seen any files yet
  let pendingContent = '';           // ✅ Buffer for incomplete markers
  
  // Initialize Chat API client
  const chatAPI = getChatAPIClient();
  let chatMessageStarted = false;
  
  // Use streamRaw if available (provides thinking/text separation)
  if (llm.streamRaw && chatAPI.isEnabled() && (enableChat || thinkingOnly)) {
    // Start chat message (if not already started - will reuse existing if available)
    if (!chatMessageStarted) {
      await chatAPI.startMessage();
      chatMessageStarted = true;
    }
    
    // Stream with chat integration
    for await (const event of llm.streamRaw(promptMessages)) {
      // Accumulate for parsing
      if (event.type === 'thinking' || event.type === 'text') {
        let content = event.content;
        raw += content;
        accumulatedChunk += content;
        
        // ✅ Track RESPONSE block boundaries
        if (accumulatedChunk.includes('== RESPONSE ==')) {
          insideResponseBlock = true;
        }
        if (accumulatedChunk.includes('== END RESPONSE ==')) {
          insideResponseBlock = false;
        }
        
        // ✅ Track state transitions
        const previousInsideFileBlock = insideFileBlock;
        
        // Track file generation (updates insideFileBlock and firstFileDetected)
        trackFileGeneration();
        
        // ✅ Detect if file just started or ended (these chunks contain markers)
        const fileJustStarted = !previousInsideFileBlock && insideFileBlock;
        const fileJustEnded = previousInsideFileBlock && !insideFileBlock;
        
        // ✅ Aggressively remove all marker patterns from content BEFORE any checks
        let cleanContent = content
          .replace(/===\s*FILE:[^\n=]*===/g, '')
          .replace(/===\s*END\s*FILE\s*===/g, '')
          .replace(/==\s*RESPONSE\s*===/g, '')
          .replace(/==\s*END\s*RESPONSE\s*===/g, '')
          .replace(/===\s*FILE:/g, '')  // Partial marker at start
          .replace(/FILE:[^\n=]*/g, '')  // Partial marker middle
          .replace(/===\s*END/g, '')     // Partial END marker
          .replace(/END\s*FILE/g, '')    // Partial END FILE
          .trim();
        
        // ✅ Filter logic:
        // - Show thinking always (even if empty or at boundaries)
        // - Show text ONLY if:
        //   1. We're solidly inside a file block (not at boundaries)
        //   2. Not inside RESPONSE block  
        //   3. Has actual content after cleaning
        const isFileContent = insideFileBlock && !fileJustStarted && !fileJustEnded;
        const hasContentToShow = cleanContent.trim().length > 0;
        const shouldShowInChat = (
          (event.type === 'thinking' && hasContentToShow) ||  // Show thinking if it has content
          (event.type === 'text' && isFileContent && !insideResponseBlock && hasContentToShow)  // Show text only inside file blocks
        );
        
        // ✅ Skip if shouldn't show in chat
        if (!shouldShowInChat) {
          if (onChunk) {
            onChunk(content);
          }
          continue;
        }
        
        // Send to Chat UI (with cleaned content)
        if (!thinkingOnly || event.type === 'thinking') {
          // ✅ Send cleaned content (without markers)
          await chatAPI.sendLLMEvent({
            ...event,
            content: cleanContent
          });
        }
        
        if (onChunk) {
          onChunk(content); // Original content for parsing
        }
      }
    }
  } else if (llm.stream) {
    // Fallback to regular streaming (no chat integration)
    for await (const chunk of llm.stream(promptMessages)) {
      raw += chunk;
      accumulatedChunk += chunk;
      
      if (onChunk) {
        onChunk(chunk);
      }
      
      // Track file generation
      trackFileGeneration();
    }
  } else {
    // Fallback to regular invoke
    raw = await llm.invoke(promptMessages);
  }
  
  // Helper function to track file generation (improved pattern matching)
  function trackFileGeneration() {
    // ✅ Pattern 1: Match === FILE: path === marker (code job format)
    const fileMarkerMatch = accumulatedChunk.match(/===\s*FILE:\s*([^\s=]+)\s*===/);
    if (fileMarkerMatch && !insideFileBlock) {
      insideFileBlock = true;
      firstFileDetected = true;  // ✅ Mark that we've seen a file
      currentFilePath = fileMarkerMatch[1].trim();
      accumulatedChunk = '';
      
      if (onFileStart) {
        onFileStart(currentFilePath);
      }
      return; // Don't check other patterns
    }
    
    // ✅ Pattern 2: Match file paths in code blocks (```language:path/to/file.ext or ```language\npath)
    const fileStartMatch = accumulatedChunk.match(/```(?:typescript|javascript|tsx|jsx|ts|js|json|html|css|md|yaml|yml)?[:\s]+([^\n`]+\.[a-z]+)/i);
    if (fileStartMatch && !insideFileBlock) {
      insideFileBlock = true;
      firstFileDetected = true;  // ✅ Mark that we've seen a file
      currentFilePath = fileStartMatch[1].trim();
      accumulatedChunk = '';
      
      if (onFileStart) {
        onFileStart(currentFilePath);
      }
      return;
    }
    
    // Detect file end markers
    if (insideFileBlock) {
      // Pattern 1: === END FILE === marker
      const endMarkerMatch = accumulatedChunk.match(/===\s*END\s*FILE\s*===/);
      // Pattern 2: closing ```
      const closingMatch = accumulatedChunk.match(/```\s*$/m);
      
      if (endMarkerMatch || closingMatch) {
        insideFileBlock = false;
        const prevPath = currentFilePath;
        currentFilePath = '';
        accumulatedChunk = '';
        
        if (onFileEnd) {
          onFileEnd();
        }
      }
    }
    
    // Reset buffer periodically to avoid memory issues
    if (accumulatedChunk.length > 10000) {
      accumulatedChunk = accumulatedChunk.slice(-1000);
    }
  }
  
  return { raw, chatMessageStarted };
}

/**
 * Finalize chat message if started
 */
export async function finalizeChatMessage(chatMessageStarted: boolean): Promise<void> {
  if (chatMessageStarted) {
    const chatAPI = getChatAPIClient();
    await chatAPI.finalizeMessage();
  }
}

/**
 * Add file operation to chat with content
 */
export async function addChatFileOperation(
  operation: 'edit' | 'create' | 'delete',
  filePath: string,
  content?: string,
  diffBefore?: string,
  diffAfter?: string
): Promise<void> {
  const chatAPI = getChatAPIClient();
  if (chatAPI.isEnabled()) {
    await chatAPI.addFileOperation(operation, filePath, content, diffBefore, diffAfter);
  }
}

/**
 * Add command execution to chat
 */
export async function addChatCommandExecution(
  command: string,
  output?: string,
  exitCode?: number
): Promise<void> {
  const chatAPI = getChatAPIClient();
  if (chatAPI.isEnabled()) {
    await chatAPI.addCommandExecution(command, output, exitCode);
  }
}

