/**
 * Prompt Building for CodeGen Node
 * 
 * Extracts from original codeGen.ts:
 * - buildMessages: Build LLM messages with PromptEngine + history
 * - buildRuntimeContext: Build dynamic runtime context
 * - generateFileTree: Generate file tree display
 */

import { ArchitectGraphState } from "../../state";
import { TokenBudgetManager } from "../../../../../../core/utils/tokenBudget";
import { HistoryManager } from "../../../../../../core/utils/historyManager";

/**
 * Build messages for LLM using PromptEngine
 * 
 * ✅ NEW: Integrated token budget management and history pruning
 */
export async function buildMessages(state: ArchitectGraphState): Promise<Array<{
  role: 'user' | 'assistant';
  content: string | any[];
}>> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = [];
  
  // ✅ ALWAYS build fresh prompt with PromptEngine
  // This ensures task constraints are present in EVERY turn, not just the first
  const promptEngine = state.deps?.promptEngine;
  
  if (!promptEngine) {
    throw new Error('[CodeGen] PromptEngine is required but not available in state.deps');
  }
  
  if (!state.currentTask) {
    throw new Error('[CodeGen] currentTask is required but not available in state');
  }
  
  const promptResult = await promptEngine.buildExecutePrompt(
    'code',
    state.context,
    {
      directive: state.directive,
      designDoc: state.design,
      projectCodeContext: state.projectCodeContext,
      referenceCodeContexts: state.referenceCodeContexts,
      lessons: Array.isArray(state.lessons) ? state.lessons : undefined,
      sessionContext: state.sessionContext,
      referenceRequests: state.referenceRequests,
      currentTask: {
        name: state.currentTask.name,
        type: state.currentTask.type,
        priority: state.currentTask.priority,
        description: state.currentTask.description,
      },
    } as any,
    state.codeMode,
    state.currentTask.type
  );
  
  // ✅ Extract base prompt from PromptEngine (templates, rules, profiles)
  const systemMessage = promptResult.formatted.messages.find(m => m.role === 'system' || m.role === 'user');
  
  // ✅ CRITICAL: content can be string OR array (Anthropic format)
  let basePrompt = '';
  if (systemMessage) {
    if (typeof systemMessage.content === 'string') {
      basePrompt = systemMessage.content;
    } else if (Array.isArray(systemMessage.content)) {
      // Anthropic format: [{ type: 'text', text: '...' }]
      const contentArray = systemMessage.content as any[];
      basePrompt = contentArray
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
    }
  }
  
  // ✅ Inject enforcement feedback at the VERY TOP (highest priority for retries)
  let finalPrompt = basePrompt;
  
  if (state.enforcementReason) {
    const enforcementHeader = `════════════════════════════════════════════════════════════════════════════════\n` +
      `⚠️  CRITICAL: PREVIOUS ATTEMPT FAILED - READ THIS FIRST!\n` +
      `════════════════════════════════════════════════════════════════════════════════\n\n` +
      `${state.enforcementReason}\n\n` +
      `YOU MUST FIX THE ABOVE ISSUE BEFORE PROCEEDING!\n` +
      `════════════════════════════════════════════════════════════════════════════════\n\n`;
    
    finalPrompt = enforcementHeader + finalPrompt;
  }
  
  // ✅ Append runtime context (task, planText, file tree) at the end
  const runtimeContext = buildRuntimeContext(state);
  
  const fullContent = `${finalPrompt}${runtimeContext ? '\n\n' + runtimeContext : ''}`;
  
  // ✅ First message: Always the full prompt
  messages.push({
    role: 'user',
    content: fullContent,
  });
  
  // ✅ Add conversation history (if exists)
  // CRITICAL: We need to handle Anthropic's tool calling format correctly
  // - Assistant messages contain tool_use blocks
  // - Following user messages contain tool_result blocks
  // - They must be paired correctly!
  if (state.conversationHistory && state.conversationHistory.length > 0) {
    // ✅ NEW: Prune history to prevent token overflow
    const tokenManager = new TokenBudgetManager();
    const historyManager = new HistoryManager(tokenManager);
    
    // Filter out initial user prompts (replaced by fresh prompt)
    let skipInitialUserMessages = true;
    const filteredHistory: typeof state.conversationHistory = [];
    
    for (const msg of state.conversationHistory) {
      // Once we see an assistant message, start including everything
      if (msg.role === 'assistant') {
        skipInitialUserMessages = false;
      }
      
      // Skip initial user prompts (they're replaced by our fresh prompt)
      // But keep user messages that follow assistant messages (tool results)
      if (skipInitialUserMessages && msg.role === 'user') {
        continue;
      }
      
      // ✅ CRITICAL: Remove code XML tags from assistant messages (causes outdated code issues)
      if (msg.role === 'assistant' && typeof msg.content === 'string') {
        // Remove <edit>, <file>, <append> blocks (keep thinking and text)
        let cleanedContent = msg.content;
        
        // Remove all XML code generation tags
        cleanedContent = cleanedContent.replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '[code edit removed]');
        cleanedContent = cleanedContent.replace(/<file[^>]*>[\s\S]*?<\/file>/g, '[file creation removed]');
        cleanedContent = cleanedContent.replace(/<append[^>]*>[\s\S]*?<\/append>/g, '[code append removed]');
        
        filteredHistory.push({
          ...msg,
          content: cleanedContent
        });
      } else {
        filteredHistory.push(msg);
      }
    }
    
    // ✅ Prune filtered history to fit token budget
    const { prunedHistory } = historyManager.pruneHistory(filteredHistory);
    
    // Add pruned history to messages
    messages.push(...prunedHistory);
    
    // ✅ Check final token budget
    const estimation = tokenManager.checkBudget(messages);
    
    // 🚨 If still over budget, throw error (should not happen with proper pruning)
    if (estimation.isOverBudget) {
      throw new Error(
        `[CodeGen] Token budget exceeded after pruning! ` +
        `${estimation.totalTokens.toLocaleString()} tokens > ` +
        `${tokenManager['config'].maxTokens.toLocaleString()} limit. ` +
        `This should not happen - please report this bug.`
      );
    }
  } else {
    // No history - just check base prompt tokens
    const tokenManager = new TokenBudgetManager();
    tokenManager.checkBudget(messages);
  }
  
  return messages;
}

/**
 * Build runtime context (task, plan, enforcement, file tree)
 * 
 * CRITICAL: This is appended to EVERY user message, even during tool call loops!
 * This ensures task constraints (especially setup task restrictions) are always visible.
 */
export function buildRuntimeContext(state: ArchitectGraphState): string {
  const lines: string[] = [];
  
  if (state.currentTask) {
    lines.push(`# Current Task`);
    lines.push(`**${state.currentTask.name}**`);
    lines.push(``);
    
    // ✅ CRITICAL: Inject planText (concrete implementation plan from Plan node)
    // This is the PRIMARY guidance for execution - description is just the goal
    if (state.planText) {
      lines.push(`**Goal**: ${state.currentTask.description}`);
      lines.push(``);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(`🚨 IMPLEMENTATION PLAN (FOLLOW THIS)`);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(``);
      lines.push(`**The plan below was generated by analyzing your actual codebase.**`);
      lines.push(`**It contains specific file paths, API endpoints, and implementation steps.**`);
      lines.push(`**FOLLOW THIS PLAN - it is more accurate than the abstract goal above.**`);
      lines.push(``);
      lines.push(state.planText);
      lines.push(``);
      lines.push(`────────────────────────────────────────────────────────────────────────────────`);
      lines.push(``);
    } else {
      // No plan available (explain/final-verification tasks)
      lines.push(state.currentTask.description);
      lines.push(``);
    }
  }
  
  if (state.enforcementReason) {
    lines.push(`# Previous Attempt Failed`);
    lines.push(state.enforcementReason);
    lines.push(``);
  }
  
  const fileTree = generateFileTree(state);
  if (fileTree) {
    lines.push(fileTree);
    lines.push(``);
  }
  
  return lines.join('\n');
}

/**
 * Generate file tree for context
 * 
 * Shows files loaded from RAG search for this task.
 * Self-healing will handle file operation errors automatically.
 */
export function generateFileTree(state: ArchitectGraphState): string | null {
  const files = state.projectCodeContext?.filePaths || [];
  
  if (files.length === 0) {
    return null;
  }
  
  const lines = [
    '════════════════════════════════════════════════════════════════════════════════',
    '📋 Files in Context',
    '════════════════════════════════════════════════════════════════════════════════',
    '',
  ];
  
  const dirs: Record<string, string[]> = {};
  for (const file of files) {
    const parts = file.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const filename = parts[parts.length - 1];
    
    if (!dirs[dir]) {
      dirs[dir] = [];
    }
    dirs[dir].push(filename);
  }
  
  // Format tree
  for (const [dir, filenames] of Object.entries(dirs).sort()) {
    lines.push(`📁 ${dir}/`);
    for (const filename of filenames.sort()) {
      lines.push(`   📄 ${filename}`);
    }
    lines.push('');
  }
  
  return lines.join('\n');
}
