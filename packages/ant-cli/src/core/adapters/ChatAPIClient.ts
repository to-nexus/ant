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
 * - ANT_USER_ID: User ID (for cloud mode)
 * - ANT_ORG_ID: Organization ID (for cloud mode)
 * 
 * @see LLMResponseService for the underlying implementation
 */

import type { LLMStreamEvent } from '../ports/llm';
import type { LLMResponseService } from '../llm-response';
import type { ChatStatusType } from '../llm-response/types';
import { logger } from '../../utils/logger';
import { getWorkerScope } from '../parallel/workerScope';

// Lazy-loaded service instance (Promise-based to prevent race conditions)
let llmResponseService: LLMResponseService | null = null;
let servicePromise: Promise<LLMResponseService | null> | null = null;

/**
 * Lazily initialize LLMResponseService
 * Uses a shared Promise so concurrent callers wait for the same initialization.
 */
async function getLLMResponseService(): Promise<LLMResponseService | null> {
  if (llmResponseService) return llmResponseService;
  if (!servicePromise) {
    servicePromise = initializeLLMResponseService();
  }
  return servicePromise;
}

async function initializeLLMResponseService(): Promise<LLMResponseService | null> {
  console.log(`🔍 [ChatAPIClient] getLLMResponseService() called - initializing...`);
  
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    console.log(`⚠️ [ChatAPIClient] ANT_REDIS_URL not set, will be disabled`);
    logger.warn(`ANT_REDIS_URL not set, ChatAPIClient will be disabled`, { 
      component: 'ChatAPIClient' 
    });
    return null;
  }
  
  console.log(`✅ [ChatAPIClient] ANT_REDIS_URL is set`);
  
  const projectId = process.env.ANT_PROJECT_ID || '';
  const featureName = process.env.ANT_FEATURE_NAME || '';
  const jobId = process.env.ANT_JOB_ID || '';
  
  console.log(`🔍 [ChatAPIClient] Env vars: projectId=${projectId}, featureName=${featureName}, jobId=${jobId}`);
  
  if (!projectId || !featureName || !jobId) {
    console.log(`⚠️ [ChatAPIClient] Missing required env vars - will be disabled`);
    logger.warn(`Missing required env vars for ChatAPIClient: projectId=${!!projectId}, featureName=${!!featureName}, jobId=${!!jobId}`, { 
      component: 'ChatAPIClient'
    });
    return null;
  }
  
  try {
    console.log(`🔍 [ChatAPIClient] Importing RedisStateStore...`);
    const { RedisStateStore } = await import('../../infrastructure/state/RedisStateStore');
    
    console.log(`🔍 [ChatAPIClient] Importing createLLMResponseServiceWithEnv...`);
    const { createLLMResponseServiceWithEnv } = await import('../llm-response');
    
    console.log(`🔍 [ChatAPIClient] Creating RedisStateStore with url...`);
    const stateStore = new RedisStateStore({ url: redisUrl });
    
    const featurePath = process.env.ANT_FEATURE_PATH;
    console.log(`🔍 [ChatAPIClient] featurePath=${featurePath}`);
    
    console.log(`🔍 [ChatAPIClient] Creating LLMResponseService...`);
    llmResponseService = createLLMResponseServiceWithEnv(stateStore, {
      projectId,
      featureName,
      jobId,
      userEmail: process.env.ANT_USER_EMAIL,
      userId: process.env.ANT_USER_ID,
      organizationId: process.env.ANT_ORG_ID,
      featurePath
    });
    
    console.log(`✅ [ChatAPIClient] LLMResponseService created successfully`);

    try {
      const { registerChatFlusher } = await import('../../composition/gracefulShutdown');
      registerChatFlusher(llmResponseService!);
    } catch {
      // Non-critical — graceful shutdown may not be available in all contexts
    }
    
    logger.info(`ChatAPIClient initialized with direct Redis: ${projectId}/${featureName} (Job: ${jobId})`, {
      component: 'ChatAPIClient'
    });
    
    return llmResponseService;
  } catch (error) {
    console.error(`❌ [ChatAPIClient] Failed to initialize LLMResponseService:`, error);
    logger.error(`Failed to initialize LLMResponseService`, { component: 'ChatAPIClient' }, error);
    return null;
  }
}

export class ChatAPIClient {
  private projectId: string;
  private featureName: string;
  private jobId: string;
  private enabled: boolean;
  private _mainMessageStarted: boolean = false;
  private _mainCurrentMessageId: string | null = null;
  private _workerMsgState = new Map<number, { started: boolean; messageId: string | null }>();

  private get messageStarted(): boolean {
    const scope = getWorkerScope();
    if (scope) return this._workerMsgState.get(scope.workerId)?.started ?? false;
    return this._mainMessageStarted;
  }

  private set messageStarted(v: boolean) {
    const scope = getWorkerScope();
    if (scope) {
      let ws = this._workerMsgState.get(scope.workerId);
      if (!ws) { ws = { started: false, messageId: null }; this._workerMsgState.set(scope.workerId, ws); }
      ws.started = v;
    } else {
      this._mainMessageStarted = v;
    }
  }

  private get currentMessageId(): string | null {
    const scope = getWorkerScope();
    if (scope) return this._workerMsgState.get(scope.workerId)?.messageId ?? null;
    return this._mainCurrentMessageId;
  }

  private set currentMessageId(v: string | null) {
    const scope = getWorkerScope();
    if (scope) {
      let ws = this._workerMsgState.get(scope.workerId);
      if (!ws) { ws = { started: false, messageId: null }; this._workerMsgState.set(scope.workerId, ws); }
      ws.messageId = v;
    } else {
      this._mainCurrentMessageId = v;
    }
  }

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
   * Remove a chat status UI element by its content index
   */
  async removeChatStatus(contentIndex: number, expectedType?: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    if (!service) return;
    service.removeChatStatus(contentIndex, expectedType);
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

    // Minimal logging - only log first event to confirm streaming started
    // (text events are very frequent, logging each one is too noisy)
    await service.sendLLMEvent(event);
  }

  /**
   * Send triage choice message with options
   * ✅ CRITICAL: Also registers pending choice in Redis for cross-Pod/restart recovery
   */
  async sendTriageChoice(
    message: string,
    jobId: string,
    choiceOptions: {
      positive: { label: string; action: string };
      negative: { label: string; action: string };
      neutral?: { label: string; action: string };
      fallbackGuide?: string;
    },
    triageResult?: any,
    originalDirective?: string
  ): Promise<void> {
    if (!this.enabled) return;

    const projectId = process.env.ANT_PROJECT_ID || '';
    const featureName = process.env.ANT_FEATURE_NAME || '';

    // ✅ CRITICAL: Register pending choice in Redis for handleChoice to find
    // This was missing after the refactoring, causing "가이드 제공됨" instead of redirect
    if (triageResult && projectId && featureName) {
      try {
        const choiceModule = await import('../../infrastructure/choice');
        const choiceService = await choiceModule.getChoiceService();
        
        if (choiceService) {
          await choiceService.registerPendingChoiceAsync(
            jobId,
            projectId,
            featureName,
            triageResult,
            originalDirective
          );
          console.log(`✅ [ChatAPIClient] Registered pending choice for ${projectId}/${featureName}`);
        }
      } catch (error) {
        console.error(`❌ [ChatAPIClient] Failed to register pending choice:`, error);
        // Continue anyway - UI will show choice, but backend might not find it
      }
    }

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

  async failFileCreation(filePath: string, errorMessage: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.failFileCreation(filePath, errorMessage);
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

  async addReadingSource(filename: string, startLine?: number, endLine?: number): Promise<number | undefined> {
    return this.showChatStatus('reading_source', { filePath: filename, startLine, endLine });
  }

  async addReadSourceComplete(filename: string, readingIndex?: number, opts?: {
    error?: string; totalLines?: number; startLine?: number; endLine?: number;
  }): Promise<void> {
    if (opts?.error) {
      await this.showChatStatus('read_source', { filePath: filename, error: true, _mergeIndex: readingIndex });
    } else {
      await this.showChatStatus('read_source', {
        filePath: filename,
        startLine: opts?.startLine,
        endLine: opts?.endLine,
        totalLines: opts?.totalLines,
        _mergeIndex: readingIndex,
      });
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

  // ============================================================================
  // Context Loaded Notifications
  // ============================================================================

  /**
   * Notify the user that context has been loaded (eval reports, PRD, design docs, etc.)
   * Unified method for all context-loading notifications across agents.
   */
  async showContextLoaded(items: Array<{ label: string; detail?: string }>): Promise<void> {
    if (!this.enabled || items.length === 0) return;
    await this.showChatStatus('context_loaded', { items });
  }

  // ============================================================================
  // Choice Cards
  // ============================================================================

  /**
   * Send a generic choice card to the chat UI.
   * Used for evaluation save prompts and other interactive choices.
   */
  async sendChoiceCard(card: {
    type: string;
    title: string;
    choices: Array<{
      id: string;
      label: string;
      action: string;
      data?: Record<string, any>;
    }>;
  }): Promise<void> {
    if (!this.enabled) return;
    // Map card.type to cardType to avoid conflict with MessageContent.type
    // Include card data in metadata for UI to access
    const metadata: Record<string, any> = {
      cardType: card.type,
      title: card.title,
      choices: card.choices,
    };
    // Spread choice data into metadata for UI access
    for (const choice of card.choices) {
      if (choice.data) {
        // For eval_save: evalType, response (mapped to evalContent)
        if (choice.data.evalType) metadata.evalType = choice.data.evalType;
        if (choice.data.response) metadata.evalContent = choice.data.response;
        if (choice.data.featurePath) metadata.featurePath = choice.data.featurePath;
        if (choice.data.specFile) metadata.specFile = choice.data.specFile;
      }
    }
    await this.showChatStatus('choice_card', metadata);
  }

  /**
   * Send a compound clarifying question card to the chat UI.
   *
   * Supports two option flavors in the same block:
   *   - `string`        → text-only option (planner, design)
   *   - `ImageOption`    → thumbnail + label (visual draft selection)
   *
   * `allowRegenerate` adds a "regenerate" button (visual only).
   */
  async sendClarifyCards(blocks: Array<{
    question: string;
    options: Array<string | { label: string; imagePath: string; thumbnailPath: string; value: string }>;
    allowFreeText?: boolean;
    allowRegenerate?: boolean;
  }>): Promise<void> {
    if (!this.enabled || blocks.length === 0) return;
    const metadata: Record<string, any> = {
      cardType: 'clarifying',
      title: blocks.length === 1 ? blocks[0].question : `${blocks.length} questions`,
      clarifyBlocks: blocks,
    };
    await this.showChatStatus('choice_card', metadata);
  }

  /**
   * Check if client is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Drain all pending chat broadcast publishes.
 * Call before process exit to prevent losing the last few SSE messages.
 */
export async function drainChatBroadcaster(): Promise<void> {
  if (llmResponseService) {
    await llmResponseService.drainBroadcaster();
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
