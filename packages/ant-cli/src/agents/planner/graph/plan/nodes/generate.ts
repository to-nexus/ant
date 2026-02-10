/**
 * Generate Node
 * 
 * ReAct agent that generates or refines the PRD.
 * Uses StreamOrchestrator for real-time file card streaming (same as design job's docGen).
 * LLM wraps PRD output in <file path="outputs/plan/prd-refine.md">...</file> tags.
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
import { accumulateTokenUsage } from '../../../../common/graph/llmHelpers';
import { WorkspacePathResolver } from '../../../../../infrastructure/workspace/WorkspaceResolver';
import { getChatAPIClient } from '../../../../../core/adapters/ChatAPIClient';
import { v4 as uuidv4 } from 'uuid';
import { PLANNER_TOOLS } from '../../tools';
import { getEstimatingLabel } from '../../../../common/graph/timing/estimatingLabels';
import { StreamOrchestrator } from '../../../../../core/streaming/StreamOrchestrator';
import { XMLStreamParser } from '../../../../../core/streaming/parsers/XMLStreamParser';
import { CommonRenderStrategy } from '../../../../../core/streaming/strategies/CommonRenderStrategy';

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

function buildSystemPrompt(state: PlanGraphState): string {
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
  });
  
  return `${basePrompt}\n\n---\n\n${rules}`;
}

/**
 * Generate node - LLM generates/refines PRD with real-time file streaming
 */
export async function generateNode(state: PlanGraphState): Promise<Partial<PlanGraphState>> {
  console.log(`\n🤖 [Planner:Generate] ${state.mode === 'generate' ? 'Creating' : 'Refining'} PRD...`);
  
  // Kanban activity banner
  if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
    state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('generate', state._uiLocale || 'en'), 'generate');
  }
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    await state.deps.workflowUpdate.enterNode(state._httpJobId, 'generate', 0);
  }
  
  const llm = state.deps?.llm;
  if (!llm) {
    throw new Error('LLM is required for generate node');
  }
  
  const systemPrompt = buildSystemPrompt(state);
  
  // Build messages
  const messages: Array<{ role: string; content: any }> = [];
  
  if (state.conversationHistory.length === 0) {
    messages.push({ role: 'user', content: state.directive });
  } else {
    messages.push(...state.conversationHistory);
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
  let toolCall: { id: string; name: string; args: Record<string, any> } | undefined;
  
  const isFirstCall = state.conversationHistory.length === 0;
  
  try {
    for await (const event of llm.stream(messages, {
      system: systemPrompt,
      tools: toolDefinitions,
      enableThinking: isFirstCall,
    })) {
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
        toolCall = { id: id || uuidv4(), name, args: input };
      }
      
      if (event.type === 'done' && event.usage) {
        accumulateTokenUsage(state, event.usage, { taskLevel: false, jobLevel: true });
      }
    }
  } catch (error: any) {
    console.error(`❌ [Planner:Generate] LLM error: ${error.message}`);
    throw error;
  }
  
  // Update conversation history
  const updatedHistory = [...state.conversationHistory];
  
  if (state.conversationHistory.length === 0) {
    updatedHistory.push({ role: 'user', content: state.directive });
  }
  
  const hasToolCalls = !!toolCall;
  
  if (toolCall) {
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
        { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.args },
      ],
    });
    
    return {
      conversationHistory: updatedHistory,
      pendingToolCall: toolCall,
    };
  }
  
  // Final PRD path — finalize orchestrator but keep message open for choice card
  await orchestrator.finalize(true);
  
  // Extract file content from registry (populated by StreamOrchestrator via <file> tags)
  const files = orchestrator.getRegistry().getAllFiles();
  const prdFile = files.find(f => f.path.includes('prd-refine'));
  const generatedDocument = prdFile?.content || undefined;
  
  // === Post-stream: disk write + choice card + session (same role as design job's docGen) ===
  if (generatedDocument) {
    const stagingPath = path.join(state.featurePath, 'outputs/plan/prd-refine.md');
    
    // Kanban: show "saving" activity
    if (state.deps?.kanbanUpdate?.setEstimatingActivity) {
      state.deps.kanbanUpdate.setEstimatingActivity(getEstimatingLabel('write', state._uiLocale || 'en'), 'write');
    }
    
    // Write to disk
    try {
      await fsPromises.mkdir(path.dirname(stagingPath), { recursive: true });
      await fsPromises.writeFile(stagingPath, generatedDocument, 'utf-8');
      console.log(`📝 [Planner:Generate] Written ${generatedDocument.length} chars to outputs/plan/prd-refine.md`);
    } catch (error: any) {
      console.error(`❌ [Planner:Generate] Failed to write PRD: ${error.message}`);
      throw error;
    }
    
    // Record session turn
    try {
      const session = state.deps?.session;
      if (session) {
        const projectId = process.env.ANT_PROJECT_ID || 'default';
        const featureName = process.env.ANT_FEATURE_NAME || 'skeleton';
        
        await session.addTurn(projectId, featureName, 'plan', {
          directive: state.directive,
          mode: state.mode,
          timestamp: new Date().toISOString(),
          tokenUsage: state.tokenUsage,
        });
      }
    } catch (error: any) {
      console.warn(`⚠️ [Planner:Generate] Failed to record session: ${error.message}`);
    }
    
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
  
  // Finalize message (after choice card)
  await chatAPI.finalizeMessage();
  
  // Workflow instrumentation
  if (state.deps?.workflowUpdate && state._httpJobId) {
    state.deps.workflowUpdate.exitNode(state._httpJobId, 'generate', 0);
  }
  
  updatedHistory.push({ role: 'assistant', content: responseText });
  
  return {
    conversationHistory: updatedHistory,
    generatedDocument,
    pendingToolCall: undefined,
  };
}

/**
 * Router: decide next node after generate
 */
export function routeAfterGenerate(state: PlanGraphState): 'tool' | '__end__' {
  if (state.pendingToolCall) {
    return 'tool';
  }
  return '__end__';
}
