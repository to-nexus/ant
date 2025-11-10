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
      // Send to Chat UI (filter based on thinkingOnly)
      if (!thinkingOnly || event.type === 'thinking') {
        await chatAPI.sendLLMEvent(event);
      }
      
      // Accumulate for parsing
      if (event.type === 'thinking' || event.type === 'text') {
        const content = event.content;
        raw += content;
        accumulatedChunk += content;
        
        if (onChunk) {
          onChunk(content);
        }
        
        // Track file generation
        trackFileGeneration();
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
    // ✅ Improved pattern: Match file paths in code blocks (```language:path/to/file.ext or ```language\npath)
    const fileStartMatch = accumulatedChunk.match(/```(?:typescript|javascript|tsx|jsx|ts|js|json|html|css|md|yaml|yml)?[:\s]+([^\n`]+\.[a-z]+)/i);
    if (fileStartMatch && !insideFileBlock) {
      insideFileBlock = true;
      currentFilePath = fileStartMatch[1].trim();
      accumulatedChunk = '';
      
      if (onFileStart) {
        onFileStart(currentFilePath);
      }
    }
    
    // Detect file end marker (closing ```)
    if (insideFileBlock) {
      const closingMatch = accumulatedChunk.match(/```\s*$/m);
      if (closingMatch) {
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

