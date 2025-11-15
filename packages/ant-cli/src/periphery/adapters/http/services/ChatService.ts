/**
 * ChatService - Manages chat messages and SSE broadcasting
 * 
 * Handles real-time chat message streaming to frontend
 * Persists chat history to {project}/{feature}/chat.json
 */

import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { LLMStreamEvent } from '../../llm/types';
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
     // File Operations - Real-time streaming
     | 'file_creating' | 'file_writing' | 'file_create'
     | 'file_editing' | 'file_updating' | 'file_edit'
     | 'file_deleting' | 'file_delete'
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
    // LLM metadata
    model?: string;         // LLM model used
    provider?: string;      // LLM provider (e.g., 'anthropic', 'openai')
    blockStart?: boolean;   // For thinking: marks <thinking> tag opened (new block)
    durationMs?: number;    // For thinking: duration in milliseconds
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
  activeFileOperation?: {  // Track active file being written
    filePath: string;
    contentIndex: number;  // Index of file content in currentMessage.contents
  };
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
        messages: fileSession?.messages || []
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
   */
  addContentToCurrentMessage(
    projectId: string, 
    featureName: string, 
    content: MessageContent
  ): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (!session || !session.currentMessage) {
      console.warn('⚠️  [ChatService] No current message to add content to');
      return;
    }

    // ✅ Simple: only check last content in currentMessage
    // (placeholder is always shown right before LLM API call, so it's always in the same message)
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
    
    const CHAT_STATUS_TYPES = new Set([
      'placeholder', 
      'exploring', 'explored', 
      'grepping', 'grepped', 
      'reading', 'read'
      // NOTE: 'thinking' is NOT a Chat Status - it's general content!
      // - Chat Status = progress indicator (placeholder, exploring, grepping, etc.)
      // - thinking = LLM thought process (collapsible content block)
      // When thinking arrives, Chat Status (if any) will HIDE via Case 3
    ]);
    
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
      return;
    }
    
    // Case 2: Explicit MERGE patterns
    // - placeholder → any (placeholder는 모든 후속 content로 MERGE)
    // - exploring → exploring/explored (progress update/completion)
    // - grepping → grepping/grepped (progress update/completion)
    // - reading → reading/read (progress update/completion)
    const shouldMergeChatStatus = (
      // placeholder → anything (MERGE all!)
      isLastPlaceholder ||
      // Progress → Progress (same task update)
      (lastContent?.type === 'exploring' && content.type === 'exploring') ||
      (lastContent?.type === 'grepping' && content.type === 'grepping') ||
      (lastContent?.type === 'reading' && content.type === 'reading') ||
      // Progress → Completed (same task completion)
      (lastContent?.type === 'exploring' && content.type === 'explored') ||
      (lastContent?.type === 'grepping' && content.type === 'grepped') ||
      (lastContent?.type === 'reading' && content.type === 'read')
    );
    
    if (shouldMergeChatStatus && lastContent) {
      console.log(`[ChatService] ✅ MERGED: ${lastContent.type} → ${content.type}`);
      
      lastContent.type = content.type;
      // ✅ Special case: placeholder → thinking = clear placeholder content
      // thinking 블록은 LLM content를 받아야 하므로, placeholder content를 지워야 함
      if (isLastPlaceholder && content.type === 'thinking') {
        lastContent.content = '';  // Clear placeholder content, wait for LLM thinking
        console.log(`[ChatService] 🧹 Cleared placeholder content for thinking block`);
      } else {
        lastContent.content = content.content;
      }
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      // ✅ CRITICAL: Start tracking thinking block duration when placeholder → thinking (with blockStart)
      if (isLastPlaceholder && content.type === 'thinking' && content.metadata?.blockStart) {
        session.thinkingStartTime = Date.now();
        session.lastThinkingContentIndex = lastContentIndex;  // Use existing index (merged content)
      }
      
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: lastContentIndex,
        content: lastContent
      });
      return;
    }
    
    // Case 2.5: Direct duplicate of completed Chat Status = IGNORE
    // e.g., grepped → grepped, explored → explored, read → read
    // But grepped → grepping → grepped = NEW grepped (independent search)
    const completedChatStatusTypes = new Set(['grepped', 'explored', 'read']);
    const shouldIgnore = 
      lastContent &&
      completedChatStatusTypes.has(lastContent.type) &&
      lastContent.type === content.type;  // ✅ Only ignore direct duplicates
    
    if (shouldIgnore) {
      console.log(`[ChatService] ⏭️ IGNORED: ${content.type} → ${content.type} (direct duplicate)`);
      return;  // Do nothing, discard silently
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
          thinkingContent.metadata = {
            ...thinkingContent.metadata,
            durationMs
          };
          
          // Broadcast duration update
          this.broadcast(projectId, featureName, {
            type: 'content_update',
            messageId: session.currentMessage.id,
            contentIndex: session.lastThinkingContentIndex,
            content: thinkingContent
          });
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
      return;
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
      } else {
        // No in-progress content found, add as new
        session.currentMessage.contents.push(content);
        
        // Broadcast content add
        this.broadcast(projectId, featureName, {
          type: 'content_add',
          messageId: session.currentMessage.id,
          content
        });
      }
    } else {
      // Different type or has metadata → add as new content block
      if (isNewThinkingBlock) {
        console.log('[ChatService] 🆕 New thinking block (<thinking> opened)');
      }
      
      session.currentMessage.contents.push(content);

      // Broadcast content add
      this.broadcast(projectId, featureName, {
        type: 'content_add',
        messageId: session.currentMessage.id,
        content
      });
    }
  }

  /**
   * Finalize current streaming message
   */
  finalizeCurrentMessage(projectId: string, featureName: string): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (!session || !session.currentMessage) {
      return;
    }

    // ✅ Calculate duration for last thinking block if exists
    if (session.thinkingStartTime && session.lastThinkingContentIndex !== undefined) {
      const durationMs = Date.now() - session.thinkingStartTime;
      const thinkingContent = session.currentMessage.contents[session.lastThinkingContentIndex];
      
      if (thinkingContent && thinkingContent.type === 'thinking') {
        thinkingContent.metadata = {
          ...thinkingContent.metadata,
          durationMs
        };
        
        // Broadcast duration update
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: session.lastThinkingContentIndex,
          content: thinkingContent
        });
      }
      
      // Reset tracking
      session.thinkingStartTime = undefined;
      session.lastThinkingContentIndex = undefined;
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
        this.addContentToCurrentMessage(projectId, featureName, {
          type: 'thinking',
          content: event.content
        });
        break;

      case 'text':
        // ✅ If there's an active file operation, stream text into the file card
        if (session?.activeFileOperation && session.currentMessage) {
          const fileContent = session.currentMessage.contents[session.activeFileOperation.contentIndex];
          if (fileContent && (fileContent.type === 'file_writing' || fileContent.type === 'file_updating')) {
            // Update file content in real-time
            fileContent.content += event.content;
            
            // Broadcast update
            this.broadcast(projectId, featureName, {
              type: 'content_update',
              messageId: session.currentMessage.id,
              contentIndex: session.activeFileOperation.contentIndex,
              content: fileContent
            });
          }
        } else {
          // No active file operation - add as regular text
          this.addContentToCurrentMessage(projectId, featureName, {
            type: 'text',
            content: event.content
          });
        }
        break;

      case 'done':
        // Don't finalize here - let the caller decide when to finalize
        break;

      case 'error':
        this.addContentToCurrentMessage(projectId, featureName, {
          type: 'text',
          content: `❌ Error: ${event.content}`
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
    
    // ✅ Update existing in-progress content instead of adding new ones
    if (session?.currentMessage && phase) {
      const inProgressTypes = {
        'create': ['file_creating', 'file_writing'],
        'edit': ['file_editing', 'file_updating'],
        'delete': ['file_deleting']
      };
      
      const typesToFind = inProgressTypes[operation] || [];
      const existingIndex = session.currentMessage.contents.findIndex(c => 
        typesToFind.includes(c.type) && 
        c.metadata?.filePath === filePath
      );
      
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
        session.currentMessage.contents[existingIndex] = {
          type: newType,
          content: content !== undefined ? content : session.currentMessage.contents[existingIndex].content,
          metadata: {
            filePath,
            diffBefore,
            diffAfter,
            timestamp: new Date().toISOString()
          }
        };
        
        // Broadcast content update
        this.broadcast(projectId, featureName, {
          type: 'content_update',
          messageId: session.currentMessage.id,
          contentIndex: existingIndex,
          content: session.currentMessage.contents[existingIndex]
        });
        
        // ✅ Track active file operation for real-time streaming
        if (phase === 'writing' || phase === 'updating') {
          session.activeFileOperation = { filePath, contentIndex: existingIndex };
        } else if (phase === 'complete') {
          // Clear active file operation
          if (session.activeFileOperation?.filePath === filePath) {
            session.activeFileOperation = undefined;
          }
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
    
    // ✅ Track active file operation for real-time streaming
    if (session && session.currentMessage) {
      if (phase === 'writing' || phase === 'updating') {
        // Set active file operation (text events will stream into this file card)
        const contentIndex = session.currentMessage.contents.length - 1;
        session.activeFileOperation = { filePath, contentIndex };
      }
    }
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

