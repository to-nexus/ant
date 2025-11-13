/**
 * ChatAPIClient - HTTP client for sending LLM events to Chat UI
 * 
 * Uses environment variables set by parent process:
 * - ANT_SERVER_PORT: Server port (default: 4100)
 * - ANT_PROJECT_ID: Current project ID
 * - ANT_FEATURE_NAME: Current feature name
 * - ANT_JOB_ID: Current job ID
 */

import type { LLMStreamEvent } from '../../periphery/adapters/llm/types';

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
   * Check if a message is currently active
   */
  hasActiveMessage(): boolean {
    return this.messageStarted;
  }

  /**
   * Start a new assistant message
   */
  async startMessage(): Promise<string | null> {
    if (!this.enabled) return null;

    try {
      const response = await fetch(`${this.baseUrl}/start-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    type: 'placeholder' | 'exploring' | 'explored' | 'grepping' | 'grepped' | 'reading' | 'read' | 'thinking',
    metadata?: Record<string, any>
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      // Ensure message is started
      if (!this.messageStarted) {
        const messageId = await this.startMessage();
        if (!messageId) {
          console.error(`❌ [ChatAPIClient] Cannot show chat status - message start failed`);
          return;  // ✅ Don't proceed if message start failed
        }
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
            ? `Exploring codebase... ${exploringFiles}/${exploringTotal} files`
            : 'Exploring codebase...';
          break;
        case 'explored':
          const exploredFiles = metadata?.filesCount ?? 0;
          const tokensCount = metadata?.tokensCount ?? 0;
          content = `Explored ${exploredFiles} files (~${Math.ceil(tokensCount / 1000)}K tokens)`;
          break;
        case 'grepping':
          const query = metadata?.query ?? '';
          content = query 
            ? `Searching for '${query}'...`
            : 'Searching...';
          break;
        case 'grepped':
          const greppedFiles = metadata?.filesCount ?? 0;
          const strategy = metadata?.strategy ?? 'unknown';
          content = `Found in ${greppedFiles} files (strategy: ${strategy})`;
          break;
        case 'reading':
          const readingPath = metadata?.filePath ?? '';
          content = readingPath 
            ? `Reading ${readingPath}...`
            : 'Reading file...';
          break;
        case 'read':
          const readPath = metadata?.filePath ?? '';
          content = readPath 
            ? `Read ${readPath}`
            : 'Read file';
          break;
        case 'thinking':
          content = '';  // Empty content, will be filled by LLM tokens
          break;
        default:
          content = 'Processing...';
      }

      // Send Chat Status Message directly to chat service (NOT an LLM event!)
      const response = await fetch(`${this.baseUrl}/add-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: {
            type,
            content,
            metadata: {
              provider: 'system',
              timestamp: new Date().toISOString(),
              ...metadata
            }
          }
        })
      });

      if (!response.ok) {
        console.error(`❌ [ChatAPIClient] Failed to show chat status: ${response.statusText}`);
        return;
      }
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' }
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
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'writing', operation: 'create', filePath, content })
      });
    } catch (error) { /* Silently fail */ }
  }

  /**
   * Complete file creation (final state, collapsible)
   */
  async completeFileCreation(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`${this.baseUrl}/file-operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
  async addExploredResult(filesCount: number, tokensCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, tokensCount, filesList });
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
  async addReadComplete(filePath: string): Promise<void> {
    await this.showChatStatus('read', { filePath });
  }

  /**
   * Add grepping status (searching codebase)
   * @deprecated Use showChatStatus('grepping', { query, filesCount, totalFiles }) instead
   */
  async addGreppingStatus(query: string, current: number, total: number): Promise<void> {
    await this.showChatStatus('grepping', { query, filesCount: current, totalFiles: total });
  }

  /**
   * Add grep result (search complete)
   */
  async addGreppedResult(
    query: string,
    filesCount: number,
    strategy: string,
    filesList?: string[]
  ): Promise<void> {
    await this.showChatStatus('grepped', { query, filesCount, strategy, filesList });
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

