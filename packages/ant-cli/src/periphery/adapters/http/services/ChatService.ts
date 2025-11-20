/**
 * ChatService - Manages chat messages and SSE broadcasting
 * 
 * Handles real-time chat message streaming to frontend
 * Persists chat history to {project}/{feature}/chat.json
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LLMStreamEvent } from '../../../../core/ports/llm';
import type { SSEService } from './SSEService';
import type { WorkspaceResolver } from '../../../../infrastructure/workspace/WorkspaceResolver';
import type { UserContext } from '../../../../core/types/user';

// ✅ NOTE: This is duplicated in @ant-ui/domain/models/chat.ts
// Keep types in sync manually (packages are separate)
export interface MessageContent {
  type: // 🎯 Chat Status Messages (progress indicators)
     | 'placeholder'
     | 'thinking'       // LLM thinking / reasoning
     | 'exploring' | 'explored'   // Codebase scan
     | 'grepping' | 'grepped'     // Search
     | 'reading' | 'read'         // File read
     // General content
     | 'text'
     | 'cancelled'      // Task cancelled (with Resume button)
     // File Operations - Real-time streaming
     | 'file_creating' | 'file_writing' | 'file_create'
     | 'file_editing' | 'file_updating' | 'file_edit'
     | 'file_deleting' | 'file_delete'
     // Tool Actions - Cursor/Copilot style
     | 'tool_action'    // Simple tool actions (mkdir, etc.)
     // Command Execution - Real-time streaming
     | 'command_running' | 'command_streaming' | 'command';
  content: string;
  metadata?: {
    filePath?: string;
    diffBefore?: string;    // For file edit (before state)
    diffAfter?: string;     // For file edit (after state)
    command?: string;
    exitCode?: number;
    timestamp?: string;
    // Exploration & Analysis
    filesCount?: number;    // For explored/grepped
    totalFiles?: number;    // For exploring/grepping progress
    tokensCount?: number;   // For explored
    strategy?: string;      // For grepped (git/vector/keyword)
    filesList?: string[];   // List of files (for explored/grepped)
    // Tool Actions
    toolName?: string;      // For tool_action: tool name
    actionIcon?: string;    // For tool_action: emoji/icon
    // LLM metadata
    model?: string;         // LLM model used
    provider?: string;      // LLM provider (e.g., 'anthropic', 'openai')
    blockStart?: boolean;   // For thinking: marks <thinking> tag opened (new block)
    // Cancelled metadata
    jobId?: string;         // For cancelled: job ID to resume
    reason?: string;        // For cancelled: cancellation reason
    durationMs?: number;    // For thinking: duration in milliseconds
    collapsed?: boolean;    // For thinking: marks if the block should be collapsed
    // ❌ tasksJson 제거 (더 이상 사용하지 않음)
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  contents: MessageContent[];
  timestamp: string;
  jobId?: string; // Which job this message belongs to
  isStreaming?: boolean;
}

interface ChatSessionFile {
  projectId: string;
  featureName: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatSession {
  projectId: string;
  featureName: string;
  jobId?: string;
  messages: ChatMessage[];
  currentMessage?: ChatMessage; // Message being streamed
  activeFileOperations?: Map<string, { filePath: string; contentIndex: number }>;  // ✅ Track multiple files: filePath → { filePath, contentIndex }
  thinkingStartTime?: number;  // Track thinking block start time (ms)
  lastThinkingContentIndex?: number;  // Track last thinking content index
  userContext?: UserContext;  // ✅ Store user context for file operations
}

export class ChatService {
  private workspaceRoot: string;
  private sessions = new Map<string, ChatSession>();
  private sseService?: SSEService;
  private workspaceResolver?: WorkspaceResolver;  // ✅ Add WorkspaceResolver
  private defaultUserContext?: UserContext;  // ✅ Store default user context from request

  constructor(workspaceRoot: string, sseService?: SSEService, workspaceResolver?: WorkspaceResolver) {
    this.workspaceRoot = workspaceRoot;
    this.sseService = sseService;
    this.workspaceResolver = workspaceResolver;  // ✅ Store WorkspaceResolver
  }
  
  /**
   * Set user context for subsequent operations (from Express middleware)
   */
  setUserContext(userContext: UserContext): void {
    this.defaultUserContext = userContext;
  }

  /**
   * Get session key for a project/feature
   */
  private getSessionKey(projectId: string, featureName: string): string {
    return `${projectId}/${featureName}`;
  }

  /**
   * Get chat file path for a project/feature
   */
  private getChatFilePath(projectId: string, featureName: string, userContext?: UserContext): string {
    if (!this.workspaceResolver || !userContext) {
      throw new Error('WorkspaceResolver and userContext are required');
    }
    
    const featurePath = this.workspaceResolver.getFeaturePath(userContext, projectId, featureName);
    return path.join(featurePath, 'sessions', 'chat.json');
  }

  /**
   * Load chat session from file
   */
  private loadSessionFromFile(projectId: string, featureName: string, userContext?: UserContext): ChatSessionFile | null {
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const sessionFile = JSON.parse(content) as ChatSessionFile;
      
      // ✅ Mark all loaded messages as complete (they're from file, not streaming)
      sessionFile.messages = sessionFile.messages.map(msg => ({
        ...msg,
        isComplete: true,
        isStreaming: undefined
      }));
      
      return sessionFile;
    } catch (error) {
      console.error(`❌ [ChatService] Failed to load chat file for ${projectId}/${featureName}:`, error);
      return null;
    }
  }

  /**
   * Save chat session to file
   */
  private saveSessionToFile(projectId: string, featureName: string, messages: ChatMessage[], userContext?: UserContext): void {
    const filePath = this.getChatFilePath(projectId, featureName, userContext);
    
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Load existing file to preserve createdAt
      let createdAt = new Date().toISOString();
      const existing = this.loadSessionFromFile(projectId, featureName, userContext);
      if (existing) {
        createdAt = existing.createdAt;
      }

      const sessionFile: ChatSessionFile = {
        projectId,
        featureName,
        messages: messages.map(msg => ({
          ...msg,
          isStreaming: undefined // Don't persist streaming flag
        })),
        createdAt,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(filePath, JSON.stringify(sessionFile, null, 2), 'utf-8');
    } catch (error) {
      console.error(`❌ [ChatService] Failed to save chat file for ${projectId}/${featureName}:`, error);
    }
  }

  /**
   * Initialize or get chat session (with file loading)
   */
  getOrCreateSession(projectId: string, featureName: string, jobId?: string, userContext?: UserContext): ChatSession {
    const key = this.getSessionKey(projectId, featureName);
    
    // Check memory cache first
    if (!this.sessions.has(key)) {
      // Load from file if exists
      const fileSession = this.loadSessionFromFile(projectId, featureName, userContext);
      
      this.sessions.set(key, {
        projectId,
        featureName,
        jobId,
        messages: fileSession?.messages || [],
        userContext  // ✅ Store user context for later file operations
      });
      
      if (fileSession) {
        console.log(`💬 [ChatService] Loaded ${fileSession.messages.length} messages from file for ${key}`);
      }
    }

    const session = this.sessions.get(key)!;
    
    // Update jobId if provided and changed
    if (jobId && session.jobId !== jobId) {
      session.jobId = jobId;
    }
    
    // ✅ Update userContext if provided (for existing sessions)
    if (userContext && !session.userContext) {
      session.userContext = userContext;
    }

    return session;
  }

  /**
   * Add user message to chat history
   */
  addUserMessage(projectId: string, featureName: string, content: string, jobId?: string, userContext?: UserContext): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId, userContext);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const userMessage: ChatMessage = {
      id: messageId,
      role: 'user',
      contents: [{
        type: 'text',
        content
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(userMessage);
    
    // Save to file
    this.saveSessionToFile(projectId, featureName, session.messages, userContext);
    
    // Broadcast new user message
    this.broadcast(projectId, featureName, {
      type: 'user_message',
      message: userMessage
    });
    
    return messageId;
  }

  /**
   * Check if there's an active (streaming) message
   */
  hasActiveMessage(projectId: string, featureName: string): boolean {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    return session?.currentMessage !== undefined;
  }

  /**
   * Start a new assistant message (for streaming)
   */
  startAssistantMessage(projectId: string, featureName: string, jobId: string, userContext?: UserContext): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId, userContext);
    
    // ✅ If there's already a current message being streamed, reuse it (avoid duplicates)
    if (session.currentMessage && session.currentMessage.isStreaming) {
      return session.currentMessage.id;
    }
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [],
      timestamp: new Date().toISOString(),
      jobId, // Associate message with job
      isStreaming: true
    };

    session.currentMessage = newMessage;
    
    // Broadcast message start
    this.broadcast(projectId, featureName, {
      type: 'message_start',
      message: newMessage
    });

    return messageId;
  }

  /**
   * Add content to current streaming message
   * Returns the actual content index used (important for MERGE cases)
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): number {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (!session || !session.currentMessage) {
      console.warn('⚠️  [ChatService] No current message to add content to');
      return -1;  // Return invalid index
    }

    // ✅ Get existing contents and last content
    const existingContents = session.currentMessage.contents;
    const lastContent = existingContents.length > 0 
      ? existingContents[existingContents.length - 1] 
      : undefined;
    const lastContentIndex = existingContents.length - 1;
    
    // 🎯 UNIFIED CHAT STATUS MESSAGE HANDLING (Cursor/Copilot style)
    // 
    // Chat Status Message = Progress indicator (unified concept)
    // Types: placeholder, exploring, explored, grepping, grepped, reading, read, thinking
    // 
    // Rules:
    // 1. placeholder → placeholder: REPLACE (node transition)
    // 2. Chat Status Message → Chat Status Message: MERGE (e.g. placeholder → exploring)
    // 3. Chat Status Message → General Content (text/file): HIDE (remove Chat Status Message)
    // 
    // ✅ CRITICAL FIX: Search backwards to find the most recent Chat Status of specific type
    // This handles cases where other content (text, thinking) was added between status updates
    
    const CHAT_STATUS_TYPES = new Set([
      'placeholder', 
      'exploring', 'explored', 
      'grepping', 'grepped', 
      'reading', 'read',
      'command_running', 'command_streaming', 'command'
      // NOTE: 'thinking' is NOT a Chat Status - it's general content!
      // - Chat Status = progress indicator (placeholder, exploring, grepping, etc.)
      // - thinking = LLM thought process (collapsible content block)
      // When thinking arrives, Chat Status (if any) will HIDE via Case 3
    ]);
    
    /**
     * ✅ Find the most recent Chat Status of a specific type (reverse search)
     * This ensures we can merge status updates even if other content was added in between
     */
    const findRecentChatStatus = (type: MessageContent['type'] | MessageContent['type'][]): { content: MessageContent; index: number } | null => {
      const types = Array.isArray(type) ? type : [type];
      for (let i = existingContents.length - 1; i >= 0; i--) {
        if (types.includes(existingContents[i].type)) {
          return { content: existingContents[i], index: i };
        }
      }
      return null;
    };
    
    const isLastChatStatus = lastContent && CHAT_STATUS_TYPES.has(lastContent.type);
    const isNewChatStatus = CHAT_STATUS_TYPES.has(content.type);
    
    const isLastPlaceholder = lastContent?.type === 'placeholder';
    const isNewPlaceholder = content.type === 'placeholder';
    
    // ✅ Check if new thinking block starts (<thinking> tag opened)
    const isNewThinkingBlock = 
      content.type === 'thinking' && 
      content.metadata?.blockStart === true;
    
    // Case 1: Placeholder → Placeholder (node transition)
    if (isLastPlaceholder && isNewPlaceholder && lastContent) {
      console.log('[ChatService] 🔄 Node transition: Old placeholder → New placeholder');
      
      lastContent.type = content.type;
      lastContent.content = content.content;
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: lastContentIndex,
        content: lastContent
      });
      return lastContentIndex;  // Return the merged index
    }
    
    // Case 2: Explicit MERGE patterns
    // - placeholder → any (placeholder는 모든 후속 content로 MERGE)
    // - exploring → exploring/explored (progress update/completion)
    // - grepping → grepping/grepped (progress update/completion)
    // - reading → reading/read (progress update/completion)
    // 
    // ✅ NEW: Use reverse search to find the most recent matching status
    // This handles cases where other content was added in between
    
    // ✅ Check if we should merge with placeholder (always merge if last is placeholder)
    if (isLastPlaceholder && lastContent) {
      // Placeholder → anything: merge with last (which is placeholder)
      console.log(`[ChatService] ✅ MERGED: ${lastContent.type} → ${content.type} (placeholder merge)`);
      
      lastContent.type = content.type;
      // ✅ Special case: placeholder → thinking = clear placeholder content
      if (content.type === 'thinking') {
        lastContent.content = '';  // Clear placeholder content, wait for LLM thinking
        console.log(`[ChatService] 🧹 Cleared placeholder content for thinking block`);
      } else {
        lastContent.content = content.content;
      }
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      // ✅ CRITICAL: Start tracking thinking block duration when placeholder → thinking (with blockStart)
      if (content.type === 'thinking' && content.metadata?.blockStart) {
        session.thinkingStartTime = Date.now();
        session.lastThinkingContentIndex = lastContentIndex;
      }
      
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: lastContentIndex,
        content: lastContent
      });
      return lastContentIndex;
    }
    
    // ✅ Check if we should merge with a specific progress status (reverse search)
    // exploring → exploring/explored
    if (content.type === 'exploring' || content.type === 'explored') {
      const found = findRecentChatStatus(['exploring', 'explored']);
      if (found && found.content.type === 'exploring') {
        console.log(`[ChatService] ✅ MERGED: ${found.content.type} → ${content.type} (reverse search, index ${found.index})`);
        found.content.type = content.type;
        found.content.content = content.content;
        found.content.metadata = { ...found.content.metadata, ...content.metadata };
        
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: found.index,
          content: found.content
        });
        return found.index;
      }
    }
    
    // grepping → grepping/grepped
    if (content.type === 'grepping' || content.type === 'grepped') {
      const found = findRecentChatStatus(['grepping', 'grepped']);
      if (found && found.content.type === 'grepping') {
        console.log(`[ChatService] ✅ MERGED: ${found.content.type} → ${content.type} (reverse search, index ${found.index})`);
        found.content.type = content.type;
        found.content.content = content.content;
        found.content.metadata = { ...found.content.metadata, ...content.metadata };
        
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: found.index,
          content: found.content
        });
        return found.index;
      }
    }
    
    // reading → reading/read (✅ CRITICAL: Must match filePath)
    if (content.type === 'reading' || content.type === 'read') {
      const found = findRecentChatStatus(['reading', 'read']);
      // ✅ Only merge if it's the SAME FILE
      if (found && found.content.type === 'reading' && 
          found.content.metadata?.filePath === content.metadata?.filePath) {
        console.log(`[ChatService] ✅ MERGED: ${found.content.type} → ${content.type} for ${content.metadata?.filePath} (reverse search, index ${found.index})`);
        found.content.type = content.type;
        found.content.content = content.content;
        found.content.metadata = { ...found.content.metadata, ...content.metadata };
        
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: found.index,
          content: found.content
        });
        return found.index;
      }
    }
    
    // command_running → command_streaming → command
    if (content.type === 'command_running' || content.type === 'command_streaming' || content.type === 'command') {
      const found = findRecentChatStatus(['command_running', 'command_streaming', 'command']);
      // ✅ Only merge if it's the SAME COMMAND
      if (found && 
          (found.content.type === 'command_running' || found.content.type === 'command_streaming') &&
          found.content.metadata?.command === content.metadata?.command) {
        console.log(`[ChatService] ✅ MERGED: ${found.content.type} → ${content.type} for command "${content.metadata?.command}" (reverse search, index ${found.index})`);
        found.content.type = content.type;
        found.content.content = content.content;
        found.content.metadata = { ...found.content.metadata, ...content.metadata };
        
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: found.index,
          content: found.content
        });
        return found.index;
      }
    }
    
    // Case 2.5: Direct duplicate of completed Chat Status = IGNORE
    // e.g., grepped → grepped, explored → explored, read → read
    // But grepped → grepping → grepped = NEW grepped (independent search)
    const completedChatStatusTypes = new Set(['grepped', 'explored', 'read', 'command']);
    const shouldIgnore = 
      lastContent &&
      completedChatStatusTypes.has(lastContent.type) &&
      lastContent.type === content.type;  // ✅ Only ignore direct duplicates
    
    if (shouldIgnore) {
      console.log(`[ChatService] ⏭️ IGNORED: ${content.type} → ${content.type} (direct duplicate)`);
      return lastContentIndex;  // Return existing index (no change needed)
    }
    
    // ✅ Track thinking block duration (supports multiple thinking blocks in one message)
    // When thinking ends (new non-thinking content OR new thinking block), calculate duration
    if (session.thinkingStartTime && session.lastThinkingContentIndex !== undefined) {
      // End previous thinking block if:
      // 1. New non-thinking content arrives, OR
      // 2. New thinking block starts (blockStart: true)
      const isEndingThinkingBlock = 
        content.type !== 'thinking' || 
        content.metadata?.blockStart;
      
      if (isEndingThinkingBlock) {
        const durationMs = Date.now() - session.thinkingStartTime;
        const thinkingContent = existingContents[session.lastThinkingContentIndex];
        
        if (thinkingContent && thinkingContent.type === 'thinking') {
          // ✅ 1. Update duration metadata
          thinkingContent.metadata = {
            ...thinkingContent.metadata,
            durationMs
          };
          
          // ✅ 2. Broadcast duration update
          this.broadcast(projectId, featureName, {
            type: 'content_update',
            messageId: session.currentMessage.id,
            contentIndex: session.lastThinkingContentIndex,
            content: thinkingContent
          });
          
          // ✅ 3. Broadcast collapse signal (프론트엔드가 thinking 카드를 접도록 신호)
          this.broadcast(projectId, featureName, {
            type: 'thinking_collapse',
            messageId: session.currentMessage.id,
            contentIndex: session.lastThinkingContentIndex,
            durationMs
          });
          
          console.log(`[ChatService] 💭 Thinking block collapsed (duration: ${(durationMs / 1000).toFixed(1)}s)`);
        }
        
        // Reset tracking (will be set again below if new thinking block starts)
        session.thinkingStartTime = undefined;
        session.lastThinkingContentIndex = undefined;
      }
    }
    
    // Start tracking new thinking block
    if (content.type === 'thinking' && content.metadata?.blockStart) {
      session.thinkingStartTime = Date.now();
      session.lastThinkingContentIndex = existingContents.length;  // Will be the index after we add it
    }
    
    // ✅ STREAMING: Same-type content appending (ignore = don't create new block)
    // - text → text: append tokens
    // - thinking → thinking (same block): append tokens
    // - file_writing → file_writing (same file): append code
    // - file_updating → file_updating (same file): append code
    // - file_creating/editing/deleting → same (same file): maintain state
    const isTextOrThinking = content.type === 'text' || content.type === 'thinking';
    const isFileStreaming = 
      content.type === 'file_writing' ||
      content.type === 'file_updating' ||
      content.type === 'file_creating' ||
      content.type === 'file_editing' ||
      content.type === 'file_deleting';
    
    // For files, check if it's the same file (same filePath)
    const isSameFile = lastContent?.metadata?.filePath && 
                       content.metadata?.filePath &&
                       lastContent.metadata.filePath === content.metadata.filePath;
    
    const canAppend = lastContent &&
        lastContent.type === content.type &&
        (
          (isTextOrThinking && !isNewThinkingBlock) ||  // text/thinking (not new block)
          (isFileStreaming && isSameFile)               // file (same file only!)
        );

    if (canAppend && lastContent) {
      // Append silently (streaming tokens/code)
      lastContent.content += content.content;
      // Update metadata (e.g., line counts for files)
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };

      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: lastContentIndex,
        content: lastContent
      });
      return lastContentIndex;  // Return the appended index
    }
    // ✅ File operations: Find and update in-progress content
    else if (content.metadata?.filePath && 
               (content.type === 'file_create' || content.type === 'file_edit' || content.type === 'file_delete')) {
      // ✅ File operation completion: find and update the in-progress content
      const inProgressTypes = {
        'file_create': ['file_creating', 'file_writing'],
        'file_edit': ['file_editing', 'file_updating'],
        'file_delete': ['file_deleting']
      };
      
      const typesToFind = inProgressTypes[content.type] || [];
      const existingIndex = existingContents.findIndex(c => 
        typesToFind.includes(c.type) && 
        c.metadata?.filePath === content.metadata?.filePath
      );
      
      if (existingIndex !== -1) {
        // Update existing in-progress content
        existingContents[existingIndex] = content;
        
        // Broadcast content update
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: existingIndex,
          content
        });
        return existingIndex;  // Return the updated index
      } else {
        // No in-progress content found, add as new
        const newIndex = session.currentMessage.contents.length;
        session.currentMessage.contents.push(content);
        
        // Broadcast content add
        this.broadcast(projectId, featureName, {
          type: 'content_add',
          messageId: session.currentMessage.id,
          content
        });
        return newIndex;  // Return the new index
      }
    } else {
      // Different type or has metadata → add as new content block
      if (isNewThinkingBlock) {
        console.log('[ChatService] 🆕 New thinking block (<thinking> opened)');
      }
      
      const newIndex = session.currentMessage.contents.length;
      session.currentMessage.contents.push(content);

      // Broadcast content add
      this.broadcast(projectId, featureName, {
        type: 'content_add',
        messageId: session.currentMessage.id,
        content
      });
      return newIndex;  // Return the new index
    }
  }

  /**
   * Finalize current streaming message
   * @param cancelled - If true, marks file operations as cancelled
   */
  finalizeCurrentMessage(projectId: string, featureName: string, cancelled: boolean = false): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (!session || !session.currentMessage) {
      return;
    }

    // ✅ Calculate duration for last thinking block if exists (message finalize)
    if (session.thinkingStartTime && session.lastThinkingContentIndex !== undefined) {
      const durationMs = Date.now() - session.thinkingStartTime;
      const thinkingContent = session.currentMessage.contents[session.lastThinkingContentIndex];
      
      if (thinkingContent && thinkingContent.type === 'thinking') {
        // ✅ 1. Update duration metadata
        thinkingContent.metadata = {
          ...thinkingContent.metadata,
          durationMs
        };
        
        // ✅ 2. Broadcast duration update
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: session.lastThinkingContentIndex,
          content: thinkingContent
        });
        
        // ✅ 3. Broadcast collapse signal (메시지 종료 시에도 마지막 thinking 접기)
        this.broadcast(projectId, featureName, {
          type: 'thinking_collapse',
          messageId: session.currentMessage.id,
          contentIndex: session.lastThinkingContentIndex,
          durationMs
        });
        
        console.log(`[ChatService] 💭 Final thinking block collapsed (duration: ${(durationMs / 1000).toFixed(1)}s)`);
      }
      
      // Reset tracking
      session.thinkingStartTime = undefined;
      session.lastThinkingContentIndex = undefined;
    }

    // ✅ Finalize any active file operations (interrupted/incomplete)
    if (session.activeFileOperations && session.activeFileOperations.size > 0) {
      for (const [filePath, fileOp] of session.activeFileOperations.entries()) {
        const fileContent = session.currentMessage.contents[fileOp.contentIndex];
        if (fileContent) {
          // Convert streaming types to completed types
          if (fileContent.type === 'file_creating' || fileContent.type === 'file_writing') {
            fileContent.type = 'file_create';
          } else if (fileContent.type === 'file_editing' || fileContent.type === 'file_updating') {
            fileContent.type = 'file_edit';
          } else if (fileContent.type === 'file_deleting') {
            fileContent.type = 'file_delete';
          }
          
          // ✅ Mark as interrupted if job was stopped
          if (cancelled) {
            fileContent.metadata = {
              ...fileContent.metadata,
              reason: 'user_stopped'
            };
          }
          
          // Broadcast final state
          this.broadcast(projectId, featureName, {
            type: 'content_update',
            messageId: session.currentMessage.id,
            contentIndex: fileOp.contentIndex,
            content: fileContent
          });
        }
      }
      
      // Clear active operations
      session.activeFileOperations.clear();
    }

    session.currentMessage.isStreaming = false;
    session.messages.push(session.currentMessage);
    
    // Save to file
    this.saveSessionToFile(projectId, featureName, session.messages, session.userContext);
    
    // Broadcast message complete
    this.broadcast(projectId, featureName, {
      type: 'message_complete',
      messageId: session.currentMessage.id
    });

    session.currentMessage = undefined;
  }

  /**
   * Process LLM stream event and convert to chat content
   */
  handleLLMStreamEvent(
    projectId: string,
    featureName: string,
    event: LLMStreamEvent
  ): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    switch (event.type) {
      case 'thinking':
        // ✅ FIX: Thinking should create a dedicated thinking card, not plain text
        // Check if we already have a thinking content block
        if (session?.currentMessage) {
          const lastContent = session.currentMessage.contents[session.currentMessage.contents.length - 1];
          
          // ✅ Check if this is a blockEnd signal (for collapse)
          const isBlockEnd = event.metadata?.blockEnd === true;
          
          if (isBlockEnd && lastContent && lastContent.type === 'thinking') {
            // ✅ BlockEnd signal - update duration and trigger collapse
            const durationMs = event.metadata?.durationMs;
            console.log(`[ChatService] 💭 Thinking blockEnd detected - duration: ${durationMs}ms, contentIndex: ${session.currentMessage.contents.length - 1}`);
            
            // Only append content if exists
            if (event.thinking && event.thinking.trim()) {
              lastContent.content += event.thinking;
            }
            
            // Update metadata with duration
            lastContent.metadata = {
              ...lastContent.metadata,
              durationMs
            };
            
            // Broadcast update
            this.broadcast(projectId, featureName, {
              type: 'content_update',
              messageId: session.currentMessage.id,
              contentIndex: session.currentMessage.contents.length - 1,
              content: lastContent
            });
            
            // ✅ Trigger collapse
            console.log(`[ChatService] 📤 Broadcasting thinking_collapse with duration: ${durationMs}ms`);
            this.broadcast(projectId, featureName, {
              type: 'thinking_collapse',
              messageId: session.currentMessage.id,
              contentIndex: session.currentMessage.contents.length - 1,
              durationMs
            });
          } else if (lastContent && lastContent.type === 'thinking') {
            // ✅ Append to existing thinking block
            lastContent.content += event.thinking || '';
            
            // Broadcast incremental update
            this.broadcast(projectId, featureName, {
              type: 'content_append',
              messageId: session.currentMessage.id,
              contentIndex: session.currentMessage.contents.length - 1,
              delta: event.thinking || ''
            });
        } else {
            // ✅ Create new thinking block
            this.addContentToCurrentMessage(projectId, featureName, {
              type: 'thinking',
              content: event.thinking || ''
            });
          }
        }
        break;

      case 'text':
          // No active file operation - add as regular text
        // (File content is now handled by tool node, not streaming)
          this.addContentToCurrentMessage(projectId, featureName, {
            type: 'text',
          content: event.text || ''  // ✅ NEW: text 필드 사용
        });
        break;

      case 'tool_use':
        // ✅ Tool call detected - create appropriate loading card based on tool type
        if (event.toolUse && session?.currentMessage) {
          const { name, input } = event.toolUse;
          
          // ✅ FILE OPERATIONS: write_file, apply_patch, delete_file (로딩 카드 생성)
          if (name === 'write_file' || name === 'apply_patch' || name === 'delete_file') {
            const filePath = (input as any).path;
            
            if (filePath) {
              console.log(`[ChatService] 📄 Creating loading file card for: ${filePath}`);
              
              // Determine operation type
              let contentType: MessageContent['type'];
              if (name === 'delete_file') {
                contentType = 'file_deleting';
              } else {
                // Default to creating (tool node will update based on file existence)
                contentType = 'file_creating';
              }
              
              // ✅ CRITICAL: Get the actual index after MERGE (placeholder → file_creating)
              const actualIndex = this.addContentToCurrentMessage(projectId, featureName, {
                type: contentType,
                content: '',  // Empty initially, will be filled by tool node
                metadata: {
                  filePath,
                  timestamp: new Date().toISOString()
                }
              });
              
              // ✅ Track as active file operation with the ACTUAL index (not predicted)
              if (actualIndex !== -1) {
                if (!session.activeFileOperations) {
                  session.activeFileOperations = new Map();
                }
                session.activeFileOperations.set(filePath, { filePath, contentIndex: actualIndex });
                console.log(`[ChatService] ✅ Tracked file operation at actual index ${actualIndex} for: ${filePath}`);
              }
            }
          }
          // ✅ COMMAND EXECUTION: run_command
          else if (name === 'run_command') {
            const command = (input as any).command;
            
            if (command) {
              console.log(`[ChatService] 💻 Creating loading command card for: ${command}`);
              
              // Add loading command card
              this.addContentToCurrentMessage(projectId, featureName, {
                type: 'command_running',  // Loading state
                content: '',  // Output will be streamed
                metadata: {
                  command,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }
          // ✅ CODEBASE EXPLORATION: read_file, list_files, search_code, etc.
          else if (name === 'read_file') {
            const filePath = (input as any).path;
            if (filePath) {
              console.log(`[ChatService] 👁️  Reading file: ${filePath}`);
              this.addContentToCurrentMessage(projectId, featureName, {
                type: 'reading',
                content: `Reading ${filePath}...`,
                metadata: {
                  filePath,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }
          else if (name === 'list_files' || name === 'search_code') {
            console.log(`[ChatService] 🔍 Tool: ${name}`);
            this.addContentToCurrentMessage(projectId, featureName, {
              type: 'exploring',
              content: 'Exploring...',
              metadata: {
                timestamp: new Date().toISOString()
              }
            });
          }
          // ✅ SIMPLE TOOLS: mkdir (Cursor/Copilot style - minimal one-line display)
          else if (name === 'mkdir') {
            const dirPath = (input as any).path;
            console.log(`[ChatService] 📁 Tool: mkdir (${dirPath})`);
            this.addContentToCurrentMessage(projectId, featureName, {
              type: 'tool_action',
              content: `Created directory: ${dirPath}`,
              metadata: {
                toolName: 'mkdir',
                actionIcon: '📁',
                filePath: dirPath,
                timestamp: new Date().toISOString()
              }
            });
          }
          // ✅ OTHER TOOLS: Fallback (should rarely be used)
          else {
            // Generic tool call display
            console.log(`[ChatService] 🔧 Tool: ${name}`);
            this.addContentToCurrentMessage(projectId, featureName, {
              type: 'tool_action',
              content: `${name}: ${JSON.stringify(input)}`,
              metadata: {
                toolName: name,
                actionIcon: '🔧',
                timestamp: new Date().toISOString()
              }
            });
          }
        }
        break;

      case 'done':
        // Don't finalize here - let the caller decide when to finalize
        break;

      case 'error':
        this.addContentToCurrentMessage(projectId, featureName, {
          type: 'text',
          content: `❌ Error: ${event.error?.message || 'Unknown error'}`  // ✅ NEW: error 필드 사용
        });
        break;
    }
  }

  /**
   * Add file operation notification
   */
  addFileOperation(
    projectId: string,
    featureName: string,
    operation: 'edit' | 'create' | 'delete',
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string,
    phase?: 'creating' | 'writing' | 'editing' | 'updating' | 'deleting' | 'complete'
  ): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    // ✅ CRITICAL: Debug logging for missing currentMessage
    if (!session) {
      console.error(`❌ [ChatService] addFileOperation: No session found for key: ${key}`);
      console.error(`   File: ${filePath}, Phase: ${phase}, Operation: ${operation}`);
      return;
    }
    
    if (!session.currentMessage) {
      console.error(`❌ [ChatService] addFileOperation: No currentMessage in session`);
      console.error(`   Session key: ${key}`);
      console.error(`   File: ${filePath}, Phase: ${phase}, Operation: ${operation}`);
      console.error(`   activeFileOperations size: ${session.activeFileOperations?.size || 0}`);
      console.error(`   Total messages in session: ${session.messages?.length || 0}`);
      return;
    }
    
    if (!phase) {
      console.warn(`⚠️  [ChatService] addFileOperation: No phase provided for ${filePath}`);
      return;
    }
    
    // ✅ Update existing in-progress content instead of adding new ones
    if (session?.currentMessage && phase) {
      const inProgressTypes = {
        'create': ['file_creating', 'file_writing'],
        'edit': ['file_editing', 'file_updating'],
        'delete': ['file_deleting']
      };
      
      const typesToFind = inProgressTypes[operation] || [];
      
      // ✅ 1차 시도: activeFileOperations Map에서 찾기 (tool_use에서 생성한 카드)
      const activeOp = session.activeFileOperations?.get(filePath);
      let existingIndex = activeOp ? activeOp.contentIndex : -1;
      
      // ✅ 2차 시도: typesToFind로 검색 (fallback)
      if (existingIndex === -1) {
        existingIndex = session.currentMessage.contents.findIndex(c => 
        typesToFind.includes(c.type) && 
        c.metadata?.filePath === filePath
      );
      }
      
      if (existingIndex !== -1) {
        
        // ✅ Determine new type based on phase
        let newType: MessageContent['type'];
        
        if (phase === 'creating') {
          newType = 'file_creating';
        } else if (phase === 'writing') {
          newType = 'file_writing';
        } else if (phase === 'editing') {
          newType = 'file_editing';
        } else if (phase === 'updating') {
          newType = 'file_updating';
        } else if (phase === 'deleting') {
          newType = 'file_deleting';
        } else if (phase === 'complete') {
          newType = operation === 'create' ? 'file_create' :
                    operation === 'edit' ? 'file_edit' :
                    'file_delete';
        } else {
          newType = session.currentMessage.contents[existingIndex].type;
        }
        
        // ✅ Update existing content
        const existingContent = session.currentMessage.contents[existingIndex];
        if (!existingContent) {
          console.error(`[ChatService] ❌ Content at index ${existingIndex} is undefined!`);
          return;
        }
        
        const oldContent = existingContent.content || '';
        const newContent = content !== undefined ? content : oldContent;
        
        session.currentMessage.contents[existingIndex] = {
          type: newType,
          content: newContent,
          metadata: {
            filePath,
            diffBefore,
            diffAfter,
            timestamp: new Date().toISOString()
          }
        };
        
        // ✅ Broadcast incremental update for writing phase (real-time streaming)
        if (phase === 'writing' && content !== undefined && oldContent !== newContent) {
          // Calculate delta (new content that was added)
          const delta = newContent.startsWith(oldContent) ? newContent.substring(oldContent.length) : newContent;
          
          this.broadcast(projectId, featureName, {
            type: 'content_append',
            messageId: session.currentMessage.id,
            contentIndex: existingIndex,
            delta: delta
          });
        } else {
          // Full content update for other phases (metadata changes, etc.)
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: existingIndex,
          content: session.currentMessage.contents[existingIndex]
        });
        }
        
        // ✅ Track active file operations for real-time streaming (Map for multiple files)
        if (phase === 'writing' || phase === 'updating') {
          if (!session.activeFileOperations) {
            session.activeFileOperations = new Map();
          }
          session.activeFileOperations.set(filePath, { filePath, contentIndex: existingIndex });
        } else if (phase === 'complete') {
          // Clear active file operation
          session.activeFileOperations?.delete(filePath);
        }
        
        return; // ✅ Early return - don't add new content
      }
    }
    
    // ✅ No existing content found - add new content
    // Determine content type based on phase and operation
    let type: MessageContent['type'];
    
    if (phase === 'creating') {
      type = 'file_creating';
    } else if (phase === 'writing') {
      type = 'file_writing';
    } else if (phase === 'editing') {
      type = 'file_editing';
    } else if (phase === 'updating') {
      type = 'file_updating';
    } else if (phase === 'deleting') {
      type = 'file_deleting';
    } else {
      // phase === 'complete' or legacy (no phase)
      const typeMap = {
        edit: 'file_edit' as const,
        create: 'file_create' as const,
        delete: 'file_delete' as const
      };
      type = typeMap[operation];
    }

    this.addContentToCurrentMessage(projectId, featureName, {
      type,
      content: content || '',  // ✅ Full content or empty
      metadata: {
        filePath,
        diffBefore,  // ✅ For edit operations
        diffAfter,   // ✅ For edit operations
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Add command execution notification
   */
  addCommandExecution(
    projectId: string,
    featureName: string,
    command: string,
    output?: string,
    exitCode?: number,
    phase?: 'running' | 'streaming' | 'complete'
  ): void {
    // Determine content type based on phase
    let type: MessageContent['type'];
    
    if (phase === 'running') {
      type = 'command_running';
    } else if (phase === 'streaming') {
      type = 'command_streaming';
    } else {
      // phase === 'complete' or legacy (no phase)
      type = 'command';
    }

    this.addContentToCurrentMessage(projectId, featureName, {
      type,
      content: output || '',
      metadata: {
        command,
        exitCode,
        timestamp: new Date().toISOString()
      }
    });
  }



  /**
   * Add job error message (for job failures)
   */
  addJobError(
    projectId: string,
    featureName: string,
    jobId: string,
    errorMessage: string,
    errorDetails?: any
  ): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const errorMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'text',
        content: `❌ **Job Failed**\n\n${errorMessage}${errorDetails ? `\n\nDetails:\n${JSON.stringify(errorDetails, null, 2)}` : ''}`
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(errorMsg);
    
    // Save to file
    this.saveSessionToFile(projectId, featureName, session.messages);
    
    // Broadcast error message
    this.broadcast(projectId, featureName, {
      type: 'error_message',
      message: errorMsg
    });
    
    console.log(`❌ [ChatService] Added job error message: ${messageId}`);
    return messageId;
  }

  /**
   * Add cancelled message (for job interruptions)
   * Shows Resume button in chat UI
   */
  addCancelledMessage(
    projectId: string,
    featureName: string,
    jobId: string,
    reason: string,
    message: string,
    userContext?: UserContext
  ): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId);
    
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const cancelledMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      contents: [{
        type: 'cancelled',
        content: message,
        metadata: {
          jobId,
          reason
        }
      }],
      timestamp: new Date().toISOString(),
      jobId
    };
    
    session.messages.push(cancelledMsg);
    
    // Save to file
    this.saveSessionToFile(projectId, featureName, session.messages, userContext);
    
    // Broadcast cancelled message
    this.broadcast(projectId, featureName, {
      type: 'cancelled_message',
      message: cancelledMsg
    });
    
    console.log(`🛑 [ChatService] Added cancelled message: ${messageId} (reason: ${reason})`);
    return messageId;
  }

  /**
   * Get all messages for a session
   */
  getMessages(projectId: string, featureName: string, userContext?: UserContext): ChatMessage[] {
    // ✅ Use getOrCreateSession to ensure file is loaded
    const session = this.getOrCreateSession(projectId, featureName, undefined, userContext);

    const messages = [...session.messages];
    
    // Include current streaming message if exists
    if (session.currentMessage) {
      // ✅ Remove isStreaming flag when sending to frontend
      messages.push({
        ...session.currentMessage,
        isStreaming: undefined
      });
    }

    return messages;
  }

  /**
   * Clear messages for a session
   */
  clearMessages(projectId: string, featureName: string, userContext?: UserContext): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (session) {
      session.messages = [];
      session.currentMessage = undefined;
      
      // Delete file
      const filePath = this.getChatFilePath(projectId, featureName, userContext);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  [ChatService] Deleted chat file for ${key}`);
        }
      } catch (error) {
        console.error(`❌ [ChatService] Failed to delete chat file for ${key}:`, error);
      }
      
      this.broadcast(projectId, featureName, {
        type: 'messages_cleared'
      });
    }
  }

  private broadcast(projectId: string, featureName: string, data: any): void {
    if (this.sseService) {
      this.sseService.broadcast(projectId, featureName, 'chat', data);
    }
  }
}

