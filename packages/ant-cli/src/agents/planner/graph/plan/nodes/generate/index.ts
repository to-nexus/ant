/**
 * Generate Node
 * 
 * ReAct agent that generates or refines documents.
 * Target and staging paths are derived from resolvedAction.target (no hardcoded paths).
 * 
 * Two output modes:
 *  - Generate mode: LLM outputs full document via <file path="{stagingPath}">...</file> tags.
 *  - Refine mode: LLM uses edit_file tool for targeted edits on the staging copy.
 * 
 * There is no separate write node — this node handles streaming, disk write, choice card, and session.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { PlanGraphState, getPlanMode } from '../../state';
import { ConversationEntry } from '../../../../../../core/types/session';
import { extractTokenUsageFromStreamEvent, accumulateTokenUsage, upsertPhaseTokenUsage } from '../../../../../common/graph/llmHelpers';
import { getChatAPIClient } from '../../../../../../core/adapters/ChatAPIClient';
import { v4 as uuidv4 } from 'uuid';
import { PLANNER_TOOLS, PLANNER_EXPLAIN_TOOLS } from '../tools';
import { getEstimatingLabel } from '../../../../../common/graph/timing/estimatingLabels';
import { StreamOrchestrator } from '../../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../../core/streaming/strategies/CommonRenderStrategy';
import { buildAssistantMessage } from '../../../../../common/tool/messageBuilder';
import { logPrompt } from '../../../../../../core/utils/promptLogger';
import { compactJob } from '../../../../../../core/context';
import { PLAN_COMPACTION_THRESHOLD, PLAN_COMPACTION_WINDOW, COMPACTION_MAX_OUTPUT_TOKENS } from '../../../../../../core/context';
import { LLM_MAX_TOKENS } from '../../../../../common/graph/llmConfig';
import { extractLLMInfo } from '../../../../../../core/ports/workflow';

import { buildSystemPrompt, getStagingPath, formatConversationForPrompt } from './promptBuilder';
import { parseClarifyBlocks, stripClarifyBlocks } from './clarify';
import { saveConversationToSession, pruneConversationHistory } from './sessionWriter';

/**
 * Generate node - LLM generates/refines PRD with real-time file streaming
 */
export async function generateNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  const recursionCount = (state.recursionCount || 0) + 1;
  
  const planMode = getPlanMode(state);
  const modeLabel = planMode === 'generate' ? 'Creating' : planMode === 'explain' ? 'Analyzing' : 'Refining';
  console.log(`\n🤖 [Planner:Generate] ${modeLabel} PRD... (iteration ${recursionCount}/${state.recursionLimit})`);
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('generate', state._uiLocale || 'en'), 'generate');
  }
  
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for generate node');
  }

  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(
      state._httpJobId, 'generate', 0,
      undefined, extractLLMInfo(llm),
      recursionCount, state.recursionLimit,
    );
  }
  
  // Step 1: async compactJob — LLM-based conversation summary
  const allButLast = state.isConversationContinuation && state.conversation?.length
    ? state.conversation.slice(0, -1)
    : [];
  
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Generate] PromptBuilder not available');

  let compactionResult: { entries: ConversationEntry[]; summary?: string; wasCompacted: boolean; tokensBefore: number; tokensAfter: number; tokenUsage?: import('@ant/shared').TaskTokenUsage };
  try {
    compactionResult = allButLast.length > 0
      ? await compactJob(allButLast, llm, promptBuilder, {
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
  
  // Step 2: buildSystemPrompt via PromptBuilder
  const systemPrompt = await buildSystemPrompt(state, compactionResult);
  
  // Log prompt structure to debug directory
  if (state._httpJobId && state.featurePath) {
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
            mode: planMode,
            targets: state.resolvedAction?.target || [],
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
      console.warn(`⚠️ [Planner:Generate] Failed to log prompt:`, err);
    }
  }
  
  // Build messages (with conversationHistory pruning)
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

  // Anthropic API requires conversation to end with a user message.
  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
    console.warn(`⚠️ [Planner:Generate] Messages end with assistant role — appending user continuation`);
    messages.push({ role: 'user', content: 'Continue.' });
  }
  
  // Setup tools
  const activeTools = planMode === 'explain' ? PLANNER_EXPLAIN_TOOLS : PLANNER_TOOLS;
  const toolDefinitions = activeTools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  
  // Setup StreamOrchestrator for real-time <file> tag streaming
  const chatAPI = getChatAPIClient();
  const parser = new XMLStreamParser();
  const renderStrategy = new CommonRenderStrategy(
    chatAPI,
    state.language === 'ko' ? 'ko' : 'en',
    undefined,
    undefined,
    false,
  );
  const orchestrator = new StreamOrchestrator({
    parser,
    renderStrategy,
    existingFiles: new Set(),
  });
  
  let responseText = '';
  const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
  
  const isFirstCall = state.conversationHistory.length === 0;
  
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
        
        if (state.deps?.kanbanUpdate?.updateTaskQueue && state._httpJobId) {
          state.deps.kanbanUpdate.updateTaskQueue(
            state._httpJobId,
            null,
            [],
            [],
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
    const recordedMessage = state.isConversationContinuation && state.conversation?.length
      ? state.conversation[state.conversation.length - 1].content
      : state.directive;
    updatedHistory.push({ role: 'user', content: recordedMessage });
  }
  
  if (toolCalls.length > 0) {
    await orchestrator.finalize(true);
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
    }
    
    updatedHistory.push(buildAssistantMessage({
      text: responseText || undefined,
      toolCalls,
    }));
    
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
  
  // === Check for <clarify> tags in response ===
  const clarifyBlocks = parseClarifyBlocks(responseText);
  if (clarifyBlocks.length > 0) {
    console.log(`💬 [Planner:Generate] Found ${clarifyBlocks.length} clarify block(s), sending choice cards`);
    
    const cleanedResponseText = stripClarifyBlocks(responseText);
    
    try {
      const { sendClarify } = await import('../../../../../common/clarify');
      await sendClarify(clarifyBlocks);
    } catch (error) {
      console.warn('⚠️ [Planner:Generate] Failed to send clarify card:', error);
    }
    
    const clarifyHistory = [...updatedHistory, { role: 'assistant', content: cleanedResponseText }];
    await saveConversationToSession(state, cleanedResponseText, undefined, clarifyHistory, compactionMeta);
    
    if (state.deps?.kanbanUpdate?.clearEstimatingActivity) {
      state.deps.kanbanUpdate.clearEstimatingActivity();
    }
    
    if (state.deps?.workflowUpdate && state._httpJobId) {
      state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
    }
    
    updatedHistory.push({ role: 'assistant', content: cleanedResponseText });
    
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
        mode: planMode,
      },
    });
    
    return {
      conversationHistory: updatedHistory,
      conversation: updatedConversation,
      pendingToolCalls: [],
      tokenUsage: state.tokenUsage,
      recursionCount,
    };
  }
  
  // === Explain mode: read-only Q&A — skip extraction, disk write, choice card ===
  const stagingRelPath = getStagingPath(state);
  let generatedDocument: string | undefined;
  
  if (planMode === 'explain') {
    const explainHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
    await saveConversationToSession(state, responseText, undefined, explainHistory, compactionMeta);
  } else {
    const files = orchestrator.getRegistry().getAllFiles();
    const matchedFile = stagingRelPath
      ? files.find(f => f.path.includes(path.basename(stagingRelPath)))
      : files[0];
    generatedDocument = matchedFile?.content || undefined;
    
    if (!generatedDocument && planMode === 'refactor' && stagingRelPath) {
      const editStagingPath = path.join(state.featurePath, stagingRelPath);
      try {
        generatedDocument = await fsPromises.readFile(editStagingPath, 'utf-8');
        console.log(`📝 [Planner:Generate] Read edited document from staging (${generatedDocument.length} chars)`);
      } catch {
        console.log(`📝 [Planner:Generate] No staging file found (no edits made)`);
      }
    }
    
    if (generatedDocument && stagingRelPath) {
      const stagingAbsPath = path.join(state.featurePath, stagingRelPath);
      const sourcePath = state.resolvedAction?.target?.[0];
      
      if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
        state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
      }
      
      try {
        await fsPromises.mkdir(path.dirname(stagingAbsPath), { recursive: true });
        await fsPromises.writeFile(stagingAbsPath, generatedDocument, 'utf-8');
        console.log(`📝 [Planner:Generate] Written ${generatedDocument.length} chars to ${stagingRelPath}`);
      } catch (error: any) {
        console.error(`❌ [Planner:Generate] Failed to write document: ${error.message}`);
        throw error;
      }
      
      if (state.deps?.fileTreeUpdate) {
        const projectId = process.env.ANT_PROJECT_ID;
        const featureName = process.env.ANT_FEATURE_NAME;
        if (!projectId || !featureName) {
          console.warn(`⚠️ [Planner:Generate] Cannot notify file tree: missing ANT_PROJECT_ID or ANT_FEATURE_NAME`);
        } else {
          try {
            state.deps.fileTreeUpdate.notifyFileTreeUpdate(projectId, featureName);
            if ('addUnseenArtifacts' in state.deps.fileTreeUpdate) {
              (state.deps.fileTreeUpdate as any).addUnseenArtifacts(
                projectId, featureName, [stagingRelPath]
              );
            }
          } catch (error: any) {
            console.warn(`⚠️ [Planner:Generate] Failed to notify file tree update: ${error.message}`);
          }
        }
      }
      
      try {
        const session = state.deps?.session;
        if (session) {
          const projectId = session.projectId || process.env.ANT_PROJECT_ID || 'default';
          const featureName = session.featureName || process.env.ANT_FEATURE_NAME || 'skeleton';
          await session.addRun(projectId, featureName, 'plan', {
            runId: 0,
            job: 'plan',
            timestamp: new Date().toISOString(),
            input: {
              type: 'directive',
              source: planMode === 'refactor' ? sourcePath : undefined,
              summary: (state.directive || '').substring(0, 200),
            },
            output: {
              planSummary: `${planMode} completed (${generatedDocument.length} chars)`,
            },
          });
        }
      } catch (error: any) {
        console.warn(`⚠️ [Planner:Generate] Failed to record session: ${error.message}`);
      }
      
      const prdHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
      await saveConversationToSession(state, responseText, generatedDocument, prdHistory, compactionMeta);
      
      try {
        const displayName = sourcePath ? path.basename(sourcePath) : 'document';
        await chatAPI.sendChoiceCard({
          type: 'prd_apply',
          title: state.language === 'ko'
            ? `📋 ${displayName}을(를) 원본에 적용하시겠습니까?`
            : `📋 Apply ${displayName} to source?`,
          choices: [
            {
              id: 'apply',
              label: state.language === 'ko' ? '적용' : 'Apply',
              action: 'prd_apply',
              data: { stagingPath: stagingRelPath, sourcePath },
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
    
    if (!generatedDocument) {
      const textOnlyHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
      await saveConversationToSession(state, responseText, undefined, textOnlyHistory, compactionMeta);
    }
  }
  
  // Finalize message (after choice card)
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
  }
  
  updatedHistory.push({ role: 'assistant', content: responseText });
  
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
      artifactPath: generatedDocument ? stagingRelPath : undefined,
      mode: planMode,
    },
  });
  
  return {
    conversationHistory: updatedHistory,
    conversation: updatedConversation,
    pendingToolCalls: [],
    tokenUsage: state.tokenUsage,
    recursionCount,
  };
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
