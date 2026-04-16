/**
 * Generate Node
 * 
 * ReAct agent that generates or refines documents.
 * Target paths are derived from resolvedAction.target (no hardcoded paths).
 * 
 * Two output modes:
 *  - Generate mode: LLM outputs full document via <file path="{targetPath}">...</file> tags.
 *  - Refine mode: LLM uses edit_file tool for targeted edits on the target file.
 * 
 * There is no separate write node — this node handles streaming, disk write, choice card, and session.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { PlanGraphState, getPlanMode } from '../../state';
import { CONV_KEYS, getConv, type ConversationMessage } from '../../../../../common/graph/conversations';
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

import { buildSystemPrompt, getTargetPath, formatConversationForPrompt } from './promptBuilder';
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
  const sessionMain = getConv(state.conversations, CONV_KEYS.SESSION_MAIN);
  const nodeGenerate = getConv(state.conversations, CONV_KEYS.NODE_GENERATE);
  const allButLast = state.isConversationContinuation && sessionMain.length
    ? sessionMain.slice(0, -1)
    : [];
  
  const promptBuilder = state.deps?.promptBuilder;
  if (!promptBuilder) throw new Error('[Planner:Generate] PromptBuilder not available');

  let compactionResult: { entries: ConversationMessage[]; summary?: string; wasCompacted: boolean; tokensBefore: number; tokensAfter: number; tokenUsage?: import('@ant/shared').TaskTokenUsage };
  try {
    compactionResult = (allButLast.length > 0
      ? await compactJob(allButLast as any, llm, promptBuilder, {
          threshold: PLAN_COMPACTION_THRESHOLD,
          recentWindowSize: PLAN_COMPACTION_WINDOW,
          maxOutputTokens: COMPACTION_MAX_OUTPUT_TOKENS,
        })
      : { entries: [] as ConversationMessage[], wasCompacted: false, tokensBefore: 0, tokensAfter: 0 }) as any;
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
          templatePath: 'jobs/plan/nodes/plan/variants/default/base',
          usedTemplates: ['jobs/plan/nodes/plan/variants/default/base', 'jobs/plan/nodes/plan/variants/default/rules'],
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
  
  // Build messages (with nodeGenerate pruning)
  const messages: Array<{ role: string; content: any }> = [];
  
  if (nodeGenerate.length === 0) {
    const userMessage = state.isConversationContinuation && sessionMain.length
      ? sessionMain[sessionMain.length - 1].content
      : state.directive;
    messages.push({ role: 'user', content: userMessage });
  } else {
    try {
      const prunedHistory = await pruneConversationHistory(nodeGenerate);
      messages.push(...prunedHistory);
    } catch (err) {
      console.warn(`⚠️ [Planner:Generate] pruneConversationHistory failed, using raw history:`, err);
      messages.push(...nodeGenerate);
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
  
  const isFirstCall = nodeGenerate.length === 0;
  
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
  
  // Update node:generate history
  const updatedHistory = [...nodeGenerate];
  
  if (nodeGenerate.length === 0) {
    const recordedMessage = state.isConversationContinuation && sessionMain.length
      ? sessionMain[sessionMain.length - 1].content
      : state.directive;
    updatedHistory.push({ role: 'user', content: recordedMessage || '' });
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
      state.deps.stateSnapshot.conversations = { ...state.conversations, [CONV_KEYS.NODE_GENERATE]: updatedHistory };
      state.deps.stateSnapshot.directive = state.directive;
      state.deps.stateSnapshot.tokenUsage = state.tokenUsage;
    }
    
    return {
      conversations: { [CONV_KEYS.NODE_GENERATE]: updatedHistory },
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
    
    const updatedSessionMain: ConversationMessage[] = [...sessionMain];
    if (updatedSessionMain.length === 0 && state.directive) {
      updatedSessionMain.push({
        role: 'user',
        content: state.directive,
        timestamp: new Date().toISOString(),
      });
    }
    updatedSessionMain.push({
      role: 'assistant',
      content: cleanedResponseText,
      timestamp: new Date().toISOString(),
      metadata: {
        hasArtifact: false,
        mode: planMode,
      },
    });
    
    return {
      conversations: { [CONV_KEYS.NODE_GENERATE]: updatedHistory, [CONV_KEYS.SESSION_MAIN]: updatedSessionMain },
      pendingToolCalls: [],
      tokenUsage: state.tokenUsage,
      recursionCount,
    };
  }
  
  // === Explain mode: read-only Q&A — skip extraction, disk write, choice card ===
  const targetRelPath = getTargetPath(state);
  let generatedDocument: string | undefined;
  
  if (planMode === 'explain') {
    const explainHistory = [...updatedHistory, { role: 'assistant', content: responseText }];
    await saveConversationToSession(state, responseText, undefined, explainHistory, compactionMeta);
  } else {
    const files = orchestrator.getRegistry().getAllFiles();
    const matchedFile = targetRelPath
      ? files.find(f => f.path.includes(path.basename(targetRelPath)))
      : files[0];
    generatedDocument = matchedFile?.content || undefined;
    
    if (!generatedDocument && planMode === 'refactor' && targetRelPath) {
      const editTargetPath = path.join(state.featurePath, targetRelPath);
      try {
        generatedDocument = await fsPromises.readFile(editTargetPath, 'utf-8');
        console.log(`📝 [Planner:Generate] Read edited document from target (${generatedDocument.length} chars)`);
      } catch {
        console.log(`📝 [Planner:Generate] No target file found (no edits made)`);
      }
    }
    
    if (generatedDocument && targetRelPath) {
      const targetAbsPath = path.join(state.featurePath, targetRelPath);
      const sourcePath = state.resolvedAction?.target?.[0];
      
      if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
        state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
      }
      
      try {
        await fsPromises.mkdir(path.dirname(targetAbsPath), { recursive: true });
        await fsPromises.writeFile(targetAbsPath, generatedDocument, 'utf-8');
        console.log(`📝 [Planner:Generate] Written ${generatedDocument.length} chars to ${targetRelPath}`);
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
                projectId, featureName, [targetRelPath]
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
  
  const updatedSessionMain: ConversationMessage[] = [...sessionMain];
  if (updatedSessionMain.length === 0 && state.directive) {
    updatedSessionMain.push({
      role: 'user',
      content: state.directive,
      timestamp: new Date().toISOString(),
    });
  }
  updatedSessionMain.push({
    role: 'assistant',
    content: responseText,
    timestamp: new Date().toISOString(),
    metadata: {
      hasArtifact: !!generatedDocument,
      artifactPath: generatedDocument ? targetRelPath : undefined,
      mode: planMode,
    },
  });
  
  return {
    conversations: { [CONV_KEYS.NODE_GENERATE]: updatedHistory, [CONV_KEYS.SESSION_MAIN]: updatedSessionMain },
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
