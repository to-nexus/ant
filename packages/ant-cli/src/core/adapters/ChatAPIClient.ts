/**
 * ChatAPIClient - HTTP client for sending LLM events to Chat UI
 * 
 * Uses environment variables set by parent process:
 * - ANT_SERVER_PORT: Server port (default: 4100)
 * - ANT_PROJECT_ID: Current project ID
 * - ANT_FEATURE_NAME: Current feature name
 * - ANT_JOB_ID: Current job ID
 */

import type { LLMStreamEvent } from '../ports/llm';

export class ChatAPIClient {
  private serverPort: string;
  private projectId: string;
  private featureName: string;
  private jobId: string;
  private baseUrl: string;
  private enabled: boolean;
  private messageStarted: boolean = false;  // ✅ Track if message is active

  constructor() {
    this.serverPort = process.env.ANT_SERVER_PORT || '4100';
    this.projectId = process.env.ANT_PROJECT_ID || '';
    this.featureName = process.env.ANT_FEATURE_NAME || '';
    this.jobId = process.env.ANT_JOB_ID || '';
    this.baseUrl = `http://localhost:${this.serverPort}/api/projects/${this.projectId}/features/${this.featureName}/chat`;
    
    // Only enabled if all required env vars are present
    this.enabled = !!(this.projectId && this.featureName && this.jobId);
    
    if (this.enabled) {
      console.log(`💬 [ChatAPIClient] Initialized for ${this.projectId}/${this.featureName} (Job: ${this.jobId})`);
    }
  }

  /**
   * Build HTTP headers with authentication (Cloud mode)
   * @private
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    
    // ✅ Add user email for Cloud mode authentication
    const userEmail = process.env.ANT_USER_EMAIL;
    if (userEmail) {
      headers['x-user-email'] = userEmail;
    }
    
    return headers;
  }

  /**
   * Check if a message is currently active
   */
  hasActiveMessage(): boolean {
    return this.messageStarted;
  }
  
  /**
   * Ensure message is active, start new one if needed
   * Returns true if message is active (or successfully started), false otherwise
   */
  private async ensureMessageActive(): Promise<boolean> {
    if (!this.enabled) return false;
    
    try {
      // Check if server has an active message
      const response = await fetch(`${this.baseUrl}/has-active-message`, {
        method: 'GET',
        headers: this.getHeaders()
      });
      
      if (response.ok) {
        const { hasActive } = await response.json();
        if (hasActive) {
          return true;  // Message is active on server
        }
      }
      
      // No active message on server, need to start new one
      console.log('[ChatAPIClient] ⚠️  No active message on server, starting new message...');
      this.messageStarted = false;  // Reset flag to allow starting new message
      const messageId = await this.startMessage();
      return messageId !== null;
    } catch (error) {
      // Fallback: if endpoint doesn't exist, trust the messageStarted flag
      return this.messageStarted;
    }
  }

  /**
   * Start a new assistant message
   */
  async startMessage(): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const response = await fetch(`${this.baseUrl}/start-message`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ jobId: this.jobId })
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to start message: ${response.statusText}`);
        return null;
      }

      const { messageId } = await response.json();
      this.messageStarted = true;  // ✅ Mark message as active
      return messageId;
    } catch (error) {
      console.error('❌ [ChatAPIClient] Error starting message:', error);
      return null;
    }
  }

  

  /**
   * Show Chat Status Message
   * 
   * Rules:
   * - Content text is auto-generated based on type
   * - If message not started: start message first
   * - Auto-merge or disappear based on next content type (handled by ChatService)
   */
  async showChatStatus(
    type: 'placeholder' | 'exploring' | 'explored' | 'retrieving' | 'retrieved' | 'grepping' | 'grepped' | 'reading' | 'read' | 'thinking' | 'indexing' | 'indexed' | 'analyzing' | 'analyzed' | 'storing' | 'stored' | 'searching_reference' | 'searched_reference' | 'tool_action',
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      // ✅ CRITICAL: Always verify server state, not just local flag
      // The messageStarted flag can be out of sync with server's currentMessage state
      // This happens when a message is finalized between nodes (e.g., decompose → plan)
      if (!await this.ensureMessageActive()) {
        console.error(`❌ [ChatAPIClient] Cannot show chat status - no active message`);
        return;  // ✅ Don't proceed if message is not active
      }

      // ✅ Auto-generate content text based on type
      let content: string;
      switch (type) {
        case 'placeholder':
          content = 'Planning next moves...';
          break;
        case 'exploring':
          const exploringFiles = metadata?.filesCount ?? 0;
          const exploringTotal = metadata?.totalFiles ?? 0;
          content = exploringFiles > 0 
            ? `Exploring: ${exploringFiles}/${exploringTotal} files`
            : 'Exploring: codebase...';
          break;
        case 'explored':
          const exploredFiles = metadata?.filesCount ?? 0;
          const exploredError = metadata?.error;
          const exploredContent = metadata?.content;
          if (exploredError) {
            content = `❌ Explore Failed: ${exploredError}`;
          } else if (exploredContent) {
            content = exploredContent;
          } else {
            content = `Explored: ${exploredFiles} files with uncommitted changes`;
          }
          break;
        case 'retrieving':
          const retrievingQuery = metadata?.query ?? '';
          content = retrievingQuery 
            ? `Retrieving from Vector DB: '${retrievingQuery}'...`
            : 'Retrieving from Vector DB...';
          break;
        case 'retrieved':
          const retrievedFiles = metadata?.filesCount ?? 0;
          const retrievedError = metadata?.error;
          const retrievedContent = metadata?.content;
          
          if (retrievedError) {
            content = `❌ Retrieval Failed: ${retrievedError}`;
          } else if (retrievedContent) {
            // Custom content (e.g., stack trace files display)
            content = retrievedContent;
          } else {
            // Default: Vector DB only
            content = `Retrieved: ${retrievedFiles} files from Vector DB`;
          }
          break;
        case 'grepping':
          const greppingKeywords = metadata?.keywords ?? [];
          const greppingQuery = metadata?.query ?? '';
          if (greppingKeywords.length > 0) {
            content = `Searching local files: ${greppingKeywords.slice(0, 3).join(', ')}${greppingKeywords.length > 3 ? '...' : ''}`;
          } else if (greppingQuery) {
            content = `Searching local files: '${greppingQuery}'`;
          } else {
            content = 'Searching local files...';
          }
          break;
        case 'grepped':
          const greppedFiles = metadata?.filesCount ?? 0;
          const greppedError = metadata?.error;
          if (greppedError) {
            content = `❌ Local Search Failed: ${greppedError}`;
          } else {
            content = `Grepped: ${greppedFiles} files`;
          }
          break;
        case 'reading':
          const readingPath = metadata?.filePath ?? '';
          content = readingPath 
            ? `Reading: ${readingPath}...`
            : 'Reading: file...';
          break;
        case 'read':
          const readPath = metadata?.filePath ?? '';
          const readError = metadata?.error;
          if (readError) {
            content = `❌ Read Failed: ${readPath || readError}`;
          } else {
            content = readPath ? `✅ Read: ${readPath}` : '✅ Read: file';
          }
          break;
        case 'thinking':
          content = '';  // Empty content, will be filled by LLM tokens
          break;
        case 'indexing':
          const indexingMsg = metadata?.message ?? 'codebase...';
          content = `Indexing: ${indexingMsg}`;
          break;
        case 'indexed':
          const filesIndexed = metadata?.filesIndexed ?? 0;
          const chunks = metadata?.chunks ?? 0;
          const tokens = metadata?.tokens ?? 0;
          const duration = metadata?.duration ? `in ${(metadata.duration / 1000).toFixed(1)}s` : '';
          const indexedError = metadata?.error;
          if (indexedError) {
            content = `❌ Indexing Failed: ${indexedError}`;
          } else {
            content = `✅ Indexed: ${filesIndexed} files → ${chunks} chunks (~${Math.round(tokens / 1000)}K tokens) ${duration}`.trim();
          }
          break;
        case 'analyzing':
          const analyzingMsg = metadata?.message ?? 'files...';
          content = `Analyzing: ${analyzingMsg}`;
          break;
        case 'analyzed':
          const analyzedContent = metadata?.content;
          const keywordCount = metadata?.keywordCount ?? 0;
          const stackTraceCount = metadata?.stackTraceCount ?? 0;
          const semanticCount = metadata?.semanticCount ?? 0;
          const analyzedError = metadata?.error;
          
          if (analyzedError) {
            content = `❌ Analysis Failed: ${analyzedError}`;
          } else if (analyzedContent) {
            // Custom content provided (keyword display)
            content = analyzedContent;
          } else if (keywordCount > 0) {
            content = `🔑 Keywords Generated: ${stackTraceCount} stack trace + ${semanticCount} semantic`;
          } else {
            content = `✅ Analyzed: ${metadata?.filesCount ?? 0} files`;
          }
          break;
        case 'storing':
          const storingMsg = metadata?.message ?? 'lesson...';
          content = `Storing: ${storingMsg}`;
          break;
        case 'stored':
          const storedMsg = metadata?.message;
          const storedError = metadata?.error;
          if (storedError) {
            content = `❌ Storage Failed: ${storedError}`;
          } else {
            content = `✅ Stored: ${storedMsg ?? 'lesson successfully'}`;
          }
          break;
        case 'searching_reference':
          const refProject = metadata?.project ?? 'reference project';
          const refQuery = metadata?.query ?? '';
          content = refQuery 
            ? `🔍 Searching ${refProject}: "${refQuery}"...`
            : `🔍 Searching ${refProject}...`;
          break;
        case 'searched_reference':
          const searchedProject = metadata?.project ?? 'reference project';
          const searchedFiles = metadata?.filesCount ?? 0;
          const searchedError = metadata?.error;
          if (searchedError) {
            content = `❌ Search Failed (${searchedProject}): ${searchedError}`;
          } else {
            content = `✅ Found ${searchedFiles} file(s) in ${searchedProject}`;
          }
          break;
        default:
          content = 'Processing...';
      }

      // Send Chat Status Message directly to chat service (NOT an LLM event!)
      console.log(`🌐 [ChatAPIClient] HTTP POST → /add-content (type: ${type})`);
      console.log(`   Content: "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);
      console.log(`   Metadata keys: ${Object.keys(metadata || {}).join(', ')}`);
      
      const requestBody = {
        content: {
          type,
          content,
          metadata: {
            provider: 'system',
            timestamp: new Date().toISOString(),
            ...metadata
          }
        }
      };
      
      const response = await fetch(`${this.baseUrl}/add-content`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] HTTP ${response.status} ${response.statusText}`);
        console.error(`   Request body:`, JSON.stringify(requestBody, null, 2));
        return;
      }
      
      console.log(`✅ [ChatAPIClient] HTTP 200 OK (type: ${type})`);
    } catch (error) {
      console.error('❌ [ChatAPIClient] Error showing chat status:', error);
    }
  }

  /**
   * Send LLM stream event
   */
  async sendLLMEvent(event: LLMStreamEvent): Promise<void> {
    if (!this.enabled) return;

    try {
      const response = await fetch(`${this.baseUrl}/llm-event`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ event })
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to send LLM event: ${response.statusText}`);
      }
    } catch (error) {
      // Silently fail - don't break agent execution if chat fails
    }
  }

  /**
   * Finalize current message
   */
  async finalizeMessage(): Promise<void> {
    if (!this.enabled) return;

    try {
      const response = await fetch(`${this.baseUrl}/finalize-message`, {
        method: 'POST',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to finalize message: ${response.statusText}`);
      }
      
      this.messageStarted = false;  // ✅ Reset flag after finalize
    } catch (error) {
      console.error('❌ [ChatAPIClient] Error finalizing message:', error);
      this.messageStarted = false;  // ✅ Reset even on error
    }
  }

  // ============================================================================
  // File Operations - Real-time streaming support
  // ============================================================================

  /**
   * Start file creation (header only, no content yet)
   */
  async startFileCreation(filePath: string): Promise<void> {
    if (!this.enabled) return;
    try {
      // ✅ Ensure message is active before starting file operation
      if (!await this.ensureMessageActive()) {
        console.error(`❌ [ChatAPIClient] Cannot start file creation - no active message for: ${filePath}`);
        return;
      }
      
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'creating', operation: 'create', filePath })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Stream file content during writing (real-time updates)
   */
  async streamFileContent(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'writing', operation: 'create', filePath, content })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Update file progress to 'writing' state (intermediate progress indication)
   */
  async updateFileProgress(filePath: string, phase: 'writing'): Promise<void> {
    if (!this.enabled) return;
    try {
      // ✅ Ensure message is active
      if (!await this.ensureMessageActive()) {
        console.error(`❌ [ChatAPIClient] Cannot update file progress - no active message for: ${filePath}`);
        return;
      }
      
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase, operation: 'create', filePath })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Complete file creation (final state, collapsible)
   */
  async completeFileCreation(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    try {
      // ✅ CRITICAL: Ensure message is active before completing file operation
      // This handles the case where messageStarted=true but currentMessage was finalized
      if (!await this.ensureMessageActive()) {
        console.error(`❌ [ChatAPIClient] Cannot complete file creation - no active message for: ${filePath}`);
        return;
      }
      
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'complete', operation: 'create', filePath, content })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Start file edit (header only)
   */
  async startFileEdit(filePath: string): Promise<void> {
    if (!this.enabled) return;
    try {
      // ✅ Ensure message is active before starting file operation
      if (!await this.ensureMessageActive()) {
        console.error(`❌ [ChatAPIClient] Cannot start file edit - no active message for: ${filePath}`);
        return;
      }
      
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'editing', operation: 'edit', filePath })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Stream file diff during update (real-time)
   */
  async streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'updating', operation: 'edit', filePath, diffBefore, diffAfter })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Complete file edit (final state, collapsible)
   */
  async completeFileEdit(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'complete', operation: 'edit', filePath, diffBefore, diffAfter })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Start file deletion
   */
  async startFileDeletion(filePath: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'deleting', operation: 'delete', filePath })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Complete file deletion
   */
  async completeFileDeletion(filePath: string, content?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'complete', operation: 'delete', filePath, content })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Legacy: Add file operation notification with content (backward compatibility)
   * New code should use start/stream/complete methods for real-time effects
   */
  async addFileOperation(
    operation: 'edit' | 'create' | 'delete', 
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const response = await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ 
          phase: 'complete',  // Legacy calls are treated as complete
          operation, 
          filePath, 
          content,      // ✅ Full file content (for create/delete)
          diffBefore,   // ✅ Before content (for edit)
          diffAfter     // ✅ After content (for edit)
        })
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to add file operation: ${response.statusText}`);
      }
    } catch (error) {
      // Silently fail
    }
  }

  // ============================================================================
  // Command Execution - Real-time streaming support
  // ============================================================================

  /**
   * Start command execution (header only)
   */
  async startCommand(command: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/command-execution`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'running', command })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Stream command output (real-time)
   */
  async streamCommandOutput(command: string, output: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/command-execution`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'streaming', command, output })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Complete command execution (final state, collapsible)
   */
  async completeCommand(command: string, output: string, exitCode: number): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/command-execution`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'complete', command, output, exitCode })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Legacy: Add command execution notification (backward compatibility)
   * New code should use start/stream/complete methods for real-time effects
   */
  async addCommandExecution(command: string, output?: string, exitCode?: number): Promise<void> {
    if (!this.enabled) return;

    try {
      const response = await fetch(`${this.baseUrl}/command-execution`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ phase: 'complete', command, output, exitCode })
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to add command execution: ${response.statusText}`);
      }
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Add exploration status (scanning codebase)
   * @deprecated Use showChatStatus('exploring', { filesCount, totalFiles }) instead
   */
  async addExploringStatus(current: number, total: number): Promise<void> {
    await this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  /**
   * Add exploration result (scan complete)
   */
  async addExploredResult(filesCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, filesList });
  }

  /**
   * Add reading file status
   */
  async addReadingFile(filePath: string): Promise<void> {
    await this.showChatStatus('reading', { filePath });
  }

  /**
   * Add file read complete
   */
  async addReadComplete(filePath: string, error?: string): Promise<void> {
    if (error) {
      // Error case: signal error without including the message (showChatStatus will format it)
      await this.showChatStatus('read', { filePath, error: true });
    } else {
      // Success case
      await this.showChatStatus('read', { filePath });
    }
  }

  /**
   * Complete command execution
   */
  async commandComplete(command: string, success: boolean, exitCode: number, output: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/command-execution`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ command, output, exitCode, phase: 'complete' })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Check if client is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let chatAPIClient: ChatAPIClient | null = null;

export function getChatAPIClient(): ChatAPIClient {
  if (!chatAPIClient) {
    chatAPIClient = new ChatAPIClient();
  }
  return chatAPIClient;
}

