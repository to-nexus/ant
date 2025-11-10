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
      return messageId;
    } catch (error) {
      console.error('❌ [ChatAPIClient] Error starting message:', error);
      return null;
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
      // console.error('❌ [ChatAPIClient] Error sending LLM event:', error);
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
    } catch (error) {
      console.error('❌ [ChatAPIClient] Error finalizing message:', error);
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
   */
  async addExploringStatus(current: number, total: number): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/exploration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'exploring', current, total })
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Add exploration result (scan complete)
   */
  async addExploredResult(filesCount: number, tokensCount: number, filesList?: string[]): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/exploration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'explored', filesCount, tokensCount, filesList })
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Add reading file status
   */
  async addReadingFile(filePath: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/file-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'reading', filePath })
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Add file read complete
   */
  async addReadComplete(filePath: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/file-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read', filePath })
      });
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Add grepping status (searching codebase)
   */
  async addGreppingStatus(query: string, current: number, total: number): Promise<void> {
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/grep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'grepping', query, current, total })
      });
    } catch (error) {
      // Silently fail
    }
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
    if (!this.enabled) return;

    try {
      await fetch(`${this.baseUrl}/grep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'grepped', query, filesCount, strategy, filesList })
      });
    } catch (error) {
      // Silently fail
    }
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

