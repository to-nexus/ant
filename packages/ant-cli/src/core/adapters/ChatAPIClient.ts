/**
 * ChatAPIClient — thin worker-process facade over `LLMResponseService`.
 *
 * Reads ANT_PROJECT_ID / ANT_FEATURE_NAME / ANT_JOB_ID / ANT_REDIS_URL
 * from the parent-process env, lazily constructs a singleton
 * `LLMResponseService`, and forwards every method call to it. After the
 * chat-SSOT §5 rewrite, this class no longer carries any per-message
 * state (`_mainMessageStarted` / `_mainCurrentMessageId` /
 * `_workerMsgState`) — emission is stateless and addressed by `cardId`,
 * so the worker just routes calls through to the service.
 *
 * Existing callers compile unchanged because the public method
 * signatures are preserved (modulo the legacy `number → string` cardId
 * return type narrowed by the §5 rewrite).
 */

import type { LLMStreamEvent } from '../ports/llm';
import type { LLMResponseService } from '../llm-response';
import type { ChatStatusType } from '../llm-response/types';
import type { ClarifyBlock } from '../../agents/common/clarify/types';
import { logger } from '../../utils/logger';

// ═══════════════════════════════════════════════════════════════════════
// Lazy singleton service init
// ═══════════════════════════════════════════════════════════════════════

let llmResponseService: LLMResponseService | null = null;
let servicePromise: Promise<LLMResponseService | null> | null = null;

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
      component: 'ChatAPIClient',
    });
    return null;
  }

  const projectId = process.env.ANT_PROJECT_ID || '';
  const featureName = process.env.ANT_FEATURE_NAME || '';
  const jobId = process.env.ANT_JOB_ID || '';

  if (!projectId || !featureName || !jobId) {
    console.log(`⚠️ [ChatAPIClient] Missing required env vars - will be disabled`);
    logger.warn(
      `Missing required env vars for ChatAPIClient: projectId=${!!projectId}, featureName=${!!featureName}, jobId=${!!jobId}`,
      { component: 'ChatAPIClient' },
    );
    return null;
  }

  try {
    const { RedisStateStore } = await import('../../infrastructure/state/RedisStateStore');
    const { createLLMResponseServiceWithEnv } = await import('../llm-response');

    const stateStore = new RedisStateStore({ url: redisUrl });

    const featurePath = process.env.ANT_FEATURE_PATH;
    const jobTypeRaw = process.env.ANT_JOB_TYPE as
      | import('@ant/shared').LogJobType
      | undefined;
    const agentRaw = process.env.ANT_AGENT || undefined;

    llmResponseService = createLLMResponseServiceWithEnv(stateStore, {
      projectId,
      featureName,
      jobId,
      jobType: jobTypeRaw,
      agent: agentRaw,
      userEmail: process.env.ANT_USER_EMAIL,
      userId: process.env.ANT_USER_ID,
      organizationId: process.env.ANT_ORG_ID,
      featurePath,
    });

    logger.info(
      `ChatAPIClient initialized with direct Redis: ${projectId}/${featureName} (Job: ${jobId})`,
      { component: 'ChatAPIClient' },
    );

    return llmResponseService;
  } catch (error) {
    console.error(`❌ [ChatAPIClient] Failed to initialize LLMResponseService:`, error);
    logger.error(`Failed to initialize LLMResponseService`, { component: 'ChatAPIClient' }, error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Class
// ═══════════════════════════════════════════════════════════════════════

export class ChatAPIClient {
  private projectId: string;
  private featureName: string;
  private jobId: string;
  private enabled: boolean;

  constructor() {
    this.projectId = process.env.ANT_PROJECT_ID || '';
    this.featureName = process.env.ANT_FEATURE_NAME || '';
    this.jobId = process.env.ANT_JOB_ID || '';
    this.enabled = !!(this.projectId && this.featureName && this.jobId && process.env.ANT_REDIS_URL);
    if (this.enabled) {
      console.log(
        `💬 [ChatAPIClient] Initialized for ${this.projectId}/${this.featureName} (Job: ${this.jobId}) → Direct Redis`,
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Lifecycle (compat — pre-§5 callers expect these to exist)
  // ─────────────────────────────────────────────────────────────────────

  async finalizeMessage(cancelled: boolean = false): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    if (!service) return;
    await service.finalizeMessage(cancelled);
  }

  /**
   * Compat: callers open an assistant message before `sendLLMEvent` / choice
   * cards. Post-§5 emission is stateless (turnId from orchestrator); this is a
   * no-op but keeps ask / triage / visual paths compiling and behaving.
   */
  async startMessage(): Promise<void> {
    if (!this.enabled) return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Chat status
  // ─────────────────────────────────────────────────────────────────────

  async showChatStatus(
    type: ChatStatusType,
    metadata?: Record<string, any>,
  ): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    const service = await getLLMResponseService();
    if (!service) return undefined;
    return service.showChatStatus(type, metadata);
  }

  async removeChatStatus(cardId: string, expectedType?: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    if (!service) return;
    await service.removeChatStatus(cardId, expectedType);
  }

  // ─────────────────────────────────────────────────────────────────────
  // LLM stream events
  // ─────────────────────────────────────────────────────────────────────

  async sendLLMEvent(event: LLMStreamEvent): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    if (!service) return;
    await service.sendLLMEvent(event);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Triage / choice cards
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Send triage choice message with options.
   *
   * Also registers a pending choice in Redis so handleChoice can find
   * it across pod restarts. Pre-§5 behaviour preserved verbatim.
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
    originalDirective?: string,
  ): Promise<void> {
    if (!this.enabled) return;

    const projectId = process.env.ANT_PROJECT_ID || '';
    const featureName = process.env.ANT_FEATURE_NAME || '';

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
            originalDirective,
          );
          console.log(
            `✅ [ChatAPIClient] Registered pending choice for ${projectId}/${featureName}`,
          );
        }
      } catch (error) {
        console.error(`❌ [ChatAPIClient] Failed to register pending choice:`, error);
      }
    }

    await this.showChatStatus('triage_choice' as any, {
      message,
      jobId,
      choiceOptions,
      triageResult,
      originalDirective,
    });
  }

  /**
   * Send a generic choice card to the chat UI. Used for evaluation save
   * prompts and other interactive choices.
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
    const metadata: Record<string, any> = {
      cardType: card.type,
      title: card.title,
      choices: card.choices,
    };
    for (const choice of card.choices) {
      if (choice.data) {
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
   * Supports both text-only (`string`) and image-thumbnail option flavors.
   */
  async sendClarifyCards(blocks: ClarifyBlock[]): Promise<void> {
    if (!this.enabled || blocks.length === 0) return;
    const metadata: Record<string, any> = {
      cardType: 'clarifying',
      title: blocks.length === 1 ? blocks[0].question : `${blocks.length} questions`,
      clarifyBlocks: blocks,
    };
    await this.showChatStatus('choice_card', metadata);
  }

  // ─────────────────────────────────────────────────────────────────────
  // File operations
  // ─────────────────────────────────────────────────────────────────────

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

  async completeFileCreation(
    filePath: string,
    content: string,
    stats?: { diffBeforeLines?: number },
  ): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeFileCreation(filePath, content, stats);
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

  // ─────────────────────────────────────────────────────────────────────
  // Command execution (streaming)
  // ─────────────────────────────────────────────────────────────────────

  async streamCommandOutput(command: string, output: string): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.streamCommandOutput(command, output);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Plan streaming
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Append a plan_content chunk to the pendingCard locked at plan_start.
   *
   * Mirrors the file/command streaming pattern: a single cardId is minted
   * once (via `showChatStatus('plan_generating', …)`) and every subsequent
   * chunk is appended to that card's `streamedOutput` in the TURN_BUFFER.
   *
   * Without this primitive, callers were routing each chunk through
   * `showChatStatus('plan_generating', …)` which fell into
   * `LLMResponseService.showChatStatus`'s mint-new-cardId branch on every
   * call, producing N pendingCard entries that re-surfaced as N separate
   * cards on SSE reconnect / refresh.
   */
  async streamPlanChunk(cardId: string, chunk: string): Promise<void> {
    if (!this.enabled || !cardId || !chunk) return;
    const service = await getLLMResponseService();
    await service?.streamCardOutput(cardId, chunk);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Task-response streaming
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Append a task_response chunk to the pendingCard locked at the first
   * `task_response_streaming` emission. Mirrors `streamPlanChunk` — every
   * chunk lands on the same cardId's `streamedOutput` in the TURN_BUFFER
   * so the chat.jsonl carries a single terminal `task_response` line per
   * card with the full accumulated content (see CommonRenderStrategy).
   */
  async streamTaskResponseChunk(cardId: string, chunk: string): Promise<void> {
    if (!this.enabled || !cardId || !chunk) return;
    const service = await getLLMResponseService();
    await service?.streamCardOutput(cardId, chunk);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Legacy helpers
  // ─────────────────────────────────────────────────────────────────────

  async addExploringStatus(current: number, total: number): Promise<void> {
    await this.showChatStatus('exploring', { filesCount: current, totalFiles: total });
  }

  async addExploredResult(filesCount: number, filesList?: string[]): Promise<void> {
    await this.showChatStatus('explored', { filesCount, filesList });
  }

  async addReadingFile(filePath: string): Promise<string | undefined> {
    return this.showChatStatus('reading', { filePath });
  }

  async addReadComplete(
    filePath: string,
    readingCardId?: string,
    error?: string,
  ): Promise<void> {
    if (error) {
      await this.showChatStatus('read', { filePath, error: true, _mergeIndex: readingCardId });
    } else {
      await this.showChatStatus('read', { filePath, _mergeIndex: readingCardId });
    }
  }

  async addReadingSource(
    filename: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string | undefined> {
    return this.showChatStatus('reading_source', { filePath: filename, startLine, endLine });
  }

  async addReadSourceComplete(
    filename: string,
    readingCardId?: string,
    opts?: {
      error?: string;
      totalLines?: number;
      startLine?: number;
      endLine?: number;
    },
  ): Promise<void> {
    if (opts?.error) {
      await this.showChatStatus('read_source', {
        filePath: filename,
        error: true,
        _mergeIndex: readingCardId,
      });
    } else {
      await this.showChatStatus('read_source', {
        filePath: filename,
        startLine: opts?.startLine,
        endLine: opts?.endLine,
        totalLines: opts?.totalLines,
        _mergeIndex: readingCardId,
      });
    }
  }

  async commandStart(command: string): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    const service = await getLLMResponseService();
    return service?.startCommand(command);
  }

  /**
   * Mark a running command as complete.
   *
   * The `success` argument is retained for interface parity with the
   * pre-chat-SSOT signature but carries no information `exitCode` does
   * not already encode. It is accepted and silently ignored.
   */
  async commandComplete(
    command: string,
    _success: boolean,
    exitCode: number,
    output: string,
  ): Promise<void> {
    if (!this.enabled) return;
    const service = await getLLMResponseService();
    await service?.completeCommand(command, output, exitCode);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Context-loaded
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Notify the user that context has been loaded (eval reports, PRD,
   * design docs, etc.). Unified method for all context-loading
   * notifications across agents.
   */
  async showContextLoaded(items: Array<{ label: string; detail?: string }>): Promise<void> {
    if (!this.enabled || items.length === 0) return;
    await this.showChatStatus('context_loaded', { items });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Module-level utilities
// ═══════════════════════════════════════════════════════════════════════

/**
 * Drain all pending chat broadcast publishes.
 * Call before process exit to prevent losing the last few SSE messages.
 */
export async function drainChatBroadcaster(): Promise<void> {
  if (llmResponseService) {
    await llmResponseService.drainBroadcaster();
  }
}

/**
 * Return the lazily-initialised LLMResponseService for out-of-band callers
 * that need to poke it directly (e.g. `recordUserTurn` propagating a newly
 * generated turnId into the chat.jsonl appender). Does not throw — returns
 * `null` whenever initialisation failed or the worker process lacks the
 * required env vars.
 */
export async function getLLMResponseServiceOrNull(): Promise<LLMResponseService | null> {
  try {
    return await getLLMResponseService();
  } catch {
    return null;
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
