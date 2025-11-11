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

export interface ChatMessageContent {
  type: 'thinking' | 'text' 
     // File Operations - Real-time streaming
     | 'file_creating' | 'file_writing' | 'file_create'
     | 'file_editing' | 'file_updating' | 'file_edit'
     | 'file_deleting' | 'file_delete'
     // Command Execution - Real-time streaming
     | 'command_running' | 'command_streaming' | 'command'
     // Exploration & Analysis
     | 'exploring' | 'explored' | 'reading' | 'read' | 'grepping' | 'grepped';
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
    placeholder?: boolean;  // ✅ Mark as placeholder for replacement
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  contents: ChatMessageContent[];
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
}

export class ChatService {
  private workspaceRoot: string;
  private sessions = new Map<string, ChatSession>();
  private sseService?: SSEService;

  constructor(workspaceRoot: string, sseService?: SSEService) {
    this.workspaceRoot = workspaceRoot;
    this.sseService = sseService;
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
  private getChatFilePath(projectId: string, featureName: string): string {
    return path.join(this.workspaceRoot, projectId, featureName, 'sessions', 'chat.json');
  }

  /**
   * Load chat session from file
   */
  private loadSessionFromFile(projectId: string, featureName: string): ChatSessionFile | null {
    const filePath = this.getChatFilePath(projectId, featureName);
    
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
  private saveSessionToFile(projectId: string, featureName: string, messages: ChatMessage[]): void {
    const filePath = this.getChatFilePath(projectId, featureName);
    
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Load existing file to preserve createdAt
      let createdAt = new Date().toISOString();
      const existing = this.loadSessionFromFile(projectId, featureName);
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
  getOrCreateSession(projectId: string, featureName: string, jobId?: string): ChatSession {
    const key = this.getSessionKey(projectId, featureName);
    
    // Check memory cache first
    if (!this.sessions.has(key)) {
      // Load from file if exists
      const fileSession = this.loadSessionFromFile(projectId, featureName);
      
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
  addUserMessage(projectId: string, featureName: string, content: string, jobId?: string): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId);
    
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
    this.saveSessionToFile(projectId, featureName, session.messages);
    
    // Broadcast new user message
    this.broadcast(projectId, featureName, {
      type: 'user_message',
      message: userMessage
    });
    
    console.log(`💬 [ChatService] Added user message: ${messageId}`);
    return messageId;
  }

  /**
   * Start a new assistant message (for streaming)
   */
  startAssistantMessage(projectId: string, featureName: string, jobId: string): string {
    const session = this.getOrCreateSession(projectId, featureName, jobId);
    
    // ✅ If there's already a current message being streamed, reuse it (avoid duplicates)
    if (session.currentMessage && session.currentMessage.isStreaming) {
      console.log(`[ChatService] ♻️  Reusing existing streaming message: ${session.currentMessage.id}`);
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
    content: ChatMessageContent
  ): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (!session || !session.currentMessage) {
      console.warn('⚠️  [ChatService] No current message to add content to');
      return;
    }

    // ✅ Smart append: merge consecutive content of same type
    const existingContents = session.currentMessage.contents;
    const lastContent = existingContents[existingContents.length - 1];
    
    // If same type as last content (thinking or text), append or replace
    // ✅ CRITICAL: Don't check !content.metadata for file operations (they need metadata)
    const isFileOperation = content.type.includes('file_') || content.type.includes('command');
    const canMerge = lastContent && 
        lastContent.type === content.type && 
        (content.type === 'thinking' || content.type === 'text') &&
        (!content.metadata || !isFileOperation);  // Allow metadata for thinking/text
    
    if (canMerge) {
      // ✅ REPLACE placeholder with actual LLM thinking
      const isPlaceholder = lastContent.metadata?.placeholder === true;
      
      if (content.type === 'thinking' && isPlaceholder) {
        console.log(`[ChatService] 🔄 Replacing placeholder with LLM thinking (${content.content.substring(0, 50)}...)`);
        // Replace placeholder entirely (don't append)
        lastContent.content = content.content;
        // Keep metadata from incoming content (provider, timestamp, etc.)
        lastContent.metadata = { ...content.metadata, placeholder: undefined };
      } else {
        console.log(`[ChatService] ➕ Appending to existing ${content.type} (adding ${content.content.length} chars)`);
        // Append to existing content
        lastContent.content += content.content;
      }
      
      // Broadcast content update (merged or replaced)
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: existingContents.length - 1,
        content: lastContent
      });
    } 
    // ✅ UPDATE progress content types (exploring, grepping, reading)
    else if (lastContent && 
             lastContent.type === 'exploring' && content.type === 'exploring') {
      // Update progress content in-place
      lastContent.content = content.content;
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      // Broadcast content update
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: existingContents.length - 1,
        content: lastContent
      });
    }
    else if (lastContent && 
             lastContent.type === 'grepping' && content.type === 'grepping') {
      // Update grepping progress in-place
      lastContent.content = content.content;
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      // Broadcast content update
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: existingContents.length - 1,
        content: lastContent
      });
    }
    else if (lastContent && 
             lastContent.type === 'reading' && content.type === 'reading') {
      // Update reading progress in-place
      lastContent.content = content.content;
      lastContent.metadata = { ...lastContent.metadata, ...content.metadata };
      
      // Broadcast content update
      this.broadcast(projectId, featureName, {
        type: 'content_update',
        messageId: session.currentMessage.id,
        contentIndex: existingContents.length - 1,
        content: lastContent
      });
    } else if (content.metadata?.filePath && 
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

    session.currentMessage.isStreaming = false;
    session.messages.push(session.currentMessage);
    
    // Save to file
    this.saveSessionToFile(projectId, featureName, session.messages);
    
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
        let newType: ChatMessageContent['type'];
        
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
    let type: ChatMessageContent['type'];
    
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
    let type: ChatMessageContent['type'];
    
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
   * Add exploration status (exploring/explored)
   */
  addExploration(
    projectId: string,
    featureName: string,
    status: 'exploring' | 'explored',
    data: {
      current?: number;
      total?: number;
      filesCount?: number;
      tokensCount?: number;
      filesList?: string[];
    }
  ): void {
    const content = status === 'exploring'
      ? `Exploring codebase... ${data.current || 0}/${data.total || 0} files`
      : `Explored ${data.filesCount || 0} files (~${Math.ceil((data.tokensCount || 0) / 1000)}K tokens)`;

    this.addContentToCurrentMessage(projectId, featureName, {
      type: status,
      content,
      metadata: {
        filesCount: data.filesCount,
        totalFiles: status === 'exploring' ? data.total : undefined,
        tokensCount: data.tokensCount,
        filesList: data.filesList,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Add file reading status (reading/read)
   */
  addFileRead(
    projectId: string,
    featureName: string,
    status: 'reading' | 'read',
    filePath: string
  ): void {
    const content = status === 'reading'
      ? `Reading ${filePath}...`
      : `Read ${filePath}`;

    this.addContentToCurrentMessage(projectId, featureName, {
      type: status,
      content,
      metadata: {
        filePath,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Add grep status (grepping/grepped)
   */
  addGrep(
    projectId: string,
    featureName: string,
    status: 'grepping' | 'grepped',
    query: string,
    data: {
      current?: number;
      total?: number;
      filesCount?: number;
      strategy?: string;
      filesList?: string[];
    }
  ): void {
    const content = status === 'grepping'
      ? `Searching for "${query}"... ${data.current || 0}/${data.total || 0} files`
      : `Found in ${data.filesCount || 0} files (strategy: ${data.strategy || 'unknown'})`;

    this.addContentToCurrentMessage(projectId, featureName, {
      type: status,
      content,
      metadata: {
        filesCount: data.filesCount,
        totalFiles: status === 'grepping' ? data.total : undefined,
        strategy: data.strategy,
        filesList: data.filesList,
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
  getMessages(projectId: string, featureName: string): ChatMessage[] {
    // ✅ Use getOrCreateSession to ensure file is loaded
    const session = this.getOrCreateSession(projectId, featureName);

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
  clearMessages(projectId: string, featureName: string): void {
    const key = this.getSessionKey(projectId, featureName);
    const session = this.sessions.get(key);
    
    if (session) {
      session.messages = [];
      session.currentMessage = undefined;
      
      // Delete file
      const filePath = this.getChatFilePath(projectId, featureName);
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

