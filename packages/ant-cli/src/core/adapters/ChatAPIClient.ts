/**
 * ChatAPIClient - LLM Response Client for Job Workers
 * 
 * REFACTORED: Now uses direct Redis via LLMResponseService instead of HTTP.
 * This eliminates the HTTP roundtrip to API server for better performance.
 * 
 * Uses environment variables set by parent process:
 * - ANT_REDIS_URL: Redis URL for direct state updates (required)
 * - ANT_PROJECT_ID: Current project ID
 * - ANT_FEATURE_NAME: Current feature name
 * - ANT_JOB_ID: Current job ID
 * - ANT_USER_ID: User ID (optional, for cloud mode)
 * - ANT_ORGANIZATION_ID: Organization ID (optional, for cloud mode)
 * 
 * @see LLMResponseService for the underlying implementation
 */

import type { LLMStreamEvent } from '../ports/llm';
import type { LLMResponseService } from '../llm-response';
import type { ChatStatusType } from '../llm-response/types';
import { logger } from '../../utils/logger';

// Lazy-loaded service instance
let llmResponseService: LLMResponseService | null = null;
let serviceInitialized = false;

/**
 * Lazily initialize LLMResponseService
 * Only creates the service once, when first needed
 */
async function getLLMResponseService(): Promise<LLMResponseService | null> {
  if (serviceInitialized) {
    return llmResponseService;
  }
  
  serviceInitialized = true;
  
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    logger.warn(`ANT_REDIS_URL not set, ChatAPIClient will be disabled`, { 
      component: 'ChatAPIClient' 
    });
    return null;
  }
  
  const projectId = process.env.ANT_PROJECT_ID || '';
  const featureName = process.env.ANT_FEATURE_NAME || '';
  const jobId = process.env.ANT_JOB_ID || '';
  
  if (!projectId || !featureName || !jobId) {
    logger.warn(`Missing required env vars for ChatAPIClient: projectId=${!!projectId}, featureName=${!!featureName}, jobId=${!!jobId}`, { 
      component: 'ChatAPIClient'
    });
    return null;
  }
  
  try {
    // Dynamic import to avoid circular dependencies and bundle size in non-job contexts
    const { RedisStateStore } = await import('../../infrastructure/state/RedisStateStore');
    const { createLLMResponseServiceWithEnv } = await import('../llm-response');
    
    const stateStore = new RedisStateStore({ url: redisUrl });
    
    llmResponseService = createLLMResponseServiceWithEnv(stateStore, {
      projectId,
      featureName,
      jobId,
      userEmail: process.env.ANT_USER_EMAIL,
      userId: process.env.ANT_USER_ID,
      organizationId: process.env.ANT_ORGANIZATION_ID || process.env.ANT_ORG_ID,
      workspacePath: process.env.ANT_WORKSPACE_PATH
    });
    
    logger.info(`ChatAPIClient initialized with direct Redis: ${projectId}/${featureName} (Job: ${jobId})`, {
      component: 'ChatAPIClient'
    });
    
    return llmResponseService;
  } catch (error) {
    logger.error(`Failed to initialize LLMResponseService`, { component: 'ChatAPIClient' }, error);
    return null;
  }
}

export class ChatAPIClient {
  private projectId: string;
  private featureName: string;
  private jobId: string;
  private enabled: boolean;
  private messageStarted: boolean = false;
  private currentMessageId: string | null = null;

  constructor() {
    this.projectId = process.env.ANT_PROJECT_ID || '';
    this.featureName = process.env.ANT_FEATURE_NAME || '';
    this.jobId = process.env.ANT_JOB_ID || '';
    
    // Enabled if all required env vars are present
    this.enabled = !!(this.projectId && this.featureName && this.jobId && process.env.ANT_REDIS_URL);
    
    if (this.enabled) {
      console.log(`💬 [ChatAPIClient] Initialized for ${this.projectId}/${this.featureName} (Job: ${this.jobId}) → Direct Redis`);
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

    const service = await getLLMResponseService();
    if (!service) return null;

    const messageId = await service.startMessage();
    if (messageId) {
      this.messageStarted = true;
      this.currentMessageId = messageId;
      console.log(`✅ [ChatAPIClient] startMessage completed | messageId=${messageId} | jobId=${this.jobId}`);
    }
    
    return messageId;
  }

  /**
   * Show Chat Status Message
   */
  async showChatStatus(
    type: ChatStatusType,
    metadata?: Record<string, any>
  ): Promise<number | undefined> {
    if (!this.enabled) return undefined;

    const service = await getLLMResponseService();
    if (!service) return undefined;

    // Ensure message is active
    if (!this.messageStarted) {
      const hasActive = await service.hasActiveMessage();
      if (!hasActive) {
        const messageId = await this.startMessage();
        if (!messageId) return undefined;
      } else {
        this.messageStarted = true;
      }
    }

    return service.showChatStatus(type, metadata);
  }

  /**
   * Send LLM stream event
   */
  async sendLLMEvent(event: LLMStreamEvent): Promise<void> {
    if (!this.enabled) return;

    const service = await getLLMResponseService();
    if (!service) return;

    // Ensure message is active
    if (!this.messageStarted) {
      const hasActive = await service.hasActiveMessage();
      if (!hasActive) {
        const messageId = await this.startMessage();
        if (!messageId) {
          console.error(`❌ [ChatAPIClient] Cannot send LLM event - no active message`);
          return;
        }
      } else {
        this.messageStarted = true;
      }
    }

    console.log(`📤 [ChatAPIClient] sendLLMEvent | type=${event.type} | messageId=${this.currentMessageId} | jobId=${this.jobId}`);
    await service.sendLLMEvent(event);
  }

  /**
   * Send triage choice message with options
   */
  async sendTriageChoice(
    message: string,
    jobId: string,
    choiceOptions: {
      positive: { label: string; action: string };
      negative: { label: string; action: string };
      fallbackGuide?: string;
    },
    triageResult?: any,
    originalDirective?: string
  ): Promise<void> {
    if (!this.enabled) return;

    // Triage choice requires special handling - use showChatStatus with metadata
    await this.showChatStatus('triage_choice' as any, {
      message,
      jobId,
      choiceOptions,
      triageResult,
      originalDirective
    });
  }

  /**
   * Finalize current message
   */
  async finalizeMessage(cancelled: boolean = false): Promise<void> {
    if (!this.enabled) return;

    const service = await getLLMResponseService();
    if (!service) return;

    await service.finalizeMessage(cancelled);
    this.messageStarted = false;
    this.currentMessageId = null;
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  async startFileCreation(filePath: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.startFileCreation(filePath);
  }

  async streamFileContent(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.streamFileContent(filePath, content);
  }

  async updateFileProgress(filePath: string, phase: 'writing'): Promise<void> {
    if (!this.enabled) return;
    // For 'writing' phase, use streamFileContent with empty content
    // The service handles the phase transition
  }

  async completeFileCreation(filePath: string, content: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeFileCreation(filePath, content);
  }

  async startFileEdit(filePath: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.startFileEdit(filePath);
  }

  async streamFileDiff(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.streamFileDiff(filePath, diffBefore, diffAfter);
  }

  async completeFileEdit(filePath: string, diffBefore: string, diffAfter: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeFileEdit(filePath, diffBefore, diffAfter);
  }

  async startFileDeletion(filePath: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.startFileDeletion(filePath);
  }

  async failFileEdit(filePath: string, errorMessage: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.failFileEdit(filePath, errorMessage);
  }

  async completeFileDeletion(filePath: string, content?: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeFileDeletion(filePath, content);
  }

  async addFileOperation(
    operation: 'edit' | 'create' | 'delete', 
    filePath: string,
    content?: string,
    diffBefore?: string,
    diffAfter?: string
  ): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.addFileOperation(operation, filePath, content, diffBefore, diffAfter);
  }

  // ============================================================================
  // Command Execution
  // ============================================================================

  async startCommand(command: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.startCommand(command);
  }

  async streamCommandOutput(command: string, output: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.streamCommandOutput(command, output);
  }

  async completeCommand(command: string, output: string, exitCode: number): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeCommand(command, output, exitCode);
  }

  async addCommandExecution(command: string, output?: string, exitCode?: number): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.addCommandExecution(command, output, exitCode);
  }

  // ============================================================================
  // Legacy Methods
  // ============================================================================

  async addExploringStatus(current: number, total: number): Promise<void> {
    await this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  async addExploredResult(filesCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, filesList });
  }

  async addReadingFile(filePath: string): Promise<number | undefined> {
    return this.showChatStatus('reading', { filePath });
  }

  async addReadComplete(filePath: string, readingIndex?: number, error?: string): Promise<void> {
    if (error) {
      await this.showChatStatus('read', { filePath, error: true, _mergeIndex: readingIndex });
    } else {
      await this.showChatStatus('read', { filePath, _mergeIndex: readingIndex });
    }
  }

  async commandStart(command: string): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    const service = await getLLMResponseService();
    return service?.startCommand(command);
  }

  async commandComplete(command: string, success: boolean, exitCode: number, output: string, commandIndex?: number): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeCommand(command, output, exitCode);
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
