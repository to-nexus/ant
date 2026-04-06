/**
 * Generate Node
 * 
 * ReAct agent that generates or refines the PRD.
 * 
 * Two output modes:
 *  - Generate mode: LLM outputs full PRD via <file path="outputs/plan/prd-refine.md">...</file> tags.
 *    StreamOrchestrator handles real-time file card streaming.
 *  - Refine mode: LLM uses edit_file tool for targeted search/replace edits on the staging copy.
 *    After all edits, the staging file is read back as the generated document.
 * 
 * Unlike design job which uses writeImmediately=true with gitPort/fileSystem,
 * planner writes to disk after orchestrator.finalize() (single file, no timing difference).
 * There is no separate write node — this node handles streaming, disk write, choice card, and session.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import Handlebars from 'handlebars';
import { PlanGraphState } from '../state';
import { ConversationEntry } from '../../../../../core/types/session';
import { extractTokenUsageFromStreamEvent, accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../common/graph/llmHelpers';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { v4 as uuidv4 } from 'uuid';
import { PLANNER_TOOLS } from '../../tools';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';
import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';
import { logPrompt } from '../../../../../core/utils/promptLogger';
import { compactJob, applyCompactionToConversation } from '../../../../../core/context';
import type { ConversationCompaction } from '../../../../../core/context';
import { PLAN_COMPACTION_THRESHOLD, PLAN_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS, PLAN_CONVERSATION_HISTORY_BUDGET } from '../../../../../core/context';
import { LLM_MAX_TOKENS } from '../../../../common/graph/llmConfig';
import { extractLLMInfo } from '../../../../../core/ports/workflow';

/**
 * Prune conversationHistory (Anthropic-format ReAct messages) via compactRun.
 * Used both before LLM call and before session persist.
 */
async function pruneConversationHistory(
  history: Array<{ role: string; content: any }>,
): Promise<Array<{ role: string; content: any }>> {
  const { compactRun } = await import('../../../../../core/context');
  const { TokenBudgetManager } = await import('../../../../../core/utils/tokenBudget');
  const planTokenManager = new TokenBudgetManager({
    areaBudgets: {
      systemPrompt: 30_000,
      projectContext: 30_000,
      taskContext: 25_000,
      conversationHistory: PLAN_CONVERSATION_HISTORY_BUDGET,
    },
  });
  return compactRun(history as any, planTokenManager).result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Clarify Tag Parser
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ClarifyBlock {
  question: string;
  options: string[];
}

/**
 * Parse <clarify> blocks from LLM response text.
 * 
 * Expected format:
 *   <clarify question="What is the target platform?">
 *   <option>Web application</option>
 *   <option>Mobile app</option>
 *   </clarify>
 */
function parseClarifyBlocks(text: string): ClarifyBlock[] {
  const blocks: ClarifyBlock[] = [];
  const clarifyRegex = /<clarify\s+question="([^"]*)">([\s\S]*?)<\/clarify>/g;
  const optionRegex = /<option>([\s\S]*?)<\/option>/g;
  
  let match;
  while ((match = clarifyRegex.exec(text)) !== null) {
    const question = match[1].trim();
    const body = match[2];
    const options: string[] = [];
    
    let optMatch;
    while ((optMatch = optionRegex.exec(body)) !== null) {
      const optText = optMatch[1].trim();
      if (optText) options.push(optText);
    }
    // Reset optionRegex lastIndex for next clarify block
    optionRegex.lastIndex = 0;
    
    if (question && options.length > 0) {
      blocks.push({ question, options });
    }
  }
  
  return blocks;
}

/**
 * Remove <clarify> blocks from response text for clean chat display.
 */
function stripClarifyBlocks(text: string): string {
  return text.replace(/<clarify\s+question="[^"]*">[\s\S]*?<\/clarify>/g, '').trim();
}

// Template cache
let planBaseTemplate: Handlebars.TemplateDelegate | null = null;
let planRulesContent: string | null = null;

function loadPlanTemplates(): { base: Handlebars.TemplateDelegate; rules: string } {
  if (planBaseTemplate && planRulesContent) {
    return { base: planBaseTemplate, rules: planRulesContent };
  }
  
  const templateDir = path.join(WorkspacePathResolver.getPromptTemplatesPath(), 'planner', 'plan');
  
  const basePath = path.join(templateDir, 'base.md');
  const rulesPath = path.join(templateDir, 'rules.md');
  
  const baseContent = fs.readFileSync(basePath, 'utf-8');
  planRulesContent = fs.readFileSync(rulesPath, 'utf-8');
  planBaseTemplate = Handlebars.compile(baseContent);
  
  return { base: planBaseTemplate, rules: planRulesContent };
}

/**
 * Format conversation entries for the system prompt.
 * Excludes the last user message (which goes into the messages array).
 */
function formatConversationForPrompt(conversation: ConversationEntry[]): string {
  if (!conversation || conversation.length === 0) return '';
  
  return conversation.map(entry => {
    if (entry.role === 'system') {
      return `**[Previous context]**: ${entry.content}`;
    }
    const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
    const artifactNote = entry.metadata?.hasArtifact
      ? ` [produced ${entry.metadata.mode || 'artifact'}]`
      : '';
    // Truncate very long assistant responses (system entries are already compressed)
    const content = entry.role === 'assistant' && entry.content.length > 500
      ? entry.content.substring(0, 500) + '...(truncated)'
      : entry.content;
    return `**${roleLabel}**${artifactNote}: ${content}`;
  }).join('\n\n');
}

function buildSystemPrompt(
  state: PlanGraphState,
  compaction: { entries: ConversationEntry[]; summary?: string; wasCompacted: boolean },
): string {
  const { base, rules } = loadPlanTemplates();
  
  const basePrompt = base({
    isKorean: state.language === 'ko',
    directive: state.directive,
    mode: state.mode,
    existingDocument: state.existingDocument || '',
    hasExistingDocument: !!state.existingDocument,
    evalReport: state.evalReport || '',
    hasEvalReport: !!state.evalReport,
    rubricContent: state.rubricContent || '',
    hasRubric: !!state.rubricContent && !state.evalReport,
    recentTurnSummaries: state.recentTurnSummaries?.join('\n') || '',
    hasRecentTurns: (state.recentTurnSummaries?.length || 0) > 0,
    conversationContext: formatConversationForPrompt(compaction.entries),
    hasConversation: compaction.entries.length > 0,
    conversationSummary: compaction.summary || '',
    hasConversationSummary: !!compaction.summary,
  });
  
  return `${basePrompt}\n\n---\n\n${rules}`;
}

/**
 * Generate node - LLM generates/refines PRD with real-time file streaming
 */
export async function generateNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  // Increment recursion count each time generate is entered (ReAct loop)
  const recursionCount = (state.recursionCount || 0) + 1;
  
  console.log(`\n🤖 [Planner:Generate] ${state.mode === 'generate' ? 'Creating' : 'Refining'} PRD... (iteration ${recursionCount}/${state.recursionLimit})`);
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('generate', state._uiLocale || 'en'), 'generate');
  }
  
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for generate node');
  }

  // Workflow instrumentation (pass recursion info for badge display)
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'generate', 0,
      undefined, extractLLMInfo(llm),
      recursionCount, state.recursionLimit,
    );
  }
  
  // Step 1: async compactJob — LLM-based conversation summary (before sync buildSystemPrompt)
  const allButLast = state.isConversationContinuation && state.conversation?.length
    ? state.conversation.slice(0, -1)
    : [];
  
  let compactionResult: { entries: ConversationEntry[]; summary?: string; wasCompacted: boolean; tokensBefore: number; tokensAfter: number; tokenUsage?: import('@ant/shared').TaskTokenUsage };
  try {
    compactionResult = allButLast.length > 0
      ? await compactJob(allButLast, llm, state.deps!.promptPort!, {
          threshold: PLAN_COMPACTION_THRESHOLD,
          recentWindowSize: PLAN_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        })
      : { entries: [] as ConversationEntry[], wasCompacted: false, tokensBefore: 0, tokensAfter: 0 };
  } catch (err) {
    console.warn(`⚠️ [Planner:Generate] compactJob failed, using raw entries:`, err);
    compactionResult = { entries: allButLast, wasCompacted: false, tokensBefore: 0, tokensAfter: 0 };
  }
  if (compactionResult.tokenUsage) {
    accumulateTokenUsage(state, compactionResult.tokenUsage, { taskLevel: false, jobLevel: true });
  }
  
  const compactionMeta = compactionResult.wasCompacted
    ? { summary: compactionResult.summary!, summarizedCount: allButLast.length - PLAN_COMPACTION_WINDOW }
    : undefined;
  
  // Step 2: buildSystemPrompt is sync
  const systemPrompt = buildSystemPrompt(state, compactionResult);
  
  // ✅ Log prompt structure to debug directory (aligned with code/design agents)
  if (state._httpJobId) {
    try {
      await logPrompt(
        state.featurePath,
        state._httpJobId,
        'plan',
        'generate',
        systemPrompt.length,
        {
          templatePath: 'planner/plan/base',
          usedTemplates: ['planner/plan/base', 'planner/plan/rules'],
          injectedVariables: {
            directive: state.directive || '',
            mode: state.mode,
            hasExistingDocument: !!state.existingDocument,
            hasEvalReport: !!state.evalReport,
            hasConversation: compactionResult.entries.length > 0,
            conversationEntries: compactionResult.entries.length,
            isConversationContinuation: !!state.isConversationContinuation,
            isResume: !!state.isResume,
            recursionCount,
          },
        }
      );
    } catch (err) {
      // Non-critical — don't fail the graph
      console.warn(`⚠️ [Planner:Generate] Failed to log prompt:`, err);
    }
  }
  
  // Build messages (with conversationHistory pruning for cross-Run accumulation)
  const messages: Array<{ role: string; content: any }> = [];
  
  if (state.conversationHistory.length === 0) {
    const userMessage = state.isConversationContinuation && state.conversation?.length
      ? state.conversation[state.conversation.length - 1].content
      : state.directive;
    messages.push({ role: 'user', content: userMessage });
  } else {
    try {
      const prunedHistory = await pruneConversationHistory(state.conversationHistory);
      messages.push(...prunedHistory);
    } catch (err) {
      console.warn(`⚠️ [Planner:Generate] pruneConversationHistory failed, using raw history:`, err);
      messages.push(...state.conversationHistory);
    }
  }
  
  // Setup tools
  const toolDefinitions = PLANNER_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  
  // Setup StreamOrchestrator for real-time <file> tag streaming (same pattern as design job)
  const chatAPI = getChatAPIClient();
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.language === 'ko' ? 'ko' : 'en',
    undefined,   // no gitPort — file write is handled by writeNode
    undefined,   // no fileSystem
    false,       // writeImmediately: false
  );
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles: new Set(),
  });
  
  let responseText = '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  
  const isFirstCall = state.conversationHistory.length === 0;
  
  // Show placeholder status before LLM streaming (same as execute/docGen)
  await chatAPI.showChatStatus('placeholder');
  
  try {
    for await (const event of llm.stream(messages, {
      system: systemPrompt,
      tools: toolDefinitions,
      maxTokens: LLM_MAX_TOKENS.DEFAULT,
      enableThinking: isFirstCall,
    })) {
      if (event.type === 'retry') {
        responseText = '';
        toolCalls.length = 0;
        continue;
      }
      // Pass ALL events to StreamOrchestrator for real-time rendering:
      // - <file> tags → file card streaming (startFileCreation → streamFileContent → completeFileCreation)
      // - thinking → thinking UI
      // - text outside <file> → chat response
      await orchestrator.processEvent(event);
      
      if (event.type === 'text' && event.text) {
        responseText += event.text;
      }
      
      if (event.type === 'tool_use' && event.toolUse) {
        const { id, name, input } = event.toolUse;
        await chatAPI.sendLLMEvent(event);
        toolCalls.push({ id: id || uuidv4(), name, args: input });
      }
      
      if (event.type === 'done') {
        const capturedUsage = extractTokenUsageFromStreamEvent(event);
        if (capturedUsage) {
          accumulateTokenUsage(state, capturedUsage, { taskLevel: false, jobLevel: true });
          upsertPhaseTokenUsage(state, 'generate', capturedUsage);
        }
        
        // ✅ Broadcast tokenUsage + recursion to kanban (enables token/recursion badges)
        if (state.deps?.kanbanUpdate?.updateTaskQueue && state._httpJobId) {
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId,
            null,           // no currentTask (planner has no task queue)
            [],             // empty queue
            [],             // no completed tasks
            recursionCount,
            state.recursionLimit,
            state.tokenUsage,
          );
        }
        if (state.phaseTokenUsages && state.deps?.kanbanUpdate?.updatePhaseTokenUsages) {
          state.deps.kanbanUpdate.updatePhaseTokenUsages(state.phaseTokenUsages);
        }
      }
    }
  } catch (error: any) {
    console.error(`❌ [Planner:Generate] LLM error: ${error.message}`);
    throw error;
  }
  
  // Update conversation history
  const updatedHistory = [...state.conversationHistory];
  
  if (state.conversationHistory.length === 0) {
    // Record the SAME message that was actually sent to the LLM (line 222-224).
    // In continuation mode this is conversation's last user entry (e.g. clarify answers),
    // not state.directive (which may be the original instruction).
    // Without this, conversationHistory becomes inconsistent with what the LLM saw,
    // causing wrong context on subsequent resume.
    const recordedMessage = state.isConversationContinuation && state.conversation?.length
      ? state.conversation[state.conversation.length - 1].content
      : state.directive;
    updatedHistory.push({ role: 'user', content: recordedMessage });
  }
  
  if (toolCalls.length > 0) {
    // Tool call path — finalize orchestrator (keep message open for tool execution)
    await orchestrator.finalize(true);
    
    // Workflow instrumentation
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
    }
    
    updatedHistory.push({
      role: 'assistant',
      content: [
        ...(responseText ? [{ type: 'text', text: responseText }] : []),
        ...toolCalls.map(tc => ({ type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.args })),
      ],
    });
    
    // Update stateSnapshot for SIGTERM handler access
    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversationHistory = updatedHistory;
      state.deps.stateSnapshot.directive = state.directive;
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    
    return {
      conversationHistory: updatedHistory,
      pendingToolCalls: toolCalls,
      tokenUsage: state.tokenUsage,
      recursionCount,
    };
  }
  
  // Final PRD path — finalize orchestrator but keep message open for choice card
  await orchestrator.finalize(true);
  
  // === Check for <clarify> tags in response (planner generate mode) ===
  const clarifyBlocks = parseClarifyBlocks(responseText);
  if (clarifyBlocks.length > 0) {
    console.log(`💬 [Planner:Generate] Found ${clarifyBlocks.length} clarify block(s), sending choice cards`);
    
    // Strip <clarify> tags from response text for clean chat display
    const cleanedResponseText = stripClarifyBlocks(responseText);
    
    // Send all clarify blocks as a single compound card
    try {
      await chatAPI.sendClarifyCards(clarifyBlocks);
    } catch (error) {
      console.warn('⚠️ [Planner:Generate] Failed to send clarify card:', error);
    }
    
    // Save conversation with clarifying response (no PRD yet)
    // Pass updatedHistory for conversationHistory persistence
    const clarifyHistory = [...updatedHistory, { role: 'assistant', content: cleanedResponseText }];
    await saveConversationToSession(state, cleanedResponseText, undefined, clarifyHistory, compactionMeta);
    
    // Finalize message
    await chatAPI.finalizeMessage();
    
    // ✅ Clear estimating activity when clarify ends the graph (no tasks will be created)
    if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
      state.deps.kanbanUpdate.clearEstimatingActivity();
    }
    
    // Workflow instrumentation
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
    }
    
    updatedHistory.push({ role: 'assistant', content: cleanedResponseText });
    
    // Build updated conversation for graph state
    const updatedConversation: ConversationEntry[] = [...(state.conversation || [])];
    if (updatedConversation.length === 0 && state.directive) {
      updatedConversation.push({
        role: 'user',
        content: state.directive,
        timestamp: new Date().toISOString(),
      });
    }
    updatedConversation.push({
      role: 'assistant',
      content: cleanedResponseText,
      timestamp: new Date().toISOString(),
      metadata: {
        hasArtifact: false,
        mode: state.mode,
      },
    });
    
    return {
      conversationHistory: updatedHistory,
      conversation: updatedConversation,
      generatedDocument: undefined,
      pendingToolCalls: [],
      tokenUsage: state.tokenUsage,
      recursionCount,
    };
  }
  
  // Extract file content from registry (populated by StreamOrchestrator via <file> tags)
  const files = orchestrator.getRegistry().getAllFiles();
  const prdFile = files.find(f => f.path.includes('prd-refine'));
  let generatedDocument = prdFile?.content || undefined;
  
  // Edit-based refine: if no <file> output, read the staging file (modified by edit_file tool calls)
  if (!generatedDocument && state.mode === 'refine') {
    const editStagingPath = path.join(state.featurePath, 'outputs/plan/prd-refine.md');
    try {
      generatedDocument = await fsPromises.readFile(editStagingPath, 'utf-8');
      console.log(`📝 [Planner:Generate] Read edited PRD from staging (${generatedDocument.length} chars)`);
    } catch {
      // No staging file — no edits were made
      console.log(`📝 [Planner:Generate] No staging file found (no edits made)`);
    }
  }
  
  // === Post-stream: disk write + choice card + session (same role as design job's docGen) ===
  if (generatedDocument) {
    const stagingPath = path.join(state.featurePath, 'outputs/plan/prd-refine.md');
    
    // Kanban: show "saving" activity
    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
    }
    
    // Write to disk (for <file> tag mode; for edit mode this is a harmless overwrite of same content)
    try {
      await fsPromises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fsPromises.writeFile(stagingPath, generatedDocument, 'utf-8');
      console.log(`📝 [Planner:Generate] Written ${generatedDocument.length} chars to outputs/plan/prd-refine.md`);
    } catch (error: any) {
      console.error(`❌ [Planner:Generate] Failed to write PRD: ${error.message}`);
      throw error;
    }
    
    // ✅ Notify file tree update (Redis Pub/Sub → Realtime Server → SSE)
    if (state.deps?.fileTreeUpdate) {
      const projectId = process.env.ANT_PROJECT_ID;
      const featureName = process.env.ANT_FEATURE_NAME;
      if (!projectId || !featureName) {
        console.warn(`⚠️ [Planner:Generate] Cannot notify file tree: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
      } else {
        try {
          state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
          console.log(`📂 [Planner:Generate] File tree update notified`);
          
          // ✅ Add unseen artifact notification for PRD file
          if ('addUnseenArtifacts' in state.deps.fileTreeUpdate) {
            (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
              projectId, featureName, ['outputs/plan/prd-refine.md']
            );
          }
        } catch (error: any) {
          console.warn(`⚠️ [Planner:Generate] Failed to notify file tree update: ${error.message}`);
        }
      }
    }
    
    // Record session run
    try {
      const session = state.deps?.session;
      if (session) {
        const projectId = session.projectId || process.env.ANT_PROJECT_ID || 'default';
        const featureName = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
        
        const directiveSummary = (state.directive || '').substring(0, 200);
        
        await session.addRun(projectId, featureName, 'plan', {
          runId: 0, // Will be set by adapter
          job: 'plan',
          timestamp: new Date().toISOString(),
          input: {
            type: 'directive',
            source: state.mode === 'refine' ? 'inputs/sources/prd.md' : undefined,
            summary: directiveSummary,
          },
          output: {
            planSummary: `PRD ${state.mode} completed (${generatedDocument.length} chars)`,
          },
        });
      }
    } catch (error: any) {
      console.warn(`⚠️ [Planner:Generate] Failed to record session: ${error.message}`);
    }
    
    // Save conversation to session (multi-turn persistence)
    // Pass updatedHistory for conversationHistory persistence
    const prdHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
    await saveConversationToSession(state, responseText, generatedDocument, prdHistory, compactionMeta);
    
    // Send PRD apply choice card
    try {
      await chatAPI.sendChoiceCard({
        type: 'prd_apply',
        title: state.language === 'ko' 
          ? '📋 PRD를 inputs/sources/prd.md에 적용하시겠습니까?'
          : '📋 Apply this PRD to inputs/sources/prd.md?',
        choices: [
          {
            id: 'apply',
            label: state.language === 'ko' ? '적용' : 'Apply',
            action: 'prd_apply',
          },
          {
            id: 'keep_draft',
            label: state.language === 'ko' ? '초안 유지' : 'Keep as draft',
            action: 'dismiss',
          },
        ],
      });
    } catch (error) {
      console.warn('⚠️ [Planner:Generate] Failed to send choice card:', error);
    }
  }
  
  // Save conversation even when no PRD was generated (e.g. clarifying response)
  if (!generatedDocument) {
    const textOnlyHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
    await saveConversationToSession(state, responseText, undefined, textOnlyHistory, compactionMeta);
  }
  
  // Finalize message (after choice card)
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
  }
  
  updatedHistory.push({ role: 'assistant', content: responseText });
  
  // Build updated conversation for graph state (mirrors what was saved to session)
  const updatedConversation: ConversationEntry[] = [...(state.conversation || [])];
  if (updatedConversation.length === 0 && state.directive) {
    updatedConversation.push({
      role: 'user',
      content: state.directive,
      timestamp: new Date().toISOString(),
    });
  }
  updatedConversation.push({
    role: 'assistant',
    content: responseText,
    timestamp: new Date().toISOString(),
    metadata: {
      hasArtifact: !!generatedDocument,
      artifactPath: generatedDocument ? 'outputs/plan/prd-refine.md' : undefined,
      mode: state.mode,
    },
  });
  
  return {
    conversationHistory: updatedHistory,
    conversation: updatedConversation,
    generatedDocument,
    pendingToolCalls: [],
    tokenUsage: state.tokenUsage,
    recursionCount,
  };
}

/**
 * Save conversation history to session file for multi-turn persistence.
 * 
 * On first run: adds user directive + assistant response.
 * On continuation: adds assistant response (user message was already appended by resolve).
 * 
 * Also saves conversationHistory (full LLM messages) for resume support.
 * On resume, conversationHistory lets the LLM continue the ReAct loop from the exact point.
 */
async function saveConversationToSession(
  state: PlanGraphState,
  responseText: string,
  generatedDocument: string | undefined,
  /** Current conversationHistory including the latest assistant response */
  currentConversationHistory?: Array<{ role: string; content: any }>,
  compaction?: ConversationCompaction,
): Promise<void> {
  const featurePath = state.featurePath;
  const sessionPath = path.join(featurePath, 'sessions/planner/plan.json');
  
  try {
    // Build updated conversation
    const updatedConversation: ConversationEntry[] = [...(state.conversation || [])];
    
    // On first run (no existing conversation), add the initial user message
    if (updatedConversation.length === 0 && state.directive) {
      updatedConversation.push({
        role: 'user',
        content: state.directive,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Add assistant response
    updatedConversation.push({
      role: 'assistant',
      content: responseText,
      timestamp: new Date().toISOString(),
      metadata: {
        hasArtifact: !!generatedDocument,
        artifactPath: generatedDocument ? 'outputs/plan/prd-refine.md' : undefined,
        mode: state.mode,
      },
    });
    
    // Read existing session and update state.conversation
    let sessionData: any = {};
    try {
      sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    } catch {
      // Session file may not exist yet — create structure
      sessionData = {
        sessionId: state._httpJobId || 'plan-session',
        project: process.env.ANT_PROJECT_ID || 'default',
        feature: process.env.ANT_FEATURE_NAME || 'skeleton',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runs: [],
        artifacts: {},
        state: {},
      };
    }
    
    if (!sessionData.state) {
      sessionData.state = {};
    }
    sessionData.state.conversation = applyCompactionToConversation(
      updatedConversation,
      compaction,
      (summary): ConversationEntry => ({
        role: 'system',
        content: summary,
        timestamp: new Date().toISOString(),
        metadata: { chapterSummary: 'Conversation history summary' },
      }),
    );
    sessionData.state.jobId = state._httpJobId || sessionData.state.jobId;
    // ✅ Save additional state for resume support (aligned with design/code learn node pattern)
    sessionData.state.directive = state.directive;
    sessionData.state.overrideDirective = state.overrideDirective;
    sessionData.state.chatSource = state.chatSource;
    sessionData.state.mode = state.mode;
    sessionData.state.tokenUsage = state.tokenUsage;
    sessionData.state.recursionCount = state.recursionCount;
    sessionData.state.recursionLimit = state.recursionLimit;
    if (currentConversationHistory?.length) {
      try {
        sessionData.state.conversationHistory = await pruneConversationHistory(currentConversationHistory);
      } catch {
        sessionData.state.conversationHistory = currentConversationHistory;
      }
    }
    sessionData.updatedAt = new Date().toISOString();
    
    // ✅ Update stateSnapshot for SIGTERM handler access
    if (state.deps?.stateSnapshot) {
      state.deps.stateSnapshot.conversationHistory = currentConversationHistory || state.conversationHistory;
      state.deps.stateSnapshot.directive = state.directive;
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    
    // Write atomically (temp file + rename)
    const sessionDir = path.dirname(sessionPath);
    await fsPromises.mkdir(sessionDir, { recursive: true });
    const tmpPath = `${sessionPath}.tmp`;
    await fsPromises.writeFile(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
    await fsPromises.rename(tmpPath, sessionPath);
    
    console.log(`💬 [Planner:Generate] Conversation saved (${updatedConversation.length} entries, ${currentConversationHistory?.length || 0} history)`);
  } catch (error: any) {
    console.warn(`⚠️ [Planner:Generate] Failed to save conversation: ${error.message}`);
  }
}

/**
 * Router: decide next node after generate
 */
export function routeAfterGenerate(state: PlanGraphState): 'tool' | '__end__' {
  if (state.pendingToolCalls && state.pendingToolCalls.length > 0) {
    return 'tool';
  }
  return '__end__';
}
