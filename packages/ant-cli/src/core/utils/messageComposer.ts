/**
 * MessageComposer — Assembles messages[] for a single LLM invoke.
 *
 * Inputs:  Turn 1 initial blocks (CacheBlockMapper output) + prior turn history
 * Outputs: messages[] ready for LLM API
 *
 * Handles: initial-user-skip, compaction, auto-compact-summary caching,
 *          multi-stage budget recovery, trailing user guarantee.
 */

import type { CacheableContent, MessageContentBlock } from '../ports/llm';
import type { ConversationMessage } from '../context/types';
import { TokenBudgetManager } from './tokenBudget';
import { compactRun as compactAndPruneHistory } from '../context';

export interface ComposeOptions {
  /** Turn 1 content blocks (CacheBlockMapper output). */
  initialBlocks: CacheableContent[];
  /** Prior turn history — LLM request/response exchanges within the same task. */
  priorTurns?: ConversationMessage[];
  /** Assistant message content transform (e.g. cleanFileContentFromResponse). */
  cleanAssistantContent?: (content: string) => string;
  /** Trailing user message text (default: "Continue."). */
  trailingUserMessage?: string;
  /** Token budget manager override. Defaults to new TokenBudgetManager(). */
  tokenManager?: TokenBudgetManager;
  /**
   * Multi-stage budget recovery (code execute pattern).
   *
   * stage 1: standard compactAndPruneHistory (always runs)
   * stage 2: aggressive re-compact (when aggressiveParams provided)
   * stage 3: Block stub replacement (when stubBlockIndex provided)
   *
   * When omitted, only stage 1 runs; overflow throws.
   */
  budgetRecovery?: {
    aggressiveParams?: {
      autoCompactThreshold: number;
      autoCompactHotTail: number;
    };
    stubBlockIndex?: number;
    stubText?: string;
  };
}

export interface ComposeResult {
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContentBlock[] }>;
}

type ComposedMessage = { role: 'user' | 'assistant'; content: MessageContentBlock[] };

/**
 * Compose messages[] for a single LLM invoke.
 *
 * Synchronous — compactAndPruneHistory, checkBudget are all sync.
 */
export function composeMessages(options: ComposeOptions): ComposeResult {
  const {
    initialBlocks,
    priorTurns,
    cleanAssistantContent,
    trailingUserMessage = 'Continue.',
    tokenManager = new TokenBudgetManager(),
    budgetRecovery,
  } = options;

  const messages: ComposedMessage[] = [
    { role: 'user', content: initialBlocks as MessageContentBlock[] },
  ];

  if (priorTurns && priorTurns.length > 0) {
    composeWithHistory(messages, priorTurns, {
      cleanAssistantContent,
      tokenManager,
      budgetRecovery,
    });
  } else {
    composeWithoutHistory(messages, tokenManager, budgetRecovery);
  }

  // Trailing user guarantee — Anthropic requires conversation to end with user.
  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: trailingUserMessage }],
    });
  }

  return { messages };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// With history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function composeWithHistory(
  messages: ComposedMessage[],
  priorTurns: ConversationMessage[],
  opts: {
    cleanAssistantContent?: (content: string) => string;
    tokenManager: TokenBudgetManager;
    budgetRecovery?: ComposeOptions['budgetRecovery'];
  },
): void {
  const { cleanAssistantContent, tokenManager, budgetRecovery } = opts;

  // Step a: Skip initial user messages until first assistant
  const filtered = filterInitialUserMessages(priorTurns, cleanAssistantContent);

  // Step b-c: Compact & prune
  const { result: prunedTurns, wasCompacted } = compactAndPruneHistory(filtered, tokenManager);

  // Step d: Convert to MessageContentBlock[] and append
  appendTurns(messages, prunedTurns, wasCompacted);

  // Step e: Budget check + recovery
  let estimation = tokenManager.checkBudget(messages as any);

  if (estimation.isOverBudget && budgetRecovery?.aggressiveParams) {
    // Stage 2: aggressive re-compact
    console.warn(
      `⚠️  [MessageComposer] Over budget after standard pruning (${estimation.totalTokens.toLocaleString()} tokens). Attempting aggressive reduction...`,
    );

    const { result: aggressiveHistory } = compactAndPruneHistory(
      filtered,
      tokenManager,
      budgetRecovery.aggressiveParams,
    );

    const firstMsg = messages[0];
    messages.length = 0;
    messages.push(firstMsg);
    appendTurns(messages, aggressiveHistory, false);

    estimation = tokenManager.checkBudget(messages as any);
  }

  if (estimation.isOverBudget && budgetRecovery?.stubBlockIndex != null) {
    // Stage 3: Replace block at stubBlockIndex with stub text
    applyBlockStub(messages, budgetRecovery.stubBlockIndex, budgetRecovery.stubText);
    estimation = tokenManager.checkBudget(messages as any);
  }

  if (estimation.isOverBudget) {
    throw new Error(
      `[MessageComposer] Token budget exceeded after all recovery stages! ` +
      `${estimation.totalTokens.toLocaleString()} tokens.`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Without history
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function composeWithoutHistory(
  messages: ComposedMessage[],
  tokenManager: TokenBudgetManager,
  budgetRecovery?: ComposeOptions['budgetRecovery'],
): void {
  const estimation = tokenManager.checkBudget(messages as any);

  if (estimation.isOverBudget && budgetRecovery?.stubBlockIndex != null) {
    applyBlockStub(messages, budgetRecovery.stubBlockIndex, budgetRecovery.stubText);
    const retryEstimation = tokenManager.checkBudget(messages as any);
    if (retryEstimation.isOverBudget) {
      throw new Error(
        `[MessageComposer] Token budget exceeded even without history! ` +
        `${retryEstimation.totalTokens.toLocaleString()} tokens.`,
      );
    }
    console.log(`✅ [MessageComposer] Budget recovered: ${retryEstimation.totalTokens.toLocaleString()} tokens`);
    return;
  }

  if (estimation.isOverBudget) {
    throw new Error(
      `[MessageComposer] Token budget exceeded (no history, no recovery configured)! ` +
      `${estimation.totalTokens.toLocaleString()} tokens.`,
    );
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function filterInitialUserMessages(
  turns: ConversationMessage[],
  cleanAssistant?: (content: string) => string,
): ConversationMessage[] {
  let skipInitialUser = true;
  const filtered: ConversationMessage[] = [];

  for (const msg of turns) {
    if (msg.role === 'assistant') {
      skipInitialUser = false;
    }
    if (skipInitialUser && msg.role === 'user') continue;

    if (cleanAssistant && msg.role === 'assistant' && typeof msg.content === 'string') {
      filtered.push({ ...msg, content: cleanAssistant(msg.content) });
    } else {
      filtered.push(msg);
    }
  }

  return filtered;
}

function appendTurns(
  messages: ComposedMessage[],
  turns: ConversationMessage[],
  wasCompacted: boolean,
): void {
  let isFirstMsg = true;
  for (const msg of turns) {
    if (typeof msg.content === 'string') {
      const shouldCache =
        wasCompacted && isFirstMsg && msg.role === 'assistant' && msg.content.startsWith('[Auto-compacted:');
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: [
          {
            type: 'text',
            text: msg.content,
            ...(shouldCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
          },
        ],
      });
    } else {
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content as MessageContentBlock[],
      });
    }
    isFirstMsg = false;
  }
}

function applyBlockStub(
  messages: ComposedMessage[],
  blockIndex: number,
  stubText?: string,
): void {
  if (!messages[0] || !Array.isArray(messages[0].content)) return;
  const blocks = messages[0].content;
  if (blocks.length > blockIndex && blocks[blockIndex].type === 'text') {
    const original = (blocks[blockIndex] as { text: string }).text;
    console.warn(
      `⚠️  [MessageComposer] Stripping block at index ${blockIndex} (${original.length.toLocaleString()} chars)...`,
    );
    (blocks[blockIndex] as any).text =
      stubText ??
      `[Context omitted to fit token budget — original size: ${original.length.toLocaleString()} chars]`;
  }
}
